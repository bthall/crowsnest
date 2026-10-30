const COLLECTOR = '__COLLECTOR_SOURCE__';
const PROXY = '__PROXY_SOURCE__';
const COMPOSE = '__COMPOSE_SOURCE__';
const SETUP = '__SETUP_SOURCE__';
const UPDATE_MANAGER = '__UPDATE_MANAGER_SOURCE__';
const HTML = '__BOARD_HTML__';
const BOARD_JS = '__BOARD_JS__';
const BOARD_CSS = '__BOARD_CSS__';
const LOGO = '__LOGO_BASE64__';
const VERSION = '__APP_VERSION__';
const COLLECTOR_VERSION = '__COLLECTOR_VERSION__';
const COLLECTOR_PROTOCOL = Number('__COLLECTOR_PROTOCOL__');
const MIN_COLLECTOR_PROTOCOL = Number('__MIN_COLLECTOR_PROTOCOL__');
// __VERSIONS_SOURCE__
const STATES = new Set(['running','exited','created','restarting','paused','dead','removing','unknown']);
const HEALTH = new Set(['healthy','unhealthy','starting','none']);
const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Resource-Policy':'same-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
function json(data, status=200) { return new Response(JSON.stringify(data), {status,headers:{...headers,'Content-Type':'application/json'}}); }
function safeEqual(a,b) { if(typeof a!=='string' || typeof b!=='string' || a.length!==b.length) return false; let c=0; for(let i=0;i<a.length;i++) c |= a.charCodeAt(i) ^ b.charCodeAt(i); return c===0; }
async function hash(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join(''); }
function sameOrigin(request) { return request.headers.get('Origin') === new URL(request.url).origin; }
function dashboardOrigin(value) {
  if(!value)return null;
  try {
    const url=new URL(value);
    return url.protocol==='https:' && !url.username && !url.password && url.pathname==='/' && !url.search && !url.hash ? url.origin : null;
  }catch{return null;}
}
async function readJson(request, max=131072) {
  const reader=request.body?.getReader(); if(!reader) throw new Error('Missing body');
  const chunks=[]; let size=0;
  while(true) { const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>max) { await reader.cancel(); throw new Error('Report too large'); } chunks.push(value); }
  let bytes;
  if(chunks.length===1)bytes=chunks[0];
  else{bytes=new Uint8Array(size);let i=0;for(const c of chunks){bytes.set(c,i);i+=c.length;}}
  const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!data || typeof data!=='object' || Array.isArray(data))throw new Error('Expected a JSON object');
  return data;
}
function validatedUpdateStatus(value) {
  if(!value || typeof value!=='object' || Array.isArray(value) || typeof value.autoUpdates!=='boolean')throw new Error('Invalid update status');
  const status={autoUpdates:value.autoUpdates};
  for(const key of ['lastAttempt','lastResult','fromVersion','toVersion','rollback']) {
    const field=value[key];
    if(field==null){status[key]=null;continue;}
    const valid=key==='lastAttempt'?typeof field==='string' && field.length<=32 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(field) && Number.isFinite(Date.parse(field)):
      key==='lastResult'?['updated','rolled_back','failed','rollback_failed','no_update'].includes(field):
      key==='rollback'?['not_needed','succeeded','failed'].includes(field):validCollectorVersion(field);
    if(!valid)throw new Error('Invalid update status');
    status[key]=field;
  }
  return status;
}
function validatedReport(data) {
  if(!data || !Array.isArray(data.containers) || data.containers.length>250) throw new Error('Invalid containers');
  const seen=new Set();
  const text=(s,n)=> typeof s==='string' && s.length<=n;
  const containers=data.containers.map(c=>{
    if(!c || !/^[a-f0-9]{64}$/.test(c.id) || seen.has(c.id) || !text(c.name,256) || !text(c.image,512) || !STATES.has(c.state) || !HEALTH.has(c.health) || !Number.isSafeInteger(c.restarts) || c.restarts<0 || !text(c.startedAt,64) || !text(c.finishedAt,64)) throw new Error('Invalid container');
    const metadata={};
    for(const key of ['composeProject','composeService']) {
      if(c[key]!==undefined){if(!text(c[key],128))throw new Error('Invalid Compose metadata');metadata[key]=c[key];}
    }
    if(c.resources!==undefined)metadata.resources=validatedResources(c.resources);
    seen.add(c.id); return {id:c.id,name:c.name,image:c.image,state:c.state,health:c.health,restarts:c.restarts,startedAt:c.startedAt,finishedAt:c.finishedAt,...metadata};
  });
  if(!text(data.engineVersion,80)) throw new Error('Invalid version');
  if(data.collectorVersion!==undefined && !validCollectorVersion(data.collectorVersion))throw new Error('Invalid collector version');
  if(data.collectorProtocol!==undefined && (!Number.isSafeInteger(data.collectorProtocol) || data.collectorProtocol<1 || data.collectorProtocol>65535))throw new Error('Invalid collector protocol');
  if(data.resourceSampling!==undefined && !RESOURCE_STATES.has(data.resourceSampling))throw new Error('Invalid resource sampling');
  return {containers,engineVersion:data.engineVersion,...data.collectorVersion!==undefined?{collectorVersion:data.collectorVersion}:{},...data.collectorProtocol!==undefined?{collectorProtocol:data.collectorProtocol}:{},...data.updateStatus!==undefined?{updateStatus:validatedUpdateStatus(data.updateStatus)}:{},...data.resourceSampling!==undefined?{resourceSampling:data.resourceSampling}:{},receivedAt:new Date().toISOString()};
}
function installer(config) {
  const blocks=[['compose.yaml',COMPOSE],['collector.py',COLLECTOR],['proxy.cfg',PROXY],['crowsnest',UPDATE_MANAGER]];
  blocks.push(['collector.json',JSON.stringify(config,null,2)]);
  const files=blocks.map(([file,body])=>"cat > "+file+" <<'CROWSNEST_FILE_EOF'\n"+body+"\nCROWSNEST_FILE_EOF\n").join('');
  return SETUP.replace('__WRITE_FILES__',()=>files);
}
// __COLLECTOR_DIRECTORY_SOURCE__
function collectorUpdate() {
  return ["bash <<'CROWSNEST_UPDATE'",'set -eu',...collectorDirectoryCommands(),
    'test -O .','test -f collector.json','test -f compose.yaml','test ! -L crowsnest',
    'command -v python3 >/dev/null','update_file="$(mktemp .crowsnest-manager.XXXXXX)"',
    "trap 'rm -f \"$update_file\"' EXIT", "cat > \"$update_file\" <<'CROWSNEST_MANAGER_SOURCE'",UPDATE_MANAGER,'CROWSNEST_MANAGER_SOURCE',
    'chmod 0700 "$update_file"','mv -- "$update_file" crowsnest',
    './crowsnest migrate --version '+COLLECTOR_VERSION,'CROWSNEST_UPDATE',''].join('\n');
}
function tar(files) {
  const encoder=new TextEncoder(), chunks=[];
  for(const [name,body,mode] of files) {
    const bytes=encoder.encode(body), header=new Uint8Array(512);
    const field=(offset,length,value)=>header.set(encoder.encode(value).slice(0,length),offset);
    field(0,100,name); field(100,8,mode.toString(8).padStart(7,'0')+'\0');
    field(108,8,'0000000\0'); field(116,8,'0000000\0');
    field(124,12,bytes.length.toString(8).padStart(11,'0')+'\0');
    field(136,12,'00000000000\0'); header.fill(32,148,156);
    header[156]=48; field(257,6,'ustar\0'); field(263,2,'00');
    const sum=header.reduce((a,b)=>a+b,0);
    field(148,8,sum.toString(8).padStart(6,'0')+'\0 ');
    chunks.push(header,bytes,new Uint8Array((512-bytes.length%512)%512));
  }
  chunks.push(new Uint8Array(1024));
  const result=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));
  let offset=0; for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}
  return result;
}
function collectorReady(env) {
  const origin=dashboardOrigin(env.SITE_ORIGIN);
  if(env.AUTH_MODE==='standalone')return !!origin;
  return !!origin && !new URL(origin).port && typeof env.COLLECTOR_SERVICE_TOKEN==='string' && /^[\x21-\x7e]{1,8192}$/.test(env.COLLECTOR_SERVICE_TOKEN);
}
function collectorConfig(env,id,token) {return {url:dashboardOrigin(env.SITE_ORIGIN),hostId:id,hostToken:token,...env.AUTH_MODE!=='standalone'?{serviceToken:env.COLLECTOR_SERVICE_TOKEN}:{}};}
function collectorDownload(config,format='compose') {
  const downloadHeaders={...headers,'X-Crowsnest-Host-Id':config.hostId};
  if(format==='config')return new Response(JSON.stringify(config,null,2)+'\n',{headers:{...downloadHeaders,'Content-Type':'application/json','Content-Disposition':'attachment; filename="collector.json"'}});
  const readme='Crowsnest collector '+COLLECTOR_VERSION+'\n\nReview compose.yaml, collector.py and proxy.cfg before starting.\ncollector.json contains private reporting credentials; never commit it.\nThe collector reads container status through a restricted socket proxy.\nThe proxy runs as container root with all capabilities dropped.\nNo ports are published. No logs or environment variables are reported.\n\nFollow the dashboard deployment steps to create a private directory,\nextract with tar --keep-old-files, write the current user UID/GID to .env,\nand run docker compose up -d. Do not overwrite an existing installation.\nAfter the independent collector release is published, use ./crowsnest migrate\nfor the one-time image migration, then ./crowsnest update for later updates.\nAutomatic updates remain disabled until explicitly enabled on this host.\nThe manager requires host Python 3.9+ and local Docker Compose v2 access.\nFull guide: https://github.com/bthall/crowsnest/blob/main/docs/deployment.md\n';
  const bytes=tar([['compose.yaml',COMPOSE,0o644],['collector.py',COLLECTOR,0o644],['proxy.cfg',PROXY,0o644],['crowsnest',UPDATE_MANAGER,0o700],['collector.json',JSON.stringify(config,null,2)+'\n',0o600],['README.txt',readme,0o644]]);
  if(format==='setup')return json({hostId:config.hostId,packageBase64:btoa(Array.from(bytes,c=>String.fromCharCode(c)).join('')),setupCommand:"bash <<'CROWSNEST_SETUP'\nexport CROWSNEST_PREPARE_ONLY=1\n"+installer(config)+'\nCROWSNEST_SETUP\n'});
  return new Response(bytes,{headers:{...downloadHeaders,'Content-Type':'application/x-tar','Content-Disposition':'attachment; filename="crowsnest-collector.tar"'}});
}
const validName=name=>typeof name==='string' && /^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,63}$/.test(name);
const validGroup=group=>typeof group==='string' && (group==='' || /^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,31}$/.test(group));
async function uniqueName(bucket,name,except) {
  let cursor;
  do {
    const list=await bucket.list({prefix:'hosts/',cursor});
    for(const item of list.objects){const obj=await bucket.get(item.key);if(!obj)continue;const h=await obj.json();if(h.id!==except && h.name.toLowerCase()===name.toLowerCase())return false;}
    cursor=list.truncated?list.cursor:undefined;
  }while(cursor);
  return true;
}
async function writeHost(bucket,object,host) {
  // Reject stale management/reporting writes instead of replacing newer credentials.
  return bucket.put('hosts/'+host.id+'.json',JSON.stringify(host),{onlyIf:{etagMatches:object.etag}});
}
function event(kind,text,at=new Date().toISOString()) {return {kind,text,at};}
function containerEvent(kind,text,c,at) {return {...event(kind,text,at),containerId:c.id,containerName:c.name};}
async function recordHistory(bucket,id,events) {
  if(!events.length)return;
  const object=await bucket.get('history/'+id+'.json');
  const existing=object?await object.json():[];
  const cutoff=Date.now()-30*86400000;
  const recent=[...events.reverse(),...existing].filter(e=>Date.parse(e.at)>cutoff).slice(0,100);
  await bucket.put('history/'+id+'.json',JSON.stringify(recent));
}
function reportEvents(previous,report) {
  const at=report.receivedAt, events=[];
  if(!previous)return [event('report','First collector report received',at)];
  if(Date.parse(at)-Date.parse(previous.receivedAt)>120000)events.push(event('report','Reporting resumed after a gap',at));
  const before=new Map(previous.containers.map(c=>[c.id,c]));
  for(const c of report.containers) {
    const old=before.get(c.id);before.delete(c.id);
    if(!old)events.push(containerEvent('container',c.name+' appeared',c,at));
    else {
      if(old.state!==c.state || old.health!==c.health)events.push(containerEvent('status',c.name+': '+old.state+'/'+old.health+' → '+c.state+'/'+c.health,c,at));
      if(c.restarts>old.restarts)events.push(containerEvent('restart',c.name+': '+(c.restarts-old.restarts)+' additional restart(s)',c,at));
      if(old.image!==c.image)events.push(containerEvent('container',c.name+': image changed to '+c.image,c,at));
      if(old.name!==c.name)events.push(containerEvent('container','Renamed from '+old.name+' to '+c.name,c,at));
    }
  }
  for(const c of before.values())events.push(containerEvent('container',c.name+' disappeared',c,at));
  if(previous.engineVersion!==report.engineVersion)events.push(event('host','Docker Engine changed to '+report.engineVersion,at));
  if(previous.collectorVersion!==report.collectorVersion && report.collectorVersion)events.push(event('collector','Collector now reports v'+report.collectorVersion,at));
  return events;
}
// __NOTIFICATIONS_SOURCE__
// __RESOURCES_SOURCE__
// __SIGNALS_SOURCE__
export default {async scheduled(controller,env,ctx) {ctx.waitUntil(sweepNotifications(env));},async fetch(request,env,ctx) {
  const url=new URL(request.url), path=url.pathname;
  const viewer=!!request.headers.get('oai-authenticated-user-id');
  const ingest=path.match(/^\/api\/ingest\/([a-f0-9-]{36})$/);
  const sweep=path==='/api/notifications/sweep' && request.method==='POST';
  const notificationService=(path==='/api/notifications/sweep' && ['GET','POST'].includes(request.method) || path==='/api/notifications/test' && request.method==='POST');
  const sweepAuth=notificationService && !!env.COLLECTOR_SERVICE_TOKEN && safeEqual(await hash(request.headers.get('Authorization')||''), await hash('Bearer '+env.COLLECTOR_SERVICE_TOKEN));
  if(!ingest && !viewer && !sweepAuth) return json({error:'Sign in to view this private board'},401);
  try {
    const canonical=dashboardOrigin(env.DASHBOARD_ORIGIN);
    if(path.startsWith('/api/notifications')) {
      if(!env.BUCKET)return json({error:'Storage unavailable'},503);
      if(path==='/api/notifications' && request.method==='GET')return json(await notificationStatus(env));
      if(path==='/api/notifications/sweep' && request.method==='GET') {
        const result=await env.BUCKET.get('notifications/sweep.json'), delivery=await env.BUCKET.get('notifications/delivery.json');return json({...result?await result.json():{at:null},lastDeliveryError:delivery?(await delivery.json()).lastError:null});
      }
      if(!sweepAuth && !sameOrigin(request))return json({error:'Invalid origin'},403);
      if(sweep)return json(await sweepNotifications(env));
      if(path==='/api/notifications' && request.method==='PATCH') {
        let data;try{data=await readJson(request,1024);}catch{return json({error:'Invalid settings'},400);}
        const booleanFields=['enabled','recoveries','hostReports','unhealthy','restarting','dead'];
        if(typeof data.enabled!=='boolean' || typeof data.recoveries!=='boolean' || booleanFields.some(k=>data[k]!==undefined && typeof data[k]!=='boolean') || Object.keys(data).some(k=>![...booleanFields,'staleMinutes','priority',...Object.keys(SIGNAL_DEFAULTS)].includes(k)) || data.staleMinutes!==undefined && ![2,5,10,15].includes(data.staleMinutes) || data.priority!==undefined && ![3,4,5].includes(data.priority) || !validSignalSettings(data))return json({error:'Choose valid notification thresholds, durations, delay, and priority'},400);
        if(data.enabled && !ntfyDestination(env.NTFY_URL))return json({error:'Configure NTFY_URL in the Crowsnest runtime first'},409);
        const previous=await notificationSettings(env);
        await env.BUCKET.put('notifications/settings.json',JSON.stringify({...previous,...data}));
        return json(await notificationStatus(env));
      }
      if(path==='/api/notifications/test' && request.method==='POST') {
        const destination=ntfyDestination(env.NTFY_URL);
        if(!destination)return json({error:'Configure NTFY_URL in the Crowsnest runtime first'},409);
        const obj=await env.BUCKET.get('notifications/test.json'), prior=obj?await obj.json():{};
        if(Date.now()-Date.parse(prior.at)<60000)return json({error:'Wait one minute before sending another test'},429);
        await env.BUCKET.put('notifications/test.json',JSON.stringify({at:new Date().toISOString()}));
        try {await publishNtfy(env,destination,'Crowsnest is connected. Subscribe to this topic in ntfy to receive fleet alerts.','Crowsnest · Test notification');}
        catch(error) {return json({error:'ntfy did not accept the test: '+error.message+'. Check server access and the runtime token.'},502);}
        return json({ok:true});
      }
      return json({error:'Not found'},404);
    }
    if(path==='/' && ['GET','HEAD'].includes(request.method) && canonical && url.origin!==canonical) {
      return new Response(null,{status:308,headers:{...headers,Location:canonical+'/'+url.search}});
    }
    if(ingest && request.method==='POST') {
      if(!env.BUCKET)return json({error:'Storage unavailable'},503);
      const object=await env.BUCKET.get('hosts/'+ingest[1]+'.json');
      if(!object)return json({error:'Unknown host'},404);
      const host=await object.json();
      const auth=request.headers.get('Authorization') || '';
      if(!auth.startsWith('Bearer '))return json({error:'Invalid reporting token'},403);
      const tokenHash=await hash(auth.slice(7));
      const replacement=safeEqual(tokenHash, host.pendingTokenHash) && Date.parse(host.pendingTokenExpiresAt)>Date.now();
      if(!safeEqual(tokenHash, host.tokenHash) && !replacement)return json({error:'Invalid reporting token'},403);
      let report; try {report=validatedReport(await readJson(request));}catch{return json({error:'Invalid report'},400);}
      const previous=await env.BUCKET.get('snapshots/'+host.id+'.json');
      if(replacement) {
        host.tokenHash=tokenHash; delete host.pendingTokenHash; delete host.pendingTokenExpiresAt;
        host.tokenRevision=(host.tokenRevision||0)+1;
        if(!await writeHost(env.BUCKET,object,host))return json({error:'Host changed during token activation. Retry the report.'},409);
      }
      await env.BUCKET.put('snapshots/'+host.id+'.json',JSON.stringify(report));
      // Optional history failures must not turn a delivered report into an ingestion failure.
      try {await recordHistory(env.BUCKET,host.id,[...reportEvents(previous?await previous.json():null,report),...(replacement?[event('credentials','Reporting token replaced',report.receivedAt)]:[])]);}catch{console.error('History write failed');}
      try {await recordResources(env.BUCKET,host.id,report);}catch{console.error('Resource history write failed');}
      try {await recordSignals(env.BUCKET,host,report,await notificationSettings(env));}catch{console.error('Alert observations write failed');}
      const notify=async()=>{try{await notifyHost(env,host,report,await notificationSettings(env));}catch{console.error('Notification processing failed');}};
      if(!env.DEFER_NOTIFICATIONS){if(ctx?.waitUntil)ctx.waitUntil(notify());else await notify();}
      return json({ok:true,receivedAt:report.receivedAt});
    }
    if(path==='/assets/crowsnest-mark.png' && request.method==='GET')return new Response(Uint8Array.from(atob(LOGO),c=>c.charCodeAt(0)),{headers:{...headers,'Content-Type':'image/png','Cache-Control':'private, max-age=86400'}});
    if(path==='/assets/board.js' && request.method==='GET')return new Response(BOARD_JS,{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}});
    if(path==='/assets/board.css' && request.method==='GET')return new Response(BOARD_CSS,{headers:{...headers,'Content-Type':'text/css; charset=utf-8'}});
    if(path==='/' && request.method==='GET')return new Response(HTML,{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"}});
    if(path==='/api/hosts' && request.method==='GET') {
      if(!env.BUCKET)return json({error:'Storage unavailable'},503);
      const settings=await notificationSettings(env),signalEnabled=settings.cpuAlerts || settings.memoryAlerts || settings.restartBursts;
      // A host needs three reads, or four with signal alerts; keep at most nine in flight.
      const hostBatchSize=signalEnabled?2:3;
      const hosts=[]; let cursor;
      const maintenanceKeys=new Set(); let maintCursor;
      do {
        const maintList=await env.BUCKET.list({prefix:'maintenance/hosts/',cursor:maintCursor});
        for(const item of maintList.objects)maintenanceKeys.add(item.key);
        maintCursor=maintList.truncated?maintList.cursor:undefined;
      }while(maintCursor);
      do {const list=await env.BUCKET.list({prefix:'hosts/',cursor});
        for(let i=0;i<list.objects.length;i+=hostBatchSize) {
          const batch=await Promise.all(list.objects.slice(i,i+hostBatchSize).map(async item=>{
            const id=item.key.startsWith('hosts/') && item.key.endsWith('.json')?item.key.slice(6,-5):null;
            if(!id)return null;
            const maintKey='maintenance/hosts/'+id+'.json';
            const [config,snapshot,maintenance,signals]=await Promise.all([
              env.BUCKET.get(item.key),
              env.BUCKET.get('snapshots/'+id+'.json'),
              maintenanceKeys.has(maintKey)?hostMaintenance(env.BUCKET,id):{},
              signalEnabled?env.BUCKET.get('signals/'+id+'.json'):null
            ]);
            if(!config)return null;
            const h=await config.json();
            const report=snapshot?await snapshot.json():null;
            const active=advancedIssues(report,signals?await signals.json():null,settings).issues;
            const alertSignals=Object.entries(active).map(([key,text])=>({containerId:signalContainer(key),kind:signalKind(key),text}));
            return {id:h.id,name:h.name,group:h.group||'',createdAt:h.createdAt,credentialRevision:h.tokenRevision||0,maintenanceUntil:maintenance.until||null,alertSignals,snapshot:report};
          }));
          hosts.push(...batch.filter(Boolean));
        } cursor=list.truncated?list.cursor:undefined;
      }while(cursor);
      return json({hosts,availableCollectorVersion:COLLECTOR_VERSION,collectorProtocol:COLLECTOR_PROTOCOL,minimumCollectorProtocol:MIN_COLLECTOR_PROTOCOL});
    }
    if(path==='/api/hosts' && request.method==='POST') {
      if(!sameOrigin(request))return json({error:'Invalid origin'},403);
      if(!env.BUCKET || !collectorReady(env))return json({error:'Collector setup unavailable'},503);
      let data; try{data=await readJson(request,2048);}catch{return json({error:'Invalid host name'},400);}
      if(Object.keys(data).some(k=>!['name','format'].includes(k)))return json({error:'Choose a valid host name and format'},400);
      if(!validName(data.name))return json({error:'Use a host name up to 64 characters'},400);
      if(data.format!==undefined && !['compose','script','setup'].includes(data.format))return json({error:'Unknown collector format'},400);
      let cursor,count=0;
      do {
        const list=await env.BUCKET.list({prefix:'hosts/',limit:101,cursor});
        for(const item of list.objects){
          const object=await env.BUCKET.get(item.key);if(!object)continue;
          const h=await object.json();
          if(++count>=100)return json({error:'Host limit reached'},409);
          if(h.name.toLowerCase()===data.name.toLowerCase())return json({error:'That host already exists. Use a unique name.'},409);
        }
        cursor=list.truncated?list.cursor:undefined;
      }while(cursor);
      const id=crypto.randomUUID(), token=crypto.randomUUID()+crypto.randomUUID();
      await env.BUCKET.put('hosts/'+id+'.json',JSON.stringify({id,name:data.name,tokenHash:await hash(token),createdAt:new Date().toISOString()}));
      if(['compose','setup'].includes(data.format))return collectorDownload(collectorConfig(env,id,token),data.format);
      return new Response(installer(collectorConfig(env,id,token)),{headers:{...headers,'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="crowsnest-setup.sh"'}});
    }
    const hostRoute=path.match(/^\/api\/hosts\/([a-f0-9-]{36})(?:\/(collector|maintenance))?$/);
    if(hostRoute && ['PATCH','DELETE','POST'].includes(request.method)) {
      if(!sameOrigin(request))return json({error:'Invalid origin'},403);
      if(!env.BUCKET)return json({error:'Storage unavailable'},503);
      const obj=await env.BUCKET.get('hosts/'+hostRoute[1]+'.json');
      if(!obj)return json({error:'Unknown host'},404);
      const host=await obj.json();
      let data;try{data=await readJson(request,2048);}catch{return json({error:'Invalid request'},400);}
      if(hostRoute[2]==='maintenance' && request.method==='POST') {
        if(![0,15,60,240,1440].includes(data.minutes) || Object.keys(data).some(k=>k!=='minutes'))return json({error:'Choose 15 minutes, 1 hour, 4 hours, 24 hours, or end maintenance'},400);
        const until=data.minutes?new Date(Date.now()+data.minutes*60000).toISOString():null;
        await env.BUCKET.put('maintenance/hosts/'+host.id+'.json',JSON.stringify({until,revision:crypto.randomUUID()}));
        try{await recordHistory(env.BUCKET,host.id,[event('maintenance',until?'Notifications paused until '+until:'Maintenance ended; notifications resume on the next report or background check')]);}catch{console.error('History write failed');}
        return json({ok:true,maintenanceUntil:until});
      }
      if(!hostRoute[2] && request.method==='PATCH') {
        if(!validName(data.name))return json({error:'Use a host name up to 64 characters'},400);
        if(data.group!==undefined && !validGroup(data.group))return json({error:'Use a group up to 32 letters, numbers, spaces, dots, dashes, or underscores'},400);
        if(Object.keys(data).some(k=>!['name','group'].includes(k)))return json({error:'Choose a host name and optional group'},400);
        if(!await uniqueName(env.BUCKET,data.name,host.id))return json({error:'That host name is already in use'},409);
        const old=host.name,oldGroup=host.group||'';host.name=data.name;
        if(data.group!==undefined)host.group=data.group;
        if(!await writeHost(env.BUCKET,obj,host))return json({error:'Host changed. Refresh before saving it.'},409);
        try{await recordHistory(env.BUCKET,host.id,[...(old!==host.name?[event('host','Renamed from '+old+' to '+host.name)]:[]),...(oldGroup!==(host.group||'')?[event('host','Group changed from '+(oldGroup||'Ungrouped')+' to '+(host.group||'Ungrouped'))]:[])]);}catch{console.error('History write failed');}
        return json({ok:true});
      }
      if(!hostRoute[2] && request.method==='DELETE') {
        if(data.confirmName!==host.name)return json({error:'Enter the host name to confirm removal'},400);
        await env.BUCKET.delete('hosts/'+host.id+'.json');
        await env.BUCKET.delete('snapshots/'+host.id+'.json');
        await env.BUCKET.delete('history/'+host.id+'.json');
        await env.BUCKET.delete('resources/'+host.id+'.json');
        await env.BUCKET.delete('signals/'+host.id+'.json');
        await env.BUCKET.delete('notifications/hosts/'+host.id+'.json');
        await env.BUCKET.delete('notifications/locks/'+host.id+'.json');
        await env.BUCKET.delete('maintenance/hosts/'+host.id+'.json');
        return json({ok:true});
      }
      if(hostRoute[2]==='collector' && request.method==='POST') {
        if(Object.keys(data).some(k=>k!=='format'))return json({error:'Choose a collector package or configuration'},400);
        if(data.format==='update')return json({updateCommand:collectorUpdate(),collectorVersion:COLLECTOR_VERSION});
        if(!collectorReady(env))return json({error:'Collector setup unavailable'},503);
        if(!['compose','config','setup'].includes(data.format))return json({error:'Choose a collector package or configuration'},400);
        const token=crypto.randomUUID()+crypto.randomUUID();
        host.pendingTokenHash=await hash(token);
        host.pendingTokenExpiresAt=new Date(Date.now()+10*60000).toISOString();
        if(!await writeHost(env.BUCKET,obj,host))return json({error:'Host changed. Refresh before preparing credentials.'},409);
        return collectorDownload(collectorConfig(env,host.id,token),data.format);
      }
    }
    if(path==='/api/resources' && request.method==='GET') {
      if(!env.BUCKET)return json({error:'Storage unavailable'},503);
      const id=url.searchParams.get('host');
      if(!id || !/^[a-f0-9-]{36}$/.test(id))return json({error:'Choose a valid host'},400);
      if(!await env.BUCKET.get('hosts/'+id+'.json'))return json({error:'Unknown host'},404);
      const container=url.searchParams.get('container');
      if(container!==null && !/^[a-f0-9]{64}$/.test(container))return json({error:'Choose a valid container'},400);
      const object=await env.BUCKET.get('resources/'+id+'.json');
      const samples=retainedResourceSamples(object?await object.json():[],Date.now());
      return json({samples:resourceReadings(samples,container),windowSeconds:300,retentionHours:24,maxBytes:RESOURCE_MAX_BYTES});
    }
    if(path==='/api/history' && request.method==='GET') {
      if(!env.BUCKET)return json({error:'Storage unavailable'},503);
      const id=url.searchParams.get('host');
      if(id && !/^[a-f0-9-]{36}$/.test(id))return json({error:'Invalid host'},400);
      const group=url.searchParams.get('group');
      if(group!==null && group!=='_ungrouped' && !validGroup(group))return json({error:'Invalid group'},400);
      const containerId=url.searchParams.get('container');
      if(containerId) {
        if(!id || !/^[a-f0-9]{64}$/.test(containerId))return json({error:'Choose a host and a valid container'},400);
        const [object,snapshot,history]=await Promise.all([
          env.BUCKET.get('hosts/'+id+'.json'),
          env.BUCKET.get('snapshots/'+id+'.json'),
          env.BUCKET.get('history/'+id+'.json')
        ]);
        if(!object)return json({error:'Unknown host'},404);
        const host=await object.json();
        const entries=history?await history.json():[];
        const current=snapshot?(await snapshot.json()).containers.find(c=>c.id===containerId):null;
        const name=current?.name || entries.find(e=>e.containerId===containerId)?.containerName;
        const events=[];
        for(const e of entries) {
          if(Date.parse(e.at)<=Date.now()-30*86400000)continue;
          const byId=e.containerId===containerId;
          const byName=!e.containerId && name && ['container','status','restart'].includes(e.kind) && (e.text.startsWith(name+': ') || e.text===name+' appeared' || e.text===name+' disappeared');
          if(byId || byName)events.push({...e,hostId:host.id,hostName:host.name,matchedBy:byId?'id':'name'});
        }
        events.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
        return json({events:events.slice(0,100),legacyMatches:events.some(e=>e.matchedBy==='name')});
      }
      const events=[];let cursor;
      if(id) {
        const [object,history]=await Promise.all([
          env.BUCKET.get('hosts/'+id+'.json'),
          env.BUCKET.get('history/'+id+'.json')
        ]);
        if(!object)return json({error:'Unknown host'},404);
        const host=await object.json();
        if(history)for(const e of await history.json())if(Date.parse(e.at)>Date.now()-30*86400000)events.push({...e,hostId:host.id,hostName:host.name});
        events.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
        return json({events:events.slice(0,100)});
      }
      const hostBatchSize=5;
      do {
        const list=await env.BUCKET.list({prefix:'hosts/',cursor});
        for(let i=0;i<list.objects.length;i+=hostBatchSize) {
          const batch=await Promise.all(list.objects.slice(i,i+hostBatchSize).map(async item=>{
            const hostId=item.key.startsWith('hosts/') && item.key.endsWith('.json')?item.key.slice(6,-5):null;
            if(!hostId)return null;
            const [config,history]=await Promise.all([
              env.BUCKET.get(item.key),
              env.BUCKET.get('history/'+hostId+'.json')
            ]);
            if(!config)return null;
            const host=await config.json();
            if(group!==null && (group==='_ungrouped'?!!host.group:(host.group||'')!==group))return null;
            const entries=history?await history.json():[];
            return {host,entries};
          }));
          for(const item of batch) {
            if(!item)continue;
            for(const e of item.entries)if(Date.parse(e.at)>Date.now()-30*86400000)events.push({...e,hostId:item.host.id,hostName:item.host.name});
          }
        }
        cursor=list.truncated?list.cursor:undefined;
      }while(cursor);
      events.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
      return json({events:events.slice(0,100)});
    }
    return json({error:'Not found'},404);
  }catch(error){console.error('Crowsnest request failed',error?.name);return json({error:'Unable to load or save status. Try again.'},503);}
}};

