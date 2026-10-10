const COLLECTOR = '__COLLECTOR_SOURCE__';
const PROXY = '__PROXY_SOURCE__';
const COMPOSE = '__COMPOSE_SOURCE__';
const SETUP = '__SETUP_SOURCE__';
const HTML = '__BOARD_HTML__';
const BOARD_JS = '__BOARD_JS__';
const BOARD_CSS = '__BOARD_CSS__';
const LOGO = '__LOGO_BASE64__';
const VERSION = '__APP_VERSION__';
const STATES = new Set(['running','exited','created','restarting','paused','dead','removing','unknown']);
const HEALTH = new Set(['healthy','unhealthy','starting','none']);
const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
function json(data, status=200) { return new Response(JSON.stringify(data), {status,headers:{...headers,'Content-Type':'application/json'}}); }
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
  const bytes=new Uint8Array(size); let i=0; for(const c of chunks){bytes.set(c,i); i+=c.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
function validatedReport(data) {
  if(!data || !Array.isArray(data.containers) || data.containers.length>250) throw new Error('Invalid containers');
  const seen=new Set();
  const text=(s,n)=> typeof s==='string' && s.length<=n;
  const containers=data.containers.map(c=>{
    if(!c || !/^[a-f0-9]{64}$/.test(c.id) || seen.has(c.id) || !text(c.name,256) || !text(c.image,512) || !STATES.has(c.state) || !HEALTH.has(c.health) || !Number.isSafeInteger(c.restarts) || c.restarts<0 || !text(c.startedAt,64) || !text(c.finishedAt,64)) throw new Error('Invalid container');
    seen.add(c.id); return {id:c.id,name:c.name,image:c.image,state:c.state,health:c.health,restarts:c.restarts,startedAt:c.startedAt,finishedAt:c.finishedAt};
  });
  if(!text(data.engineVersion,80)) throw new Error('Invalid version');
  return {containers,engineVersion:data.engineVersion,receivedAt:new Date().toISOString()};
}
function installer(config) {
  const blocks=[['compose.yaml',COMPOSE],['collector.py',COLLECTOR],['proxy.cfg',PROXY]];
  blocks.push(['collector.json',JSON.stringify(config,null,2)]);
  const files=blocks.map(([file,body])=>"cat > "+file+" <<'DOCKER_WATCH_FILE_EOF'\n"+body+"\nDOCKER_WATCH_FILE_EOF\n").join('');
  return SETUP.replace('__WRITE_FILES__',()=>files);
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
function collectorConfig(env,id,token) {return {url:env.SITE_ORIGIN,hostId:id,hostToken:token,serviceToken:env.COLLECTOR_SERVICE_TOKEN};}
function collectorDownload(config,format='compose') {
  const downloadHeaders={...headers,'X-Crowsnest-Host-Id':config.hostId};
  if(format==='config')return new Response(JSON.stringify(config,null,2)+'\n',{headers:{...downloadHeaders,'Content-Type':'application/json','Content-Disposition':'attachment; filename="collector.json"'}});
  const readme='Crowsnest collector '+VERSION+'\n\nReview compose.yaml, collector.py and proxy.cfg before starting.\ncollector.json contains private reporting credentials; never commit it.\nThe collector reads container status through a restricted socket proxy.\nThe proxy runs as container root with all capabilities dropped.\nNo ports are published. No logs or environment variables are reported.\n\nFollow the dashboard deployment steps to create a private directory,\nextract with tar --keep-old-files, write the current user UID/GID to .env,\nand run docker compose up -d. Do not overwrite an existing installation.\nFull guide: https://github.com/bthall/crowsnest/blob/main/docs/deployment.md\n';
  const bytes=tar([['compose.yaml',COMPOSE,0o644],['collector.py',COLLECTOR,0o644],['proxy.cfg',PROXY,0o644],['collector.json',JSON.stringify(config,null,2)+'\n',0o600],['README.txt',readme,0o644]]);
  return new Response(bytes,{headers:{...downloadHeaders,'Content-Type':'application/x-tar','Content-Disposition':'attachment; filename="crowsnest-collector.tar"'}});
}
const validName=name=>typeof name==='string' && /^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,63}$/.test(name);
async function uniqueName(bucket,name,except) {
  let cursor;
  do {
    const list=await bucket.list({prefix:'hosts/',cursor});
    for(const item of list.objects){const obj=await bucket.get(item.key);if(!obj)continue;const h=await obj.json();if(h.id!==except && h.name.toLowerCase()===name.toLowerCase())return false;}
    cursor=list.truncated?list.cursor:undefined;
  }while(cursor);
  return true;
}
function event(kind,text,at=new Date().toISOString()) {return {kind,text,at};}
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
    if(!old)events.push(event('container',c.name+' appeared',at));
    else {
      if(old.state!==c.state || old.health!==c.health)events.push(event('status',c.name+': '+old.state+'/'+old.health+' → '+c.state+'/'+c.health,at));
      if(c.restarts>old.restarts)events.push(event('restart',c.name+': '+(c.restarts-old.restarts)+' additional restart(s)',at));
      if(old.image!==c.image)events.push(event('container',c.name+': image changed to '+c.image,at));
    }
  }
  for(const c of before.values())events.push(event('container',c.name+' disappeared',at));
  if(previous.engineVersion!==report.engineVersion)events.push(event('host','Docker Engine changed to '+report.engineVersion,at));
  return events;
}
// __NOTIFICATIONS_SOURCE__
export default {async scheduled(controller,env,ctx) {ctx.waitUntil(sweepNotifications(env));},async fetch(request,env,ctx) {
  const url=new URL(request.url), path=url.pathname;
  const viewer=!!request.headers.get('oai-authenticated-user-id');
  const ingest=path.match(/^\/api\/ingest\/([a-f0-9-]{36})$/);
  const sweep=path==='/api/notifications/sweep' && request.method==='POST';
  const notificationService=(path==='/api/notifications/sweep' && ['GET','POST'].includes(request.method) || path==='/api/notifications/test' && request.method==='POST');
  const sweepAuth=notificationService && !!env.COLLECTOR_SERVICE_TOKEN && await hash(request.headers.get('Authorization')||'')===await hash('Bearer '+env.COLLECTOR_SERVICE_TOKEN);
  if(!ingest && !viewer && !sweepAuth) return json({error:'Sign in to view this private board'},401);
  try {
    const canonical=dashboardOrigin(env.DASHBOARD_ORIGIN);
    if(path.startsWith('/api/notifications')) {
      if(!env.BUCKET)return json({error:'Storage unavailable'},503);
      if(path==='/api/notifications' && request.method==='GET')return json(await notificationStatus(env));
      if(path==='/api/notifications/sweep' && request.method==='GET') {
        const result=await env.BUCKET.get('notifications/sweep.json');return json(result?await result.json():{at:null});
      }
      if(!sweepAuth && !sameOrigin(request))return json({error:'Invalid origin'},403);
      if(sweep)return json(await sweepNotifications(env));
      if(path==='/api/notifications' && request.method==='PATCH') {
        let data;try{data=await readJson(request,1024);}catch{return json({error:'Invalid settings'},400);}
        if(typeof data.enabled!=='boolean' || typeof data.recoveries!=='boolean' || Object.keys(data).some(k=>!['enabled','recoveries'].includes(k)))return json({error:'Choose notification and recovery settings'},400);
        if(data.enabled && !ntfyDestination(env.NTFY_URL))return json({error:'Configure NTFY_URL in the Site runtime first'},409);
        await env.BUCKET.put('notifications/settings.json',JSON.stringify({enabled:data.enabled,recoveries:data.recoveries}));
        return json(await notificationStatus(env));
      }
      if(path==='/api/notifications/test' && request.method==='POST') {
        const destination=ntfyDestination(env.NTFY_URL);
        if(!destination)return json({error:'Configure NTFY_URL in the Site runtime first'},409);
        const obj=await env.BUCKET.get('notifications/test.json'), prior=obj?await obj.json():{};
        if(Date.now()-Date.parse(prior.at)<60000)return json({error:'Wait one minute before sending another test'},429);
        await env.BUCKET.put('notifications/test.json',JSON.stringify({at:new Date().toISOString()}));
        try {await publishNtfy(env,destination,'Crowsnest is connected. Subscribe to this topic in ntfy to receive fleet alerts.','Crowsnest · Test notification');}
        catch {return json({error:'ntfy did not accept the test. Check delivery status, server access, and the runtime token.'},502);}
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
      const replacement=tokenHash===host.pendingTokenHash && Date.parse(host.pendingTokenExpiresAt)>Date.now();
      if(tokenHash!==host.tokenHash && !replacement)return json({error:'Invalid reporting token'},403);
      let report; try {report=validatedReport(await readJson(request));}catch{return json({error:'Invalid report'},400);}
      const previous=await env.BUCKET.get('snapshots/'+host.id+'.json');
      if(replacement) {
        host.tokenHash=tokenHash; delete host.pendingTokenHash; delete host.pendingTokenExpiresAt;
        host.tokenRevision=(host.tokenRevision||0)+1;
        await env.BUCKET.put('hosts/'+host.id+'.json',JSON.stringify(host));
      }
      await env.BUCKET.put('snapshots/'+host.id+'.json',JSON.stringify(report));
      // Optional history failures must not turn a delivered report into an ingestion failure.
      try {await recordHistory(env.BUCKET,host.id,[...reportEvents(previous?await previous.json():null,report),...(replacement?[event('credentials','Reporting token replaced',report.receivedAt)]:[])]);}catch{console.error('History write failed');}
      const notify=async()=>{try{await notifyHost(env,host,report,await notificationSettings(env));}catch{console.error('Notification processing failed');}};
      if(ctx?.waitUntil)ctx.waitUntil(notify());else await notify();
      return json({ok:true,receivedAt:report.receivedAt});
    }
    if(path==='/assets/crowsnest-mark.png' && request.method==='GET')return new Response(Uint8Array.from(atob(LOGO),c=>c.charCodeAt(0)),{headers:{...headers,'Content-Type':'image/png','Cache-Control':'private, max-age=86400'}});
    if(path==='/assets/board.js' && request.method==='GET')return new Response(BOARD_JS,{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}});
    if(path==='/assets/board.css' && request.method==='GET')return new Response(BOARD_CSS,{headers:{...headers,'Content-Type':'text/css; charset=utf-8'}});
    if(path==='/' && request.method==='GET')return new Response(HTML,{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'"}});
    if(path==='/api/hosts' && request.method==='GET') {
      if(!env.BUCKET)return json({error:'Storage unavailable'},503);
      const hosts=[]; let cursor;
      do {const list=await env.BUCKET.list({prefix:'hosts/',cursor});
        for(const item of list.objects) {
          const config=await env.BUCKET.get(item.key); if(!config)continue;
          const h=await config.json(), snapshot=await env.BUCKET.get('snapshots/'+h.id+'.json');
          hosts.push({id:h.id,name:h.name,createdAt:h.createdAt,credentialRevision:h.tokenRevision||0,snapshot:snapshot?await snapshot.json():null});
        } cursor=list.truncated?list.cursor:undefined;
      }while(cursor);
      return json({hosts});
    }
    if(path==='/api/hosts' && request.method==='POST') {
      if(!sameOrigin(request))return json({error:'Invalid origin'},403);
      if(!env.BUCKET || !env.COLLECTOR_SERVICE_TOKEN)return json({error:'Collector setup unavailable'},503);
      let data; try{data=await readJson(request,2048);}catch{return json({error:'Invalid host name'},400);}
      if(!validName(data.name))return json({error:'Use a host name up to 64 characters'},400);
      if(data.format!==undefined && !['compose','script'].includes(data.format))return json({error:'Unknown collector format'},400);
      const list=await env.BUCKET.list({prefix:'hosts/',limit:101});
      if(list.truncated || list.objects.length>=100)return json({error:'Host limit reached'},409);
      for(const item of list.objects){const h=await (await env.BUCKET.get(item.key)).json();if(h.name.toLowerCase()===data.name.toLowerCase())return json({error:'That host already exists. Use a unique name.'},409);}
      const id=crypto.randomUUID(), token=crypto.randomUUID()+crypto.randomUUID();
      await env.BUCKET.put('hosts/'+id+'.json',JSON.stringify({id,name:data.name,tokenHash:await hash(token),createdAt:new Date().toISOString()}));
      if(data.format==='compose')return collectorDownload(collectorConfig(env,id,token));
      return new Response(installer(collectorConfig(env,id,token)),{headers:{...headers,'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="docker-watch-setup.sh"'}});
    }
    const hostRoute=path.match(/^\/api\/hosts\/([a-f0-9-]{36})(?:\/(collector))?$/);
    if(hostRoute && ['PATCH','DELETE','POST'].includes(request.method)) {
      if(!sameOrigin(request))return json({error:'Invalid origin'},403);
      if(!env.BUCKET)return json({error:'Storage unavailable'},503);
      const obj=await env.BUCKET.get('hosts/'+hostRoute[1]+'.json');
      if(!obj)return json({error:'Unknown host'},404);
      const host=await obj.json();
      let data;try{data=await readJson(request,2048);}catch{return json({error:'Invalid request'},400);}
      if(!hostRoute[2] && request.method==='PATCH') {
        if(!validName(data.name))return json({error:'Use a host name up to 64 characters'},400);
        if(!await uniqueName(env.BUCKET,data.name,host.id))return json({error:'That host name is already in use'},409);
        const old=host.name;host.name=data.name;
        await env.BUCKET.put('hosts/'+host.id+'.json',JSON.stringify(host));
        try{if(old!==host.name)await recordHistory(env.BUCKET,host.id,[event('host','Renamed from '+old+' to '+host.name)]);}catch{console.error('History write failed');}
        return json({ok:true});
      }
      if(!hostRoute[2] && request.method==='DELETE') {
        if(data.confirmName!==host.name)return json({error:'Enter the host name to confirm removal'},400);
        await env.BUCKET.delete('hosts/'+host.id+'.json');
        await env.BUCKET.delete('snapshots/'+host.id+'.json');
        await env.BUCKET.delete('history/'+host.id+'.json');
        await env.BUCKET.delete('notifications/hosts/'+host.id+'.json');
        return json({ok:true});
      }
      if(hostRoute[2] && request.method==='POST') {
        if(!env.COLLECTOR_SERVICE_TOKEN)return json({error:'Collector setup unavailable'},503);
        if(!['compose','config'].includes(data.format))return json({error:'Choose a collector package or configuration'},400);
        const token=crypto.randomUUID()+crypto.randomUUID();
        host.pendingTokenHash=await hash(token);
        host.pendingTokenExpiresAt=new Date(Date.now()+10*60000).toISOString();
        await env.BUCKET.put('hosts/'+host.id+'.json',JSON.stringify(host));
        return collectorDownload(collectorConfig(env,host.id,token),data.format);
      }
    }
    if(path==='/api/history' && request.method==='GET') {
      if(!env.BUCKET)return json({error:'Storage unavailable'},503);
      const id=url.searchParams.get('host');
      if(id && !/^[a-f0-9-]{36}$/.test(id))return json({error:'Invalid host'},400);
      const events=[];let cursor;
      do {
        const list=await env.BUCKET.list({prefix:'hosts/',cursor});
        for(const item of list.objects){
          const object=await env.BUCKET.get(item.key);if(!object)continue;
          const host=await object.json();if(id && host.id!==id)continue;
          const history=await env.BUCKET.get('history/'+host.id+'.json');
          if(history)for(const e of await history.json())if(Date.parse(e.at)>Date.now()-30*86400000)events.push({...e,hostId:host.id,hostName:host.name});
        }
        cursor=list.truncated?list.cursor:undefined;
      }while(cursor);
      events.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
      return json({events:events.slice(0,100)});
    }
    return json({error:'Not found'},404);
  }catch(error){console.error('Crowsnest request failed',error?.name);return json({error:'Unable to load or save status. Try again.'},503);}
}};
