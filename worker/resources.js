// Embedded in the Worker. Five-minute windows retain their latest report, not an average.
const RESOURCE_WINDOW = 300000;
const RESOURCE_RETENTION = 86400000;
const RESOURCE_MAX_BYTES = 2097152;
const RESOURCE_STATES = new Set(['complete','warming','partial','unavailable','unsupported','report_limit']);
function validatedResources(value) {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('Invalid resources');
  const number=(key,max,integer=false)=>{
    const n=value[key];
    if(n===null)return null;
    if(typeof n!=='number' || !Number.isFinite(n) || n<0 || n>max || integer && !Number.isSafeInteger(n))throw new Error('Invalid resource measurement');
    return n;
  };
  return {cpuPercent:number('cpuPercent',1000000),memoryBytes:number('memoryBytes',Number.MAX_SAFE_INTEGER,true),memoryLimitBytes:number('memoryLimitBytes',Number.MAX_SAFE_INTEGER,true),sampleSeconds:number('sampleSeconds',120)};
}
function workloadResources(report) {
  if(!report.resourceSampling)return null;
  const running=report.containers.filter(c=>c.state==='running');
  const sum=key=>{
    if(running.some(c=>c.resources?.[key]==null))return null;
    const value=running.reduce((total,c)=>total+c.resources[key],0);
    return Number.isFinite(value) && value<=Number.MAX_SAFE_INTEGER?value:null;
  };
  return {cpuPercent:sum('cpuPercent'),memoryBytes:sum('memoryBytes'),runningContainers:running.length,sampling:report.resourceSampling};
}
function retainedResourceSamples(samples,now) {
  return samples.filter(s=>Number.isFinite(Date.parse(s.at)) && Date.parse(s.at)>now-RESOURCE_RETENTION && Date.parse(s.at)<=now).slice(-288);
}
async function recordResources(bucket,id,report) {
  const workload=workloadResources(report);
  if(!workload)return;
  const now=Date.parse(report.receivedAt), key='resources/'+id+'.json';
  // Conditional writes preserve a newer report if hosted ingests overlap.
  for(let attempt=0;attempt<3;attempt++) {
    const object=await bucket.get(key), samples=retainedResourceSamples(object?await object.json():[],Date.now());
    const window=Math.floor(now/RESOURCE_WINDOW);
    const entry={at:report.receivedAt,...workload,containers:report.containers.filter(c=>c.state==='running').map(c=>[c.id,c.resources?.cpuPercent??null,c.resources?.memoryBytes??null])};
    const index=samples.findIndex(s=>Math.floor(Date.parse(s.at)/RESOURCE_WINDOW)===window);
    if(index>=0){if(Date.parse(samples[index].at)>now)return;samples[index]=entry;}else samples.push(entry);
    samples.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
    const slice=samples.slice(-288);
    let payload=JSON.stringify(slice);
    if(new TextEncoder().encode(payload).length>RESOURCE_MAX_BYTES) {
      const items=slice.map(s=>JSON.stringify(s)), encoder=new TextEncoder();
      let total=2, count=0;
      for(let i=items.length-1;i>=0;i--) {
        const itemSize=encoder.encode(items[i]).length+(count>0?1:0);
        if(total+itemSize>RESOURCE_MAX_BYTES)break;
        total+=itemSize; count++;
      }
      payload='['+items.slice(-count).join(',')+']';
    }
    const written=await bucket.put(key,payload,{onlyIf:object?{etagMatches:object.etag}:{etagDoesNotMatch:'*'}});
    if(written)return;
  }
  throw new Error('Resource history changed');
}
function resourceReadings(samples,container) {
  if(!container)return samples.map(({containers,...sample})=>sample);
  const readings=samples.map(s=>{
    const found=s.containers?.find(c=>c[0]===container);
    return {at:s.at,cpuPercent:found?.[1]??null,memoryBytes:found?.[2]??null,sampling:found?s.sampling:'not_reported',present:!!found};
  });
  const first=readings.findIndex(s=>s.present);
  if(first<0)return [];
  return readings.slice(first).map(({present,...sample})=>sample);
}
