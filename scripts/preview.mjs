// Local-only UI preview. All hosts and container data below are fictional.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const {version}=JSON.parse(await readFile(root+'package.json','utf8'));
const containerId=name=>createHash('sha256').update(name).digest('hex');
const ago = seconds => new Date(Date.now() - seconds * 1000).toISOString();
const container = (name, image, state, health, restarts = 0, uptime = 86400) => ({
  id: containerId(name), name, image, state, health, restarts,
  startedAt: ago(uptime), finishedAt: state === 'exited' ? ago(1800) : '',
});
function fixtures() {
  const data={hosts: [
    {id: 'demo-lighthouse', name: 'lighthouse', snapshot: {engineVersion: '28.5.1', receivedAt: ago(8), containers: [
      container('caddy', 'caddy:2.10-alpine', 'running', 'healthy', 0, 864000),
      container('crowsnest-collector', 'python:3.13-alpine', 'running', 'none', 0, 691200),
      container('forgejo', 'codeberg.org/forgejo/forgejo:12', 'running', 'healthy', 0, 345600),
      container('immich-server', 'ghcr.io/immich-app/immich-server:v2', 'running', 'unhealthy', 2, 14400),
      container('postgres', 'postgres:17-alpine', 'running', 'healthy', 0, 864000),
      container('redis', 'redis:8-alpine', 'restarting', 'none', 7, 15),
      container('weekly-backup', 'alpine:3.22', 'exited', 'none', 0),
    ]}},
    {id: 'demo-rookery', name: 'rookery', snapshot: {engineVersion: '28.5.1', receivedAt: ago(22), containers: [
      container('grafana', 'grafana/grafana:12', 'running', 'healthy', 0, 518400),
      container('prometheus', 'prom/prometheus:v3', 'running', 'healthy', 0, 518400),
    ]}},
    {id: 'demo-workshop', name: 'workshop', snapshot: {engineVersion: '28.5.1', receivedAt: ago(420), containers: [
      container('build-runner', 'alpine:3.22', 'running', 'none', 0, 7200),
    ]}},
  ]};
  for(const h of data.hosts)for(const c of h.snapshot.containers){
    c.composeProject=['immich-server','postgres','redis'].includes(c.name)?'photos':['grafana','prometheus'].includes(c.name)?'monitoring':c.name==='weekly-backup'?'':c.name==='crowsnest-collector'?'crowsnest':'infra';
    c.composeService=c.composeProject?c.name:'';
  }
  data.hosts[1].maintenanceUntil=new Date(Date.now()+3600000).toISOString();
  data.availableCollectorVersion=version;
  data.hosts[0].snapshot.collectorVersion=version;data.hosts[1].snapshot.collectorVersion='0.8.0';data.hosts[2].snapshot.collectorVersion=version;
  for(const [index,host] of data.hosts.entries()) {
    host.group=index===2?'Home':'Production';
    if(index===1)continue; // Preserve an older collector's honest unavailable state.
    host.snapshot.resourceSampling='complete';
    for(const [number,c] of host.snapshot.containers.entries())if(c.state==='running')c.resources={cpuPercent:3.6+number*2.4,memoryBytes:(48+number*64)*1048576,memoryLimitBytes:1073741824,sampleSeconds:30};
  }
  return data;
}
function resourceFixtures(id) {
  if(id==='demo-rookery')return [];
  return Array.from({length:288},(_,i)=>({at:ago((287-i)*300+8),cpuPercent:i<2 || i===197?null:30+20*Math.sin(i/25)+7*Math.sin(i/6),memoryBytes:(1150+120*Math.sin(i/40))*1048576,runningContainers:5,sampling:i<2 || i===197?'warming':'complete'})).filter((_,i)=>i<82 || i>100);
}
const assets = new Map([
  ['/', ['worker/board.html', 'text/html; charset=utf-8']],
  ['/assets/board.js', ['worker/board.js', 'text/javascript; charset=utf-8']],
  ['/assets/board.css', ['worker/board.css', 'text/css; charset=utf-8']],
  ['/assets/crowsnest-mark.png', ['worker/assets/crowsnest-mark.png', 'image/png']],
]);
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Cache-Control', 'no-store');
  if(url.pathname==='/api/notifications' && req.method==='GET') {
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({configured:true,destination:'https://ntfy.example.com/crowsnest-illustrative-private-topic',authenticated:true,enabled:true,recoveries:true,hostReports:true,unhealthy:true,restarting:true,dead:true,staleMinutes:5,priority:4,lastSuccessAt:ago(180),lastSweepAt:ago(90)}));return;
  }
  if(url.pathname==='/api/resources' && req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({samples:resourceFixtures(url.searchParams.get('host')),windowSeconds:300,retentionHours:24}));return;}
  if(url.pathname==='/api/history' && req.method==='GET') {
    const events=[
      {at:ago(45),kind:'status',text:'immich-server: running/healthy → running/unhealthy',containerId:containerId('immich-server'),hostId:'demo-lighthouse',hostName:'lighthouse'},
      {at:ago(300),kind:'restart',text:'immich-server: 1 additional restart(s)',containerId:containerId('immich-server'),hostId:'demo-lighthouse',hostName:'lighthouse'},
      {at:ago(1800),kind:'container',text:'immich-server: image changed to ghcr.io/immich-app/immich-server:v2',containerId:containerId('immich-server'),hostId:'demo-lighthouse',hostName:'lighthouse'},
      {at:ago(7200),kind:'status',text:'immich-server: running/starting → running/healthy',matchedBy:'name',hostId:'demo-lighthouse',hostName:'lighthouse'},
      {at:ago(150),kind:'restart',text:'redis: 2 additional restart(s)',containerId:containerId('redis'),hostId:'demo-lighthouse',hostName:'lighthouse'},
      {at:ago(1800),kind:'report',text:'First collector report received',hostId:'demo-rookery',hostName:'rookery'},
    ];
    const selected=events.filter(e=>(!url.searchParams.has('host')||e.hostId===url.searchParams.get('host'))&&(!url.searchParams.has('group')||fixtures().hosts.find(h=>h.id===e.hostId)?.group===url.searchParams.get('group'))&&(!url.searchParams.has('container')||e.containerId===url.searchParams.get('container')||e.matchedBy==='name'&&url.searchParams.get('container')===containerId('immich-server'))).map(e=>({...e,matchedBy:e.matchedBy||'id'}));
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({events:selected,legacyMatches:selected.some(e=>e.matchedBy==='name')}));return;
  }
  if (url.pathname === '/api/hosts') {
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'GET') {
      res.writeHead(503); res.end(JSON.stringify({error: 'Local preview cannot register hosts.'})); return;
    }
    res.end(JSON.stringify(fixtures())); return;
  }
  const asset = assets.get(url.pathname);
  if (!asset) {res.writeHead(404); res.end(); return;}
  try {
    let body = await readFile(root + asset[0]);
    if (url.pathname === '/') {
      const {version} = JSON.parse(await readFile(root + 'package.json', 'utf8'));
      body = body.toString('utf8').replaceAll('__APP_VERSION__', version);
    }
    if(url.pathname==='/assets/board.js')body=(await readFile(root+'worker/versions.js','utf8'))+'\n'+(await readFile(root+'worker/collector-directory.js','utf8'))+'\n'+body.toString('utf8');
    res.setHeader('Content-Type', asset[1]); res.end(body);
  }
  catch {res.writeHead(404); res.end();}
});
server.listen(4175, '127.0.0.1', () => console.log('Synthetic Crowsnest preview: http://127.0.0.1:4175'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
