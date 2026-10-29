import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {testBucket} from './test-storage.mjs';
const source=await readFile('dist/server/index.js','utf8');
const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
const helpers=await readFile('worker/resources.js','utf8');
const {recordResources,retainedResourceSamples}=await import('data:text/javascript;base64,'+Buffer.from(helpers+'\nexport {recordResources,retainedResourceSamples};').toString('base64'));
const objects=new Map(), bucket=testBucket(objects);
const env={SITE_ORIGIN:'https://board.example.com',COLLECTOR_SERVICE_TOKEN:'test-service-token',BUCKET:bucket};
const viewer={'oai-authenticated-user-id':'owner',Origin:env.SITE_ORIGIN};
const call=(path,method='GET',data,headers=viewer)=>worker.fetch(new Request(env.SITE_ORIGIN+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),env);
const setup=await (await call('/api/hosts','POST',{name:'lighthouse',format:'setup'})).json();
const config=JSON.parse(setup.setupCommand.match(/cat > collector.json <<'CROWSNEST_FILE_EOF'\n([\s\S]*?)\nCROWSNEST_FILE_EOF/)[1]);
const id=config.hostId, auth={Authorization:'Bearer '+config.hostToken}, path='/api/resources?host='+id;
const c={id:'a'.repeat(64),name:'web',image:'nginx',state:'running',health:'healthy',restarts:0,startedAt:'',finishedAt:''};
const report={engineVersion:'29',containers:[c]};
const send=()=>call('/api/ingest/'+id,'POST',report,auth);
assert.equal((await send()).status,200);assert.deepEqual((await (await call(path)).json()).samples,[]);
assert.equal((await call(path,'GET',undefined,{})).status,401);
assert.equal((await call('/api/resources')).status,400);
assert.equal((await call('/api/resources?host=00000000-0000-4000-8000-000000000000')).status,404);
report.resourceSampling='complete';c.resources={cpuPercent:250,memoryBytes:800,memoryLimitBytes:2000,sampleSeconds:30,networks:'private data'};
assert.equal((await send()).status,200);
let samples=(await (await call(path)).json()).samples;
assert.equal(samples.length,1);assert.equal(samples[0].cpuPercent,250);assert.equal(samples[0].memoryBytes,800);
const containerPath=path+'&container='+c.id;
let readings=(await (await call(containerPath)).json()).samples;
assert.equal(readings[0].cpuPercent,250);assert.equal(readings[0].memoryBytes,800);
assert.ok(!JSON.stringify(samples).includes(c.id),'Host aggregate responses omit per-container storage');
assert.equal((await call(path+'&container=../private')).status,400);
assert.equal((await call(containerPath,'GET',undefined,auth)).status,401);
assert.ok(!objects.get('snapshots/'+id+'.json').includes('private data'));
for(const [key,values] of Object.entries({cpuPercent:[-1,'1',1000001],memoryBytes:[-1,1.5,Number.MAX_SAFE_INTEGER+1],sampleSeconds:[121,'NaN'],memoryLimitBytes:[true,{}]})) {
  const previous=c.resources[key];
  for(const value of values){c.resources[key]=value;const response=await send();assert.equal(response.status,400,key+' '+value);}
  c.resources[key]=previous;
}
report.resourceSampling='invented';assert.equal((await send()).status,400);report.resourceSampling='partial';
report.containers=[c,{...c,id:'b'.repeat(64),resources:undefined}];assert.equal((await send()).status,200);
samples=(await (await call(path)).json()).samples;assert.equal(samples.length,1);assert.equal(samples[0].cpuPercent,null);assert.equal(samples[0].memoryBytes,null,'Partial measurements do not understate totals');
report.containers=[];report.resourceSampling='complete';await send();samples=(await (await call(path)).json()).samples;assert.equal(samples[0].cpuPercent,0);assert.equal(samples[0].memoryBytes,0);
const now=Date.now();
const history=Array.from({length:400},(_,i)=>({at:new Date(now-(399-i)*300000).toISOString(),cpuPercent:i,memoryBytes:i}));
assert.equal(retainedResourceSamples(history,now).length,288);
objects.set('resources/'+id+'.json',JSON.stringify(history));
assert.equal((await (await call(path)).json()).samples.length,288);
const latest={...report,receivedAt:new Date(now).toISOString()};
await recordResources(bucket,id,latest);const newer=objects.get('resources/'+id+'.json');
await recordResources(bucket,id,{...latest,receivedAt:new Date(now-1).toISOString()});
assert.equal(objects.get('resources/'+id+'.json'),newer,'An overlapping older sample cannot replace a newer one');
// Force a first-write race; the helper must re-read instead of overwriting the winner.
const raceKey='resources/race.json';let collided=false;
const racing={...bucket,async put(key,value,options){if(!collided){collided=true;objects.set(key,JSON.stringify([{at:new Date(now+1).toISOString(),cpuPercent:99,memoryBytes:99} ]));return null;}return bucket.put(key,value,options);}};
await recordResources(racing,'race',{...latest,receivedAt:new Date(now+2).toISOString()});
assert.equal(JSON.parse(objects.get(raceKey)).length,1);
// ID-scoped readings cannot inherit a replaced container's same-name history.
objects.set('resources/'+id+'.json',JSON.stringify([
 {at:new Date(now-600000).toISOString(),containers:[[c.id,10,100]],sampling:'complete'},
 {at:new Date(now-300000).toISOString(),containers:[['b'.repeat(64),20,200]],sampling:'complete'},
 {at:new Date(now).toISOString(),containers:[[c.id,null,300]],sampling:'warming'},
]));
readings=(await (await call(containerPath)).json()).samples;
assert.deepEqual(readings.map(s=>s.cpuPercent),[10,null,null]);assert.deepEqual(readings.map(s=>s.memoryBytes),[100,null,300]);
const replaced=(await (await call(path+'&container='+'b'.repeat(64))).json()).samples;
assert.deepEqual(replaced.map(s=>s.memoryBytes),[200,null]);
assert.deepEqual((await (await call(path+'&container='+'f'.repeat(64))).json()).samples,[]);
// A maximally populated host cannot grow an unbounded R2 object.
const denseContainers=Array.from({length:250},(_,i)=>({id:String(i+1).padStart(64,'0'),state:'running',resources:{cpuPercent:1,memoryBytes:1048576}}));
const densePoints=denseContainers.map(c=>[c.id,1,1048576]);
objects.set('resources/dense.json',JSON.stringify(Array.from({length:288},(_,i)=>({at:new Date(now-(287-i)*300000).toISOString(),cpuPercent:250,memoryBytes:262144000,containers:densePoints}))));
await recordResources(bucket,'dense',{receivedAt:new Date(now).toISOString(),resourceSampling:'complete',containers:denseContainers});
assert.ok(Buffer.byteLength(objects.get('resources/dense.json'))<=2097152);
const bounded=JSON.parse(objects.get('resources/dense.json'));assert.ok(bounded.length<288);assert.equal(bounded.at(-1).containers.length,250);
// Both Worker and Node byte counters must retain the same maximal UTF-8 suffix.
// Bound serialization volume as well: dense overflow must not repeatedly encode
// nearly the entire history while dropping one sample at a time.
const unicodePoints=densePoints.map((point,i)=>['界😀'.repeat(12)+'-'+i,...point.slice(1)]);
const overflowHistory=Array.from({length:288},(_,i)=>({at:new Date(now-(287-i)*300000).toISOString(),cpuPercent:250,memoryBytes:262144000,containers:unicodePoints}));
async function overflowResult(withBuffer) {
  let serialized=0,initial=0,written;
  const json={parse:JSON.parse,stringify(value){const text=JSON.stringify(value);if(!initial)initial=text.length;serialized+=text.length;return text;}};
  const context={Date,TextEncoder,JSON:json,...(withBuffer?{Buffer}:{})};
  const record=vm.runInNewContext(helpers+'\nrecordResources',context);
  const storage={async get(){return {etag:'overflow-fixture',async json(){return overflowHistory;}};},async put(_key,payload){written=payload;return {};}};
  await record(storage,'overflow',{receivedAt:new Date(now).toISOString(),resourceSampling:'complete',containers:denseContainers});
  assert.ok(serialized<=initial*3,'Overflow serialization work must stay proportional to the input size');
  assert.ok(Buffer.byteLength(written)<=2097152,'History must be bounded by UTF-8 bytes, not character count');
  const retained=JSON.parse(written),start=overflowHistory.findIndex(sample=>sample.at===retained[0].at);
  assert.ok(start>0);
  assert.deepEqual(retained.map(sample=>sample.at),overflowHistory.slice(start).map(sample=>sample.at));
  assert.ok(Buffer.byteLength(JSON.stringify([overflowHistory[start-1],...retained]))>2097152,'Overflow must retain the largest suffix that fits');
  return written;
}
assert.equal(await overflowResult(true),await overflowResult(false),'Buffer and TextEncoder histories must match');
// Group changes preserve credential rotation and old name-only clients preserve groups.
assert.equal((await call('/api/hosts/'+id,'PATCH',{name:'lighthouse',group:'Production'})).status,200);
assert.equal((await (await call('/api/hosts')).json()).hosts[0].group,'Production');
assert.ok((await (await call('/api/history?group=Production')).json()).events.length>0);
assert.equal((await (await call('/api/history?group=Home')).json()).events.length,0);
assert.equal((await (await call('/api/history?group=_ungrouped')).json()).events.length,0);
assert.equal((await call('/api/history?group=unsafe/slash')).status,400);
await call('/api/hosts/'+id+'/collector','POST',{format:'config'});const pending=JSON.parse(objects.get('hosts/'+id+'.json')).pendingTokenHash;
await call('/api/hosts/'+id,'PATCH',{name:'renamed'});const host=JSON.parse(objects.get('hosts/'+id+'.json'));
assert.equal(host.group,'Production');assert.equal(host.pendingTokenHash,pending);
for(const group of [null,{},'x'.repeat(33),'unsafe/slash'])assert.equal((await call('/api/hosts/'+id,'PATCH',{name:'renamed',group})).status,400);
assert.equal((await call('/api/hosts/'+id,'DELETE',{confirmName:'renamed'})).status,200);assert.ok(!objects.has('resources/'+id+'.json'));
console.log('Passed: optional measurements, allowlisted values, private history, partial totals, empty workloads, retention, conditional writes, grouping, credentials, and removal.');
