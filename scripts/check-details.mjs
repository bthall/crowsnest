import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const version=JSON.parse(await readFile('package.json','utf8')).version;
const helpers=await readFile('worker/versions.js','utf8');
const {validCollectorVersion,compareCollectorVersions}=await import('data:text/javascript;base64,'+Buffer.from(helpers+'\nexport {validCollectorVersion,compareCollectorVersions};').toString('base64'));
for(const v of ['0.7.0','1.0.0-alpha.1','1.0.0-rc.10+build.001','999999999999999999.0.0'])assert.ok(validCollectorVersion(v));
for(const v of ['',null,7,'v0.7.0','01.2.3','1.02.3','1.2.03','1.0.0-01','1.0.0-alpha..1','1.0.0+','1.0.0\n','1.0.0<script>','x'.repeat(65)])assert.ok(!validCollectorVersion(v),String(v));
const ordered=['1.0.0-alpha','1.0.0-alpha.1','1.0.0-alpha.beta','1.0.0-beta','1.0.0-beta.2','1.0.0-beta.11','1.0.0-rc.1','1.0.0','1.0.1','1.9.0','1.10.0','2.0.0'];
for(let i=1;i<ordered.length;i++){assert.equal(compareCollectorVersions(ordered[i-1],ordered[i]),-1);assert.equal(compareCollectorVersions(ordered[i],ordered[i-1]),1);}
assert.equal(compareCollectorVersions('1.0.0+first','1.0.0+second'),0);assert.equal(compareCollectorVersions(undefined,version),null);
const source=await readFile('dist/server/index.js','utf8');
const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
const objects=new Map();
const env={SITE_ORIGIN:'https://board.example.com',COLLECTOR_SERVICE_TOKEN:'test-service-token',BUCKET:{async get(k){const v=objects.get(k);return v===undefined?null:{json:async()=>JSON.parse(v)};},async put(k,v){objects.set(k,v);},async delete(k){objects.delete(k);},async list({prefix}){return{objects:[...objects.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key})),truncated:false};}}};
const viewer={'oai-authenticated-user-id':'owner',Origin:env.SITE_ORIGIN};
const call=(path,method='GET',data,headers=viewer)=>worker.fetch(new Request(env.SITE_ORIGIN+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),env);
const setup=await (await call('/api/hosts','POST',{name:'lighthouse',format:'setup'})).json();
const config=JSON.parse(setup.setupCommand.match(/cat > collector.json <<'DOCKER_WATCH_FILE_EOF'\n([\s\S]*?)\nDOCKER_WATCH_FILE_EOF/)[1]);
const host=config.hostId, id='a'.repeat(64), other='b'.repeat(64), ingest='/api/ingest/'+host, auth={Authorization:'Bearer '+config.hostToken};
const report={engineVersion:'29',containers:[{id,name:'web',image:'nginx',state:'running',health:'healthy',restarts:0,startedAt:'',finishedAt:''}]};
const send=()=>call(ingest,'POST',report,auth), historyPath='/api/history?host='+host+'&container='+id;
assert.equal((await send()).status,200,'Legacy report accepted');
let data=await (await call('/api/hosts')).json();assert.equal(data.availableCollectorVersion,version);assert.equal(data.hosts[0].snapshot.collectorVersion,undefined);
for(const invalid of [null,{},'',7,'v0.7.0','01.2.3','1.0.0-01','x'.repeat(65)]){report.collectorVersion=invalid;assert.equal((await send()).status,400);}
report.collectorVersion=version;await send();
data=await (await call('/api/hosts')).json();assert.equal(data.hosts[0].snapshot.collectorVersion,version);assert.ok(!JSON.stringify(data).includes(config.hostToken));
const update=await (await call('/api/hosts/'+host+'/collector','POST',{format:'update'})).json();assert.equal(update.collectorVersion,version);assert.ok(update.updateCommand.includes("COLLECTOR_VERSION = '"+version+"'"));assert.ok(!update.updateCommand.includes('__APP_VERSION__'));
for(const headers of [{},auth,{Authorization:'Bearer '+env.COLLECTOR_SERVICE_TOKEN}])assert.equal((await call(historyPath,'GET',undefined,headers)).status,401);
for(const path of ['/api/history?container='+id,'/api/history?host='+host+'&container=../x','/api/history?host=bad&container='+id])assert.equal((await call(path)).status,400);
assert.equal((await call('/api/history?host=00000000-0000-4000-8000-000000000000&container='+id)).status,404);
const key='history/'+host+'.json', at=new Date().toISOString();
objects.set(key,JSON.stringify([
 {kind:'status',text:'web: running/healthy → running/unhealthy',at},
 {kind:'restart',text:'web: 2 additional restart(s)',at},
 {kind:'status',text:'web-other: running/healthy → running/unhealthy',at},
 {kind:'host',text:'web: host event must not be treated as container activity',at},
 {kind:'status',text:'web: older replacement with same name',containerId:other,containerName:'web',at},
 {kind:'status',text:'web: expired',at:'2000-01-01T00:00:00Z'},
]));
let events=await (await call(historyPath)).json();assert.equal(events.events.length,2);assert.equal(events.legacyMatches,true);assert.ok(events.events.every(e=>e.matchedBy==='name'));
report.containers[0].health='unhealthy';report.containers[0].restarts=2;report.containers[0].image='nginx:alpine';await send();
events=await (await call(historyPath)).json();assert.equal(events.events.filter(e=>e.matchedBy==='id').length,3);assert.ok(events.events.some(e=>e.kind==='restart'&&e.containerId===id));
report.containers[0].name='renamed-web';await send();events=await (await call(historyPath)).json();assert.ok(events.events.some(e=>e.text==='Renamed from web to renamed-web'));assert.ok(events.events.some(e=>e.text.includes('image changed')),'ID matching survives rename');assert.equal(events.legacyMatches,false,'Name-only legacy events cannot be attributed after rename');
report.containers=[{...report.containers[0],id:other,name:'renamed-web'}];await send();
events=await (await call(historyPath)).json();assert.ok(events.events.some(e=>e.text==='renamed-web disappeared'));assert.ok(!events.events.some(e=>e.containerId===other),'Same-name replacement is a different container');
const replacement=await (await call('/api/history?host='+host+'&container='+other)).json();assert.ok(replacement.events.some(e=>e.text==='renamed-web appeared'));assert.ok(!replacement.events.some(e=>e.containerId===id));
console.log('Passed: strict optional collector versions, SemVer precedence, build stamping, private history filtering, retention, legacy attribution, rename/replacement identity, and no credential exposure.');
