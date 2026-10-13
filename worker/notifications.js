// Embedded by build-board.mjs. Destination and credentials are operator-managed runtime values.
function ntfyDestination(value) {
  try {
    const url=new URL(value), host=url.hostname.toLowerCase();
    if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash || (url.port && url.port!=='443') || !host.includes('.') || /[\[\]:]/.test(host) || /^[\d.]+$/.test(host) || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) || !/^\/[a-zA-Z0-9_-]{1,64}$/.test(url.pathname))return null;
    const topic=url.pathname.slice(1);
    if(['app','docs','static','file','v1','_matrix'].includes(topic))return null;
    return {url:url.href,origin:url.origin,topic};
  }catch{return null;}
}
async function notificationSettings(env) {
  const object=await env.BUCKET.get('notifications/settings.json');
  return {...{enabled:env.NTFY_ENABLED==='true',recoveries:true,hostReports:true,unhealthy:true,restarting:true,dead:true,staleMinutes:2,priority:4},...object?await object.json():{}};
}
async function hostMaintenance(bucket,id) {
  const object=await bucket.get('maintenance/hosts/'+id+'.json');
  return object?await object.json():{};
}
async function notificationStatus(env) {
  const settings=await notificationSettings(env), destination=ntfyDestination(env.NTFY_URL);
  const object=await env.BUCKET.get('notifications/delivery.json');
  const delivery=object?await object.json():{};
  const sweep=await env.BUCKET.get('notifications/sweep.json'), lastSweep=sweep?await sweep.json():{};
  return {...settings,configured:!!destination,destination:destination?.url||null,authenticated:!!env.NTFY_TOKEN,...delivery,lastSweepAt:lastSweep.at||null};
}
function notificationIssues(host,snapshot,now,policy) {
  if(!snapshot)return (!policy || policy.hostReports) && now-Date.parse(host.createdAt)>600000?{report:'Awaiting the first collector report'}:{};
  if(now-Date.parse(snapshot.receivedAt)>120000) {
    const minutes=policy?.staleMinutes||2;
    return (!policy || policy.hostReports) && now-Date.parse(snapshot.receivedAt)>minutes*60000?{report:'No collector report for more than '+(minutes===2?'two':minutes)+' minutes'}:{};
  }
  const issues={};
  for(const c of snapshot.containers)if(issueKinds(c).some(kind=>!policy || policy[kind]))issues[c.id]=c.name+': '+c.state+'/'+c.health;
  return issues;
}
function issueKinds(container) {
  return [...container.health==='unhealthy'?['unhealthy']:[],...['restarting','dead'].includes(container.state)?[container.state]:[]];
}
function deliveredIssueKinds(id,text,saved) {
  if(id==='report')return ['hostReports'];
  if(saved.kinds?.[id])return saved.kinds[id];
  const match=text.match(/: ([^/]+)\/([^/]+)$/);
  return match?issueKinds({state:match[1],health:match[2]}):[];
}
async function publishNtfy(env,destination,message,title,priority=3,alert=false) {
  const authorization=env.NTFY_TOKEN?{Authorization:'Bearer '+env.NTFY_TOKEN}:{};
  const click=dashboardOrigin(env.DASHBOARD_ORIGIN)||dashboardOrigin(env.SITE_ORIGIN);
  let response;
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),5000);
  try {
    response=await fetch(destination.origin+'/',{method:'POST',redirect:'manual',signal:controller.signal,headers:{'Content-Type':'application/json',...authorization},body:JSON.stringify({topic:destination.topic,title,message,priority,tags:[alert?'warning':'white_check_mark'],...(click?{click}: {})})});
    if(!response.ok)throw new Error('HTTP '+response.status);
    // An HTTP success alone does not prove that ntfy accepted the message.
    const acknowledgement=await readJson(response,16384);
    if(acknowledgement.event!=='message' || acknowledgement.topic!==destination.topic || typeof acknowledgement.id!=='string')throw new Error('Invalid acknowledgement');
    await env.BUCKET.put('notifications/delivery.json',JSON.stringify({lastSuccessAt:new Date().toISOString(),lastError:null}));
  }catch(error) {
    const reason=/^HTTP \d{3}$/.test(error.message)?error.message:error.message==='Invalid acknowledgement'?error.message:'Connection or acknowledgement failed';
    console.error('ntfy delivery failed',reason,error?.name);
    if(reason==='Connection or acknowledgement failed') {
      let detail=String(error?.message||'Unknown transport error');
      for(const secret of [env.NTFY_TOKEN,env.COLLECTOR_SERVICE_TOKEN])if(secret)detail=detail.replaceAll(secret,'[redacted]');
      console.error('ntfy transport detail',detail.slice(0,240));
    }
    const old=await env.BUCKET.get('notifications/delivery.json');
    const previous=old?await old.json():{};
    await env.BUCKET.put('notifications/delivery.json',JSON.stringify({...previous,lastError:reason,lastFailureAt:new Date().toISOString()}));
    throw new Error(reason);
  }finally{clearTimeout(timer);}
}
async function notifyHost(env,host,snapshot,settings,now=Date.now()) {
  const destination=ntfyDestination(env.NTFY_URL);
  if(!settings.enabled || !destination)return {sent:0,pending:0};
  const maintenance=await hostMaintenance(env.BUCKET,host.id);
  // Keep the delivered baseline intact: changes that clear entirely during a pause
  // must not generate recovery messages for alerts that were never sent.
  if(Date.parse(maintenance.until)>now)return {sent:0,pending:0};
  const key='notifications/hosts/'+host.id+'.json', object=await env.BUCKET.get(key);
  const saved=object?await object.json():{delivered:{}};
  // A newly configured destination gets its own baseline.
  if(saved.destination!==destination.url){saved.delivered={};saved.destination=destination.url;saved.nextAttemptAt=0;saved.attempts=0;}
  if(saved.maintenanceRevision!==maintenance.revision){saved.nextAttemptAt=0;saved.attempts=0;saved.maintenanceRevision=maintenance.revision;}
  // Disabling an alert category silently retires its delivered baseline.
  // It must not announce that a problem recovered because the policy changed.
  for(const [id,text] of Object.entries(saved.delivered)) {
    const kinds=deliveredIssueKinds(id,text,saved);
    if(!kinds.length || !kinds.some(kind=>settings[kind]))delete saved.delivered[id];
  }
  const current=notificationIssues(host,snapshot,now,settings), added=[], removed=[];
  for(const [id,text] of Object.entries(current))if(saved.delivered[id]!==text)added.push(text);
  for(const [id,text] of Object.entries(saved.delivered))if(!current[id])removed.push(id==='report'?(snapshot?'Collector reporting resumed':'Report warning cleared'):text.split(': ')[0]+': no longer in an alert state or no longer reported; check the dashboard');
  // Suppress stale container recovery messages while their host cannot report.
  const stale=!snapshot || now-Date.parse(snapshot.receivedAt)>120000;
  if(stale)removed.length=0;
  // Retain delivered container alerts until a fresh report can resolve them.
  const baseline=stale?{...saved.delivered,...current}:current;
  const kinds={...stale?saved.kinds||{}:{},...Object.fromEntries((snapshot?.containers||[]).filter(c=>current[c.id]).map(c=>[c.id,issueKinds(c)])),...current.report?{report:['hostReports']}: {}};
  const lines=[...added.map(x=>'Alert: '+x),...(settings.recoveries?removed.map(x=>'Cleared: '+x):[])];
  if(!lines.length){saved.delivered=baseline;saved.kinds=kinds;saved.attempts=0;await env.BUCKET.put(key,JSON.stringify(saved));return {sent:0,pending:0};}
  if(saved.nextAttemptAt>now)return {sent:0,pending:1};
  let message=host.name+'\n'+lines.slice(0,10).map(x=>x.slice(0,280)).join('\n')+(lines.length>10?'\n'+(lines.length-10)+' more changes. Open Crowsnest for details.':'');
  while(new TextEncoder().encode(message).length>3500)message=message.slice(0,-1);
  try {
    await publishNtfy(env,destination,message,'Crowsnest · '+host.name,added.length?settings.priority:3,added.length>0);
    saved.delivered=baseline;saved.kinds=kinds;saved.attempts=0;saved.nextAttemptAt=now+30000;
    await env.BUCKET.put(key,JSON.stringify(saved));return {sent:1,pending:0};
  }catch {
    saved.attempts=Math.min((saved.attempts||0)+1,6);
    saved.nextAttemptAt=now+Math.min(900000,30000*2**(saved.attempts-1));
    await env.BUCKET.put(key,JSON.stringify(saved));return {sent:0,pending:1};
  }
}
async function sweepNotifications(env) {
  const settings=await notificationSettings(env), now=Date.now();
  const prior=await env.BUCKET.get('notifications/sweep.json'), last=prior?await prior.json():{};
  if(now-Date.parse(last.at)<30000)return {ok:true,skipped:true};
  await env.BUCKET.put('notifications/sweep.json',JSON.stringify({at:new Date(now).toISOString()}));
  let cursor, checked=0, sent=0, pending=0;
  do {
    const list=await env.BUCKET.list({prefix:'hosts/',cursor});
    for(let i=0;i<list.objects.length;i+=5) {
      const results=await Promise.all(list.objects.slice(i,i+5).map(async item=>{
        const object=await env.BUCKET.get(item.key);if(!object)return {sent:0,pending:0};
        const host=await object.json(), snapshot=await env.BUCKET.get('snapshots/'+host.id+'.json');
        return notifyHost(env,host,snapshot?await snapshot.json():null,settings,now);
      }));
      for(const result of results){checked++;sent+=result.sent;pending+=result.pending;}
    }
    cursor=list.truncated?list.cursor:undefined;
  }while(cursor);
  const result={ok:true,checked,sent,pending,at:new Date().toISOString()};
  await env.BUCKET.put('notifications/sweep.json',JSON.stringify(result));
  return result;
}
