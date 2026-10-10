// Local-only UI preview. All hosts and container data below are fictional.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const ago = seconds => new Date(Date.now() - seconds * 1000).toISOString();
const container = (name, image, state, health, restarts = 0, uptime = 86400) => ({
  id: name.padEnd(64, '0'), name, image, state, health, restarts,
  startedAt: ago(uptime), finishedAt: state === 'exited' ? ago(1800) : '',
});
function fixtures() {
  return {hosts: [
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
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({configured:true,destination:'https://ntfy.example.com/crowsnest-demo',authenticated:true,enabled:true,recoveries:true,lastSuccessAt:ago(180),lastSweepAt:ago(90)}));return;
  }
  if(url.pathname==='/api/history' && req.method==='GET') {
    const events=[
      {at:ago(45),kind:'status',text:'immich-server: running/healthy → running/unhealthy',hostId:'demo-lighthouse',hostName:'lighthouse'},
      {at:ago(150),kind:'restart',text:'redis: 2 additional restart(s)',hostId:'demo-lighthouse',hostName:'lighthouse'},
      {at:ago(1800),kind:'report',text:'First collector report received',hostId:'demo-rookery',hostName:'rookery'},
    ];
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({events:events.filter(e=>!url.searchParams.has('host')||e.hostId===url.searchParams.get('host'))}));return;
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
    res.setHeader('Content-Type', asset[1]); res.end(body);
  }
  catch {res.writeHead(404); res.end();}
});
server.listen(4175, '127.0.0.1', () => console.log('Synthetic Crowsnest preview: http://127.0.0.1:4175'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
