import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {testBucket} from './test-storage.mjs';
const testFile=name=>join(process.env.CROWSNEST_TEST_DIRECTORY||'/tmp',name);
const source=await readFile('dist/server/index.js','utf8');
const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
const objects=new Map();
const env={SITE_ORIGIN:'https://board.example',COLLECTOR_SERVICE_TOKEN:'test-service-token',BUCKET:testBucket(objects)};
const viewer={'oai-authenticated-user-id':'owner'};
const call=(path,options={})=>worker.fetch(new Request(env.SITE_ORIGIN+path,options),env);
// Canonical browser navigation must preserve privacy and existing API endpoints.
env.DASHBOARD_ORIGIN='https://crowsnest.example.net';
assert.equal((await call('/')).status,401);
for(const method of ['GET','HEAD']) {
  const redirect=await call('/?view=hosts',{method,headers:viewer});
  assert.equal(redirect.status,308);
  assert.equal(redirect.headers.get('Location'),env.DASHBOARD_ORIGIN+'/?view=hosts');
  assert.equal(redirect.headers.get('Cache-Control'),'no-store');
}
assert.equal((await worker.fetch(new Request(env.DASHBOARD_ORIGIN+'/',{headers:viewer}),env)).status,200);
assert.equal((await call('/api/hosts',{headers:viewer})).status,200);
assert.equal((await call('/',{method:'POST',headers:viewer})).status,404);
for(const invalid of ['broken','http://crowsnest.example.net','https://user:password@example.net','https://example.net/path','https://example.net/?next=bad','https://example.net/#bad']) {
  env.DASHBOARD_ORIGIN=invalid;
  assert.equal((await call('/',{headers:viewer})).status,200);
}
delete env.DASHBOARD_ORIGIN;
assert.equal((await call('/')).status,401);
assert.equal((await call('/',{headers:viewer})).status,200);
const brandedPage=await (await call('/',{headers:viewer})).text();
assert.match(brandedPage,/<title>Crowsnest/);
assert.match(brandedPage,/src="\/assets\/crowsnest-mark\.png"/);
const csp=(await call('/',{headers:viewer})).headers.get('Content-Security-Policy');
assert.ok(!csp.includes('unsafe-inline')&&!csp.includes('unsafe-eval'));
for(const [path,type] of [['/assets/board.js','text/javascript'],['/assets/board.css','text/css']]) {
  assert.equal((await call(path)).status,401);
  const asset=await call(path,{headers:viewer});
  assert.equal(asset.status,200);
  assert.ok(asset.headers.get('Content-Type').startsWith(type));
}
assert.ok(!brandedPage.includes('__APP_VERSION__'));

const logo=await call('/assets/crowsnest-mark.png',{headers:viewer});
assert.equal(logo.status,200);
assert.equal(logo.headers.get('Content-Type'),'image/png');
assert.deepEqual([...new Uint8Array(await logo.arrayBuffer()).slice(0,8)],[137,80,78,71,13,10,26,10]);
assert.equal((await call('/assets/crowsnest-mark.png')).status,401);
assert.equal((await call('/api/hosts',{method:'POST',headers:viewer,body:'{}'})).status,403);
assert.equal((await call('/api/hosts',{method:'POST',headers:{...viewer,Origin:env.SITE_ORIGIN},body:JSON.stringify({name:'hedwig'})})).status,200);
const host=JSON.parse([...objects.values()][0]);
assert.equal(host.name,'hedwig');assert.equal(host.tokenHash.length,64);assert.equal(host.hostToken,undefined);
// A second host creates the installer used to validate its embedded collector and credentials.
const result=await call('/api/hosts',{method:'POST',headers:{...viewer,Origin:env.SITE_ORIGIN},body:JSON.stringify({name:'second'})});
const installer=await result.text();await writeFile(testFile('crowsnest-test-setup.sh'),installer);
const config=JSON.parse(installer.split("cat > collector.json <<'CROWSNEST_FILE_EOF'\n")[1].split('\nCROWSNEST_FILE_EOF')[0]);
const path='/api/ingest/'+config.hostId;
const payload={engineVersion:'29.0',containers:[{id:'a'.repeat(64),name:'web',image:'nginx:alpine',state:'running',health:'none',restarts:0,startedAt:'2026-09-29T10:00:00Z',finishedAt:'',environment:'secret must never be persisted'}]};
assert.equal((await call(path,{method:'POST',body:JSON.stringify(payload)})).status,403);
assert.equal((await call(path,{method:'POST',headers:{Authorization:'Bearer '+config.hostToken},body:'{}'})).status,400);
assert.equal((await call(path,{method:'POST',headers:{Authorization:'Bearer '+config.hostToken},body:JSON.stringify(payload)})).status,200);
const list=await (await call('/api/hosts',{headers:viewer})).json();
assert.equal(list.hosts.length,2);assert.equal(list.hosts.find(h=>h.id===config.hostId).snapshot.containers[0].health,'none');
assert.ok(!JSON.stringify(list).includes('token'));assert.ok(!JSON.stringify(list).includes('secret must'));
payload.containers[0].state='forged';
assert.equal((await call(path,{method:'POST',headers:{Authorization:'Bearer '+config.hostToken},body:JSON.stringify(payload)})).status,400);
assert.equal((await call(path,{method:'POST',headers:{Authorization:'Bearer '+config.hostToken},body:'x'.repeat(131073)})).status,400);
assert.equal((await call('/api/hosts',{method:'POST',headers:{...viewer,Origin:env.SITE_ORIGIN},body:JSON.stringify({name:'hedwig'})})).status,409);
// Custom domains must register hosts while retaining the configured collector endpoint.
const customOrigin='https://crowsnest.example.net';
env.DASHBOARD_ORIGIN=customOrigin;
const registerAt=(origin,headers,name)=>worker.fetch(new Request(origin+'/api/hosts',{method:'POST',headers,body:JSON.stringify({name})}),env);
for(const origin of [env.SITE_ORIGIN,customOrigin]) {
  for(const invalidOrigin of ['https://untrusted.example','null',origin===customOrigin?env.SITE_ORIGIN:customOrigin]) {
    assert.equal((await registerAt(origin,{...viewer,Origin:invalidOrigin},'rejected')).status,403);
  }
  assert.equal((await registerAt(origin,viewer,'missing-origin')).status,403);
  assert.equal((await registerAt(origin,{Origin:origin},'unsigned')).status,401);
}
const customResult=await registerAt(customOrigin,{...viewer,Origin:customOrigin},'custom-domain-host');
assert.equal(customResult.status,200);
assert.match(customResult.headers.get('Content-Disposition'),/crowsnest-setup\.sh/);
const customInstaller=await customResult.text();
const customConfig=JSON.parse(customInstaller.split("cat > collector.json <<'CROWSNEST_FILE_EOF'\n")[1].split('\nCROWSNEST_FILE_EOF')[0]);
assert.equal(customConfig.url,env.SITE_ORIGIN);
assert.equal(customConfig.serviceToken,env.COLLECTOR_SERVICE_TOKEN);
assert.equal((await call('/api/ingest/'+customConfig.hostId,{method:'POST',headers:{Authorization:'Bearer '+customConfig.hostToken},body:JSON.stringify({...payload,containers:[]})})).status,200);
console.log('Passed: private viewer routes, origin checks, token authentication, report limits, field allowlist, snapshot persistence, multiple hosts, duplicate registration, and installer generation.');
