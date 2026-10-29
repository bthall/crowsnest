import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {testBucket} from './test-storage.mjs';

const release=JSON.parse(await readFile('collector/version.json','utf8'));
const source=await readFile('dist/server/index.js','utf8');
// A dashboard-only release must not advance the recommended collector version.
const changedDashboard=source.replace(/^const VERSION = '[^']+';/m,"const VERSION = '99.0.0';");
assert.notEqual(changedDashboard,source);
const worker=(await import('data:text/javascript;base64,'+Buffer.from(changedDashboard).toString('base64'))).default;
const objects=new Map();
const env={SITE_ORIGIN:'https://board.example',COLLECTOR_SERVICE_TOKEN:'test-service-token',BUCKET:testBucket(objects)};
const viewer={'oai-authenticated-user-id':'owner',Origin:env.SITE_ORIGIN};
const call=(path,method='GET',body,headers=viewer)=>worker.fetch(new Request(env.SITE_ORIGIN+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env);
const registration=await call('/api/hosts','POST',{name:'updater-check',format:'setup'});
assert.equal(registration.status,200);
const setup=await registration.json();
const config=JSON.parse(setup.setupCommand.match(/cat > collector.json <<'CROWSNEST_FILE_EOF'\n([\s\S]*?)\nCROWSNEST_FILE_EOF/)[1]);
const status={autoUpdates:false,lastAttempt:'2026-10-29T20:00:00Z',lastResult:'rolled_back',fromVersion:'0.11.1',toVersion:'0.11.2',rollback:'succeeded'};
const report={engineVersion:'29',containers:[],collectorVersion:release.version,collectorProtocol:release.protocol,updateStatus:{...status,token:'never-persist-this',path:'/private/config'}};
const ingest=body=>call('/api/ingest/'+config.hostId,'POST',body,{Authorization:'Bearer '+config.hostToken});
assert.equal((await ingest(report)).status,200);
const fleet=await (await call('/api/hosts')).json();
assert.equal(fleet.availableCollectorVersion,release.version);
assert.equal(fleet.collectorProtocol,release.protocol);
assert.deepEqual(fleet.hosts[0].snapshot.updateStatus,status);
assert.equal(fleet.hosts[0].snapshot.collectorProtocol,release.protocol);
assert.ok(!JSON.stringify(fleet).includes('never-persist-this'));
assert.ok(!JSON.stringify(fleet).includes('/private/config'));
// Older collectors without optional fields continue reporting.
assert.equal((await ingest({engineVersion:'29',containers:[]})).status,200);
for(const invalid of [null,[],{},true,{...status,autoUpdates:1},{...status,lastResult:'sudo failed: private-token'},{...status,fromVersion:'invalid'},{...status,lastAttempt:'not-a-date'},{...status,rollback:'pending'}]) {
  assert.equal((await ingest({...report,updateStatus:invalid})).status,400);
}
for(const protocol of [0,-1,1.5,'1',true,65536])assert.equal((await ingest({...report,collectorProtocol:protocol})).status,400);
assert.equal((await ingest({...report,collectorProtocol:release.protocol+1})).status,200,'A newer protocol must remain visible for the dashboard compatibility warning');

const board=await readFile('worker/board.js','utf8');
const versions=await readFile('worker/versions.js','utf8');
const context=vm.createContext({Date});
vm.runInContext(versions+"\nlet availableCollectorVersion='0.11.2', collectorProtocol=2, minimumCollectorProtocol=1, lastError='';\nconst hostState=host=>host.stale?'Stale':'Reporting'; const reportDate=value=>value;\n"+board.slice(board.indexOf('function collectorInfo('),board.indexOf('function syncHosts(')),context);
const host={snapshot:{collectorVersion:'0.11.1',collectorProtocol:1,updateStatus:status}};
assert.match(context.collectorInfo(host).text,/update available/);
vm.runInContext('minimumCollectorProtocol=2',context);
assert.match(context.collectorInfo(host).text,/update required for protocol compatibility/);
assert.match(context.collectorInfo({snapshot:{collectorVersion:'0.11.1',collectorProtocol:3}}).text,/dashboard update required/);
assert.match(context.collectorInfo({snapshot:{collectorVersion:'0.11.1'}}).text,/update available/,'A legacy protocol is unknown, not an invented required upgrade');
assert.match(context.updaterInfo(host).policy,/disabled/);
assert.match(context.updaterInfo(host).result,/previous deployment restored/);
assert.match(context.updaterInfo({...host,stale:true}).policy,/last reported/);
assert.match(context.updaterInfo({snapshot:{updateStatus:{...status,lastResult:'rollback_failed',rollback:'failed',autoUpdates:true}}}).result,/host intervention required/);
assert.match(context.updaterInfo({snapshot:{}}).policy,/not reported/);
console.log('Passed: independent collector version, protocol compatibility, optional bounded updater metadata, public-field allowlist and truthful update/rollback UI.');
