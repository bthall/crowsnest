import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {testBucket} from './test-storage.mjs';
const source=await readFile('dist/server/index.js','utf8');
const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
const objects=new Map(),bucket=testBucket(objects,2);
const env={SITE_ORIGIN:'https://board.example.com',COLLECTOR_SERVICE_TOKEN:'test-service-token',BUCKET:bucket};
const viewer={'oai-authenticated-user-id':'owner',Origin:env.SITE_ORIGIN};
const call=(path,method='GET',data,headers=viewer)=>worker.fetch(new Request(env.SITE_ORIGIN+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),env);
const register=async name=>{
  const response=await call('/api/hosts','POST',{name,format:'setup'});
  assert.equal(response.status,200,'Registration must handle partial R2 pages');
  const data=await response.json();
  return JSON.parse(data.setupCommand.match(/cat > collector.json <<'CROWSNEST_FILE_EOF'\n([\s\S]*?)\nCROWSNEST_FILE_EOF/)[1]);
};
const config=await register('lighthouse');
const hostCount=objects.size;
for(const origin of [undefined,'http://board.example.com','https://board.example.com/path','https://board.example.com:8443']){
  env.SITE_ORIGIN=origin;
  const request=new Request('https://board.example.com/api/hosts',{method:'POST',headers:viewer,body:JSON.stringify({name:'misconfigured',format:'setup'})});
  assert.equal((await worker.fetch(request,env)).status,503);
  assert.equal(objects.size,hostCount,'Invalid runtime configuration must not create a host');
}
env.SITE_ORIGIN='https://board.example.com';
for(const name of ['rookery','harbor','workshop'])await register(name);
const id=config.hostId,path='/api/hosts/'+id,key='hosts/'+id+'.json';
const report={engineVersion:'29',containers:[]};
const deliver=token=>call('/api/ingest/'+id,'POST',report,{Authorization:'Bearer '+token});
// Malformed JSON shapes are client errors and cannot mutate registrations/settings.
for(const route of ['/api/hosts',path,path+'/collector',path+'/maintenance','/api/notifications']) {
  const method=route===path || route==='/api/notifications'?'PATCH':'POST';
  for(const data of [null,[],true,1,'text'])assert.equal((await call(route,method,data)).status,400,route);
}
assert.equal((await deliver(config.hostToken)).status,200);
const invalidUtf8=Buffer.concat([Buffer.from('{"engineVersion":"29","containers":[],"extra":"'),Buffer.from([255]),Buffer.from('"}')]);
assert.equal((await worker.fetch(new Request(env.SITE_ORIGIN+'/api/ingest/'+id,{method:'POST',headers:{Authorization:'Bearer '+config.hostToken},body:invalidUtf8}),env)).status,400);
// Interleave real API operations just before the outer conditional write.
const originalPut=bucket.put;
function interleave(operation) {
  let pending=true;
  bucket.put=async(...args)=>{
    if(pending && args[0]===key && args[2]?.onlyIf){pending=false;await operation();}
    return originalPut(...args);
  };
}
let replacement;
interleave(async()=>{const r=await call(path+'/collector','POST',{format:'config'});assert.equal(r.status,200);replacement=await r.json();});
assert.equal((await call(path,'PATCH',{name:'discarded-name'})).status,409,'Rename cannot overwrite newly issued credentials');
assert.equal(JSON.parse(objects.get(key)).name,'lighthouse');
assert.ok(JSON.parse(objects.get(key)).pendingTokenHash);
interleave(async()=>assert.equal((await call(path,'PATCH',{name:'harbor-watch'})).status,200));
assert.equal((await call(path+'/collector','POST',{format:'config'})).status,409,'Credential issuance cannot overwrite a newer rename');
assert.equal(JSON.parse(objects.get(key)).name,'harbor-watch');
interleave(async()=>assert.equal((await call(path,'PATCH',{name:'crow-watch'})).status,200));
assert.equal((await deliver(replacement.hostToken)).status,409,'Token activation must retry after a concurrent rename');
assert.equal((await deliver(replacement.hostToken)).status,200);
assert.equal(JSON.parse(objects.get(key)).name,'crow-watch');
assert.equal((await deliver(config.hostToken)).status,403);
// A stale promotion cannot recreate a registration deleted during ingestion.
bucket.put=originalPut;
replacement=await (await call(path+'/collector','POST',{format:'config'})).json();
interleave(async()=>assert.equal((await call(path,'DELETE',{confirmName:'crow-watch'})).status,200));
assert.equal((await deliver(replacement.hostToken)).status,409);
assert.equal(objects.has(key),false);
assert.equal((await deliver(replacement.hostToken)).status,404);
bucket.put=originalPut;
// Single-host activity uses two reads rather than a scan through the fleet.
const other=JSON.parse([...objects.entries()].find(([k])=>k.startsWith('hosts/'))[1]);
let reads=0,lists=0;
const originalGet=bucket.get,originalList=bucket.list;
bucket.get=async(...args)=>{reads++;return originalGet(...args);};
bucket.list=async(...args)=>{lists++;return originalList(...args);};
assert.equal((await call('/api/history?host='+other.id)).status,200);
assert.equal(reads,2);assert.equal(lists,0);
assert.equal((await call('/api/history?host=00000000-0000-4000-8000-000000000000')).status,404);
// Host polling overlaps independent storage reads with a fixed concurrency ceiling.
env.BUCKET=testBucket(objects,20);
for(let n=0;n<14;n++){
  const fixtureId='00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  objects.set('hosts/'+fixtureId+'.json',JSON.stringify({id:fixtureId,name:'fixture-'+n,createdAt:new Date().toISOString()}));
}
let active=0,peak=0;
const get=env.BUCKET.get;
env.BUCKET.get=async(...args)=>{
  active++;peak=Math.max(peak,active);
  try{await new Promise(resolve=>setTimeout(resolve,1));return await get(...args);}finally{active--;}
};
const hosts=(await (await call('/api/hosts')).json()).hosts;
assert.equal(hosts.length,17);assert.ok(peak>1 && peak<=10,'Polling must use bounded parallel reads');
assert.ok(!JSON.stringify(hosts).includes('tokenHash'));
// A genuinely full fleet is rejected even when storage returns small pages.
env.BUCKET=testBucket(objects,7);
for(let n=14;n<97;n++){
  const fixtureId='00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  objects.set('hosts/'+fixtureId+'.json',JSON.stringify({id:fixtureId,name:'fixture-'+n,createdAt:new Date().toISOString()}));
}
assert.equal((await call('/api/hosts','POST',{name:'over-limit',format:'setup'})).status,409);
console.log('Passed: JSON/UTF-8 rejection, paginated registration, credential/rename/removal races, direct activity reads, and bounded parallel fleet polling.');
