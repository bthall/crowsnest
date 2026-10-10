const COLLECTOR = '__COLLECTOR_SOURCE__';
const PROXY = '__PROXY_SOURCE__';
const COMPOSE = '__COMPOSE_SOURCE__';
const SETUP = '__SETUP_SOURCE__';
const HTML = '__BOARD_HTML__';
const BOARD_JS = '__BOARD_JS__';
const BOARD_CSS = '__BOARD_CSS__';
const LOGO = '__LOGO_BASE64__';
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
export default {async fetch(request,env) {
  const url=new URL(request.url), path=url.pathname;
  const viewer=!!request.headers.get('oai-authenticated-user-id');
  const ingest=path.match(/^\/api\/ingest\/([a-f0-9-]{36})$/);
  if(!ingest && !viewer) return json({error:'Sign in to view this private board'},401);
  try {
    const canonical=dashboardOrigin(env.DASHBOARD_ORIGIN);
    if(path==='/' && ['GET','HEAD'].includes(request.method) && canonical && url.origin!==canonical) {
      return new Response(null,{status:308,headers:{...headers,Location:canonical+'/'+url.search}});
    }
    if(ingest && request.method==='POST') {
      if(!env.BUCKET)return json({error:'Storage unavailable'},503);
      const object=await env.BUCKET.get('hosts/'+ingest[1]+'.json');
      if(!object)return json({error:'Unknown host'},404);
      const host=await object.json();
      const auth=request.headers.get('Authorization') || '';
      if(!auth.startsWith('Bearer ') || await hash(auth.slice(7))!==host.tokenHash)return json({error:'Invalid reporting token'},403);
      let report; try {report=validatedReport(await readJson(request));}catch{return json({error:'Invalid report'},400);}
      await env.BUCKET.put('snapshots/'+host.id+'.json',JSON.stringify(report));
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
          hosts.push({id:h.id,name:h.name,createdAt:h.createdAt,snapshot:snapshot?await snapshot.json():null});
        } cursor=list.truncated?list.cursor:undefined;
      }while(cursor);
      return json({hosts});
    }
    if(path==='/api/hosts' && request.method==='POST') {
      if(!sameOrigin(request))return json({error:'Invalid origin'},403);
      if(!env.BUCKET || !env.COLLECTOR_SERVICE_TOKEN)return json({error:'Collector setup unavailable'},503);
      let data; try{data=await readJson(request,2048);}catch{return json({error:'Invalid host name'},400);}
      if(typeof data.name!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,63}$/.test(data.name))return json({error:'Use a host name up to 64 characters'},400);
      const list=await env.BUCKET.list({prefix:'hosts/',limit:101});
      if(list.truncated || list.objects.length>=100)return json({error:'Host limit reached'},409);
      for(const item of list.objects){const h=await (await env.BUCKET.get(item.key)).json();if(h.name.toLowerCase()===data.name.toLowerCase())return json({error:'That host already exists. Use a unique name.'},409);}
      const id=crypto.randomUUID(), token=crypto.randomUUID()+crypto.randomUUID();
      await env.BUCKET.put('hosts/'+id+'.json',JSON.stringify({id,name:data.name,tokenHash:await hash(token),createdAt:new Date().toISOString()}));
      return new Response(installer({url:env.SITE_ORIGIN,hostId:id,hostToken:token,serviceToken:env.COLLECTOR_SERVICE_TOKEN}),{headers:{...headers,'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="docker-watch-setup.sh"'}});
    }
    return json({error:'Not found'},404);
  }catch(error){console.error('Crowsnest request failed',error?.name);return json({error:'Unable to load or save status. Try again.'},503);}
}};
