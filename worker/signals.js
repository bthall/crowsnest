// Server-observed windows: never infer a duration or restart rate from a lifetime counter.
const SIGNAL_DEFAULTS = {cpuAlerts:false,cpuThreshold:150,memoryAlerts:false,memoryMiB:1024,resourceMinutes:5,restartBursts:false,restartCount:5,restartWindowMinutes:10,cooldownMinutes:10};
const SIGNAL_NUMBERS = {cpuThreshold:[1,100000],memoryMiB:[1,1048576],restartCount:[2,100]};
const SIGNAL_CHOICES = {resourceMinutes:[1,5,10,15],restartWindowMinutes:[5,10,15,30],cooldownMinutes:[5,10,15,30,60]};
function validSignalSettings(data) {
  return ['cpuAlerts','memoryAlerts','restartBursts'].every(k=>data[k]===undefined || typeof data[k]==='boolean') &&
    Object.entries(SIGNAL_NUMBERS).every(([k,[min,max]])=>data[k]===undefined || Number.isSafeInteger(data[k]) && data[k]>=min && data[k]<=max) &&
    Object.entries(SIGNAL_CHOICES).every(([k,values])=>data[k]===undefined || values.includes(data[k]));
}
function signalPolicy(settings) {
  return JSON.stringify([settings.enabled,...Object.keys(SIGNAL_DEFAULTS).filter(k=>k!=='cooldownMinutes').map(k=>settings[k])]);
}
function signalKind(key) {return ({cpu:'cpuAlerts',memory:'memoryAlerts',burst:'restartBursts'})[key.split(':')[0]];}
function signalContainer(key) {return signalKind(key)?key.split(':')[1]:null;}
async function recordSignals(bucket,host,report,settings) {
  const key='signals/'+host.id+'.json', at=Date.parse(report.receivedAt), maintenance=await hostMaintenance(bucket,host.id);
  const policy=signalPolicy(settings), paused=Date.parse(maintenance.until)>at;
  for(let attempt=0;attempt<3;attempt++) {
    const object=await bucket.get(key), saved=object?await object.json():{};
    if(saved.at>=at)return;
    if(!object && !settings.cpuAlerts && !settings.memoryAlerts && !settings.restartBursts)return;
    const continuous=saved.policy===policy && saved.maintenanceRevision===maintenance.revision && at-saved.at<=120000 && !saved.paused && !paused && settings.enabled;
    const containers={};
    for(const c of report.containers) {
      const old=continuous?saved.containers?.[c.id]:null, running=c.state==='running';
      const cpu=running && c.resources?.sampleSeconds>0?c.resources.cpuPercent:null, memory=running?c.resources?.memoryBytes:null;
      const track={restarts:c.restarts,windowSince:old?.windowSince??at};
      for(const [kind,high] of [['cpu',settings.cpuAlerts && cpu!=null && cpu>settings.cpuThreshold],['memory',settings.memoryAlerts && memory!=null && memory>settings.memoryMiB*1048576]])track[kind+'Since']=!paused && settings.enabled && high?(old?.[kind+'Since']??at):null;
      const reset=!old || c.restarts<old.restarts;
      track.bursts=reset?[]:(old.bursts||[]).filter(e=>e.at>at-settings.restartWindowMinutes*60000);
      if(reset)track.windowSince=at;
      if(!reset && c.restarts>old.restarts) {
        const window=Math.floor(at/30000),last=track.bursts.at(-1);
        if(last && Math.floor(last.at/30000)===window){last.count+=c.restarts-old.restarts;last.at=at;}
        else track.bursts.push({at,count:c.restarts-old.restarts});
      }
      track.bursts=track.bursts.slice(-64);
      containers[c.id]=track;
    }
    const value={at,policy,paused,maintenanceRevision:maintenance.revision,containers};
    if(await bucket.put(key,JSON.stringify(value),{onlyIf:object?{etagMatches:object.etag}:{etagDoesNotMatch:'*'}}))return;
  }
  throw new Error('Alert observations changed');
}
function advancedIssues(snapshot,signals,settings) {
  const issues={},uncertain=new Set();
  if(!snapshot || Date.now()-Date.parse(snapshot.receivedAt)>120000)return {issues,uncertain};
  const at=Date.parse(snapshot.receivedAt), valid=signals?.at===at && signals.policy===signalPolicy(settings);
  for(const c of snapshot.containers) {
    const track=valid?signals.containers?.[c.id]:null;
    for(const [type,enabled,value,threshold] of [['cpu',settings.cpuAlerts,c.resources?.sampleSeconds>0?c.resources.cpuPercent:null,settings.cpuThreshold],['memory',settings.memoryAlerts,c.resources?.memoryBytes,settings.memoryMiB*1048576]]) {
      if(!enabled || c.state!=='running')continue;
      const key=type+':'+c.id;
      if(!track || value==null){uncertain.add(key);continue;}
      if(value>threshold) {
        if(track[type+'Since']!=null && at-track[type+'Since']>=settings.resourceMinutes*60000)issues[key]=c.name+': '+(type==='cpu'?'CPU above '+settings.cpuThreshold+'%':'memory above '+settings.memoryMiB+' MiB')+' for at least '+settings.resourceMinutes+' minute(s)';
        else uncertain.add(key);
      }
    }
    if(settings.restartBursts) {
      const key='burst:'+c.id;
      if(!track){uncertain.add(key);continue;}
      const count=track.bursts.filter(e=>e.at>at-settings.restartWindowMinutes*60000).reduce((n,e)=>n+e.count,0);
      if(count>=settings.restartCount)issues[key]=c.name+': at least '+settings.restartCount+' observed restarts in '+settings.restartWindowMinutes+' minutes';
      else if(at-track.windowSince<settings.restartWindowMinutes*60000)uncertain.add(key);
    }
  }
  return {issues,uncertain};
}
function notificationLink(env,hostId,containerId) {
  const origin=dashboardOrigin(env.DASHBOARD_ORIGIN)||dashboardOrigin(env.SITE_ORIGIN);
  if(!origin)return null;
  const url=new URL(origin+'/');
  if(hostId)url.searchParams.set('host',hostId);
  if(containerId)url.searchParams.set('container',containerId);
  return url.href;
}
