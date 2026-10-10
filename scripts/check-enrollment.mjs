import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const source=await readFile('dist/server/index.js','utf8');
const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
const objects=new Map();
const env={SITE_ORIGIN:'https://board.example',COLLECTOR_SERVICE_TOKEN:'test-service-token',BUCKET:{
  async get(key){const value=objects.get(key);return value===undefined?null:{json:async()=>JSON.parse(value)};},
  async put(key,value){objects.set(key,value);},
  async delete(key){objects.delete(key);},
  async list({prefix}){return {objects:[...objects.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key})),truncated:false};},
}};
const viewer={'oai-authenticated-user-id':'owner',Origin:env.SITE_ORIGIN};
const call=(path,method='GET',data,headers=viewer)=>worker.fetch(new Request(env.SITE_ORIGIN+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),env);
const created=await call('/api/hosts','POST',{name:'compose-host',format:'compose'});
assert.equal(created.status,200);
assert.equal(created.headers.get('Content-Type'),'application/x-tar');
const id=created.headers.get('X-Crowsnest-Host-Id');assert.match(id,/^[a-f0-9-]{36}$/);
const archive=join(process.env.DOCKER_WATCH_TEST_DIRECTORY||'/tmp','crowsnest-test-collector.tar');
await writeFile(archive,new Uint8Array(await created.arrayBuffer()));
const parsed=spawnSync('python3',['-c',`import tarfile,json,sys
with tarfile.open(sys.argv[1]) as archive:
 members=archive.getmembers()
 assert all(m.isfile() and '/' not in m.name for m in members)
 print(json.dumps({'names':[m.name for m in members],'modes':{m.name:m.mode for m in members},'config':json.loads(archive.extractfile('collector.json').read()),'readme':archive.extractfile('README.txt').read().decode(),'compose':archive.extractfile('compose.yaml').read().decode()}))`,archive],{encoding:'utf8'});
assert.equal(parsed.status,0,parsed.stderr);
const bundle=JSON.parse(parsed.stdout), config=bundle.config;
assert.deepEqual(bundle.names,['compose.yaml','collector.py','proxy.cfg','collector.json','README.txt']);
assert.equal(bundle.modes['collector.json'],0o600);
assert.ok(bundle.readme.startsWith('Crowsnest collector '+JSON.parse(await readFile('package.json','utf8')).version));
assert.ok(!bundle.compose.includes('ports:')&&!bundle.compose.includes('privileged:'));
assert.equal(config.hostId,id);assert.equal(config.url,env.SITE_ORIGIN);
const path='/api/hosts/'+id, ingest='/api/ingest/'+id;
const report={engineVersion:'29.0',containers:[{id:'a'.repeat(64),name:'web',image:'nginx:alpine',state:'running',health:'healthy',restarts:0,startedAt:'2026-10-09T10:00:00Z',finishedAt:''}]};
const deliver=(token,body=report)=>call(ingest,'POST',body,{Authorization:'Bearer '+token});
assert.equal((await deliver(config.hostToken)).status,200);
assert.equal((await call('/api/history')).status,200);
assert.equal((await call('/api/history','GET',undefined,{})).status,401);
for(const route of [path,path+'/collector']) {
 for(const method of route.endsWith('collector')?['POST']:['PATCH','DELETE']) {
  assert.equal((await call(route,method,{},{})).status,401);
  assert.equal((await call(route,method,{}, {'oai-authenticated-user-id':'owner',Origin:'https://evil.example'})).status,403);
 }
}
assert.equal((await call(path,'PATCH',{name:'rookery'})).status,200);
const duplicate=await call('/api/hosts','POST',{name:'second-host',format:'compose'});assert.equal(duplicate.status,200);
assert.equal((await call(path,'PATCH',{name:'SECOND-HOST'})).status,409);
assert.equal((await call(path,'PATCH',{name:'<script>'})).status,400);
const rotation=await call(path+'/collector','POST',{format:'config'});assert.equal(rotation.status,200);
const replacement=await rotation.json();assert.notEqual(replacement.hostToken,config.hostToken);
assert.equal((await deliver(config.hostToken)).status,200);
assert.equal((await deliver(replacement.hostToken,{})).status,400);
assert.equal((await deliver(config.hostToken)).status,200);
assert.equal((await deliver(replacement.hostToken)).status,200);
assert.equal((await deliver(config.hostToken)).status,403);
assert.equal((await deliver(replacement.hostToken)).status,200);
const listed=await (await call('/api/hosts')).json();
assert.equal(listed.hosts.find(h=>h.id===id).credentialRevision,1);
assert.ok(!JSON.stringify(listed).includes(replacement.hostToken));
assert.ok(!JSON.stringify(listed).includes('pendingToken'));
const expiring=await (await call(path+'/collector','POST',{format:'config'})).json();
const stored=JSON.parse(objects.get('hosts/'+id+'.json'));stored.pendingTokenExpiresAt='2000-01-01T00:00:00Z';objects.set('hosts/'+id+'.json',JSON.stringify(stored));
assert.equal((await deliver(expiring.hostToken)).status,403);
assert.equal((await deliver(replacement.hostToken)).status,200);
const changed=structuredClone(report);changed.containers[0].health='unhealthy';changed.containers[0].restarts=2;
assert.equal((await deliver(replacement.hostToken,changed)).status,200);
let events=(await (await call('/api/history?host='+id)).json()).events;
assert.ok(events.some(e=>e.kind==='status'));assert.ok(events.some(e=>e.kind==='restart'));assert.ok(events.some(e=>e.kind==='credentials'));assert.ok(events.some(e=>e.text.includes('First collector report')));
assert.ok(events.every(e=>e.hostName==='rookery'));
assert.ok(!JSON.stringify(events).includes(replacement.hostToken));
// Repeated changes remain bounded; old records are hidden by retention.
for(let n=0;n<105;n++){changed.containers[0].health=n%2?'healthy':'unhealthy';await deliver(replacement.hostToken,changed);}
events=(await (await call('/api/history?host='+id)).json()).events;assert.ok(events.length<=100);
objects.set('history/'+id+'.json',JSON.stringify([{kind:'host',text:'expired',at:'2000-01-01T00:00:00Z'}]));
assert.equal((await (await call('/api/history?host='+id)).json()).events.length,0);
assert.equal((await call(path,'DELETE',{confirmName:'wrong'})).status,400);
assert.equal((await call(path,'DELETE',{confirmName:'rookery'})).status,200);
assert.equal((await deliver(replacement.hostToken)).status,404);
assert.ok(!objects.has('hosts/'+id+'.json')&&!objects.has('snapshots/'+id+'.json')&&!objects.has('history/'+id+'.json'));
console.log('Passed: Compose archive, private file modes, host rename/remove, origin checks, staged token replacement/expiry, bounded history, and removed-host rejection.');
