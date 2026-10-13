import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,stat,symlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {testBucket} from './test-storage.mjs';
const source=await readFile('dist/server/index.js','utf8');
const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
const objects=new Map(), requests=[];
const env={SITE_ORIGIN:'https://board.example.com',COLLECTOR_SERVICE_TOKEN:'test-service-token',NTFY_URL:'https://ntfy.example.com/fleet',NTFY_ENABLED:'true',BUCKET:testBucket(objects)};
const viewer={'oai-authenticated-user-id':'owner',Origin:env.SITE_ORIGIN};
const call=(path,method='GET',data,headers=viewer)=>worker.fetch(new Request(env.SITE_ORIGIN+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),env);
const set=(key,v)=>objects.set(key,JSON.stringify(v));
const oldFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));return new Response(JSON.stringify({id:'test-message',event:'message',topic:'fleet'}));};
try {
  const setup=await (await call('/api/hosts','POST',{name:'maintenance-host',format:'setup'})).json();
  const config=JSON.parse(setup.setupCommand.match(/cat > collector.json <<'DOCKER_WATCH_FILE_EOF'\n([\s\S]*?)\nDOCKER_WATCH_FILE_EOF/)[1]);
  const id=config.hostId, path='/api/hosts/'+id, auth={Authorization:'Bearer '+config.hostToken};
  const report={engineVersion:'29',containers:[{id:'a'.repeat(64),name:'web',image:'nginx',state:'running',health:'healthy',restarts:0,startedAt:'',finishedAt:''}]};
  const deliver=()=>call('/api/ingest/'+id,'POST',report,auth);
  const sweep=()=>{objects.delete('notifications/sweep.json');return call('/api/notifications/sweep','POST',{}, {Authorization:'Bearer '+env.COLLECTOR_SERVICE_TOKEN});};
  for(const headers of [{},auth,{Authorization:'Bearer '+env.COLLECTOR_SERVICE_TOKEN}])assert.equal((await call(path+'/maintenance','POST',{minutes:60},headers)).status,401);
  assert.equal((await call(path+'/maintenance','POST',{minutes:60},{...viewer,Origin:'https://evil.example'})).status,403);
  for(const minutes of [-1,1,61,'60',null])assert.equal((await call(path+'/maintenance','POST',{minutes})).status,400);
  assert.equal((await call(path+'/maintenance','POST',{minutes:60,until:'2099'})).status,400);
  await deliver();const hostRecord=objects.get('hosts/'+id+'.json');
  for(const minutes of [15,60,240,1440]){
    const before=Date.now(), result=await (await call(path+'/maintenance','POST',{minutes})).json();
    assert.ok(Date.parse(result.maintenanceUntil)>=before+minutes*60000);
  }
  assert.equal(objects.get('hosts/'+id+'.json'),hostRecord,'Maintenance cannot overwrite credential state');
  const listed=await (await call('/api/hosts')).json();assert.ok(listed.hosts[0].maintenanceUntil);
  report.containers[0].health='unhealthy';await deliver();assert.equal(requests.length,0);
  assert.equal(JSON.parse(objects.get('snapshots/'+id+'.json')).containers[0].health,'unhealthy');
  assert.ok(JSON.parse(objects.get('history/'+id+'.json')).some(e=>e.kind==='status'));
  const snapshot=JSON.parse(objects.get('snapshots/'+id+'.json'));snapshot.receivedAt='2000-01-01T00:00:00Z';set('snapshots/'+id+'.json',snapshot);await sweep();assert.equal(requests.length,0,'Sweep must respect maintenance');
  assert.equal((await call('/api/notifications/test','POST',{})).status,200,'Manual tests remain available');requests.length=0;
  report.containers[0].health='healthy';await deliver();await call(path+'/maintenance','POST',{minutes:0});await deliver();assert.equal(requests.length,0,'No recovery for a suppressed transient alert');
  report.containers[0].health='unhealthy';await call(path+'/maintenance','POST',{minutes:15});await deliver();
  const record=JSON.parse(objects.get('maintenance/hosts/'+id+'.json'));record.until='2000-01-01T00:00:00Z';set('maintenance/hosts/'+id+'.json',record);
  await sweep();assert.equal(requests.length,1,'Expired maintenance resumes via unattended sweep');assert.match(requests[0].message,/Alert: web/);
  await call(path+'/maintenance','POST',{minutes:60});report.containers[0].health='healthy';await deliver();assert.equal(requests.length,1);
  await call(path+'/maintenance','POST',{minutes:0});await deliver();assert.equal(requests.length,2,'Previously delivered issue can recover after early end');assert.match(requests[1].message,/Cleared:/);
  // Compose fields are optional for old collectors, bounded, and allowlisted.
  report.containers[0].composeProject='media';report.containers[0].composeService='web';report.containers[0].labels={secret:'do-not-collect'};
  await deliver();const container=JSON.parse(objects.get('snapshots/'+id+'.json')).containers[0];assert.equal(container.composeProject,'media');assert.equal(container.composeService,'web');assert.ok(!('labels' in container));
  for(const value of [null,{},'x'.repeat(129)]){report.containers[0].composeProject=value;assert.equal((await deliver()).status,400);}
  delete report.containers[0].composeProject;delete report.containers[0].composeService;assert.equal((await deliver()).status,200);
  // Updating code must never rotate or expose credentials, and must work with spaces.
  const beforeUpdate=objects.get('hosts/'+id+'.json');
  const update=await (await call(path+'/collector','POST',{format:'update'})).json();
  assert.equal(objects.get('hosts/'+id+'.json'),beforeUpdate);assert.ok(!update.updateCommand.includes(config.hostToken)&&!update.updateCommand.includes(env.COLLECTOR_SERVICE_TOKEN));
  const root=process.env.DOCKER_WATCH_TEST_DIRECTORY, dir=join(root,'update installation'), bin=join(root,'update-bin');await mkdir(dir);await mkdir(bin);
  await writeFile(join(dir,'collector.json'),'private fixture',{mode:0o600});await writeFile(join(dir,'compose.yaml'),'existing compose');await writeFile(join(dir,'collector.py'),'old code');await writeFile(join(dir,'.env'),'existing user');
  await writeFile(join(bin,'docker'),'#!/bin/sh\nprintf "%s\\n" "$*" >> "$UPDATE_CALLS"\n',{mode:0o755});
  const calls=join(root,'update-calls'), execute=()=>spawnSync('bash',[],{input:update.updateCommand,env:{...process.env,PATH:bin+':'+process.env.PATH,CROWSNEST_COLLECTOR_DIR:dir,UPDATE_CALLS:calls},encoding:'utf8'});
  const version=JSON.parse(await readFile('package.json','utf8')).version;
  assert.equal(update.collectorVersion,version);
  assert.equal(execute().status,0);assert.equal(await readFile(join(dir,'collector.py'),'utf8'),(await readFile('worker/collector.py','utf8')).replaceAll('__APP_VERSION__',version)+'\n');
  assert.equal(await readFile(join(dir,'collector.json'),'utf8'),'private fixture');assert.equal((await stat(join(dir,'collector.json'))).mode&0o777,0o600);assert.equal(await readFile(join(dir,'.env'),'utf8'),'existing user');assert.equal(await readFile(join(dir,'compose.yaml'),'utf8'),'existing compose');
  assert.match(await readFile(calls,'utf8'),/compose up -d --force-recreate socket-proxy collector/);
  assert.equal(await readFile(join(dir,'proxy.cfg'),'utf8'),(await readFile('worker/proxy.cfg','utf8'))+'\n');
  const {unlink}=await import('node:fs/promises');await unlink(join(dir,'collector.py'));await symlink(join(dir,'collector.json'),join(dir,'collector.py'));assert.notEqual(execute().status,0);assert.equal(await readFile(join(dir,'collector.json'),'utf8'),'private fixture');
  await call(path,'DELETE',{confirmName:'maintenance-host'});assert.ok(!objects.has('maintenance/hosts/'+id+'.json'));
  console.log('Passed: maintenance authorization, timers, ingestion/sweep suppression, automatic expiry, early end, truthful health/history, recovery baseline, optional Compose metadata, safe collector update, and cleanup.');
}finally{globalThis.fetch=oldFetch;}
