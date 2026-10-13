// Isolated image smoke test. Never mounts a real Docker socket or fleet credentials.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const image = process.argv[2] || 'crowsnest:0.11.0';
const name = 'crowsnest-check-' + randomUUID();
const volume = name + '-data';
const environment = {...process.env};
for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete environment[key];
function docker(args, input, acceptFailure = false) {
  const result = spawnSync('docker', ['--host=unix:///var/run/docker.sock', ...args], {env: environment, input, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024});
  if (result.error) throw result.error;
  if (!acceptFailure) assert.equal(result.status, 0, (result.stdout + '\n' + result.stderr).slice(-6000));
  return result;
}
const probe = `
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {readFileSync} from 'node:fs';
import {Storage} from './server/storage.mjs';
import {Authentication} from './server/auth.mjs';
const storage = new Storage('/data/crowsnest.sqlite');
const auth = new Authentication(storage, 'https://fleet.example.com');
const phase = process.env.CROWSNEST_CHECK_PHASE;
let cookie = '';
async function request(path, method = 'GET', data, extras = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest('http://127.0.0.1:8080' + path, {method, headers: {Host: 'fleet.example.com', Origin: 'https://fleet.example.com', ...(cookie ? {Cookie: cookie} : {}), ...extras}}, response => {
      const parts = []; response.on('data', part => parts.push(part));
      response.once('end', () => resolve({status: response.statusCode, cookie: response.headers['set-cookie']?.[0]?.split(';')[0], text: Buffer.concat(parts).toString()}));
      response.once('error', reject);
    });
    req.once('error', reject); req.end(data === undefined ? undefined : JSON.stringify(data));
  });
}
try {
  let ready = false;
  for(let attempt = 0; attempt < 50; attempt++) { try { if((await request('/healthz')).status === 200) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(ready, 'server readiness');
  console.log('Image probe: ready (' + phase + ')');
  assert.equal((await request('/api/hosts', 'GET', undefined, {'oai-authenticated-user-id': 'spoofed'})).status, 401);
  const password = 'fictional-image-test-password';
  if(phase === 'fresh') {
    const code = await auth.issueCode();
    const setup = await request('/auth/setup', 'POST', {username: 'owner', password, code});
    assert.equal(setup.status, 200); cookie = setup.cookie;
    console.log('Image probe: owner setup accepted');
    const result = await request('/api/hosts', 'POST', {name: 'image-test-host', format: 'setup'});
    assert.equal(result.status, 200);
    console.log('Image probe: enrollment accepted');
    const enrollment = JSON.parse(result.text);
    const bytes = Buffer.from(enrollment.packageBase64, 'base64');
    let config;
    for(let offset = 0; offset + 512 <= bytes.length;) {
      const filename = bytes.subarray(offset, offset+100).toString().split('\\0')[0]; if(!filename)break;
      const size = parseInt(bytes.subarray(offset+124, offset+136).toString().split('\\0')[0],8);
      if(filename === 'collector.json') config = JSON.parse(bytes.subarray(offset+512, offset+512+size));
      offset += 512 + Math.ceil(size/512)*512;
    }
    assert.equal(config.serviceToken, undefined);
    cookie = '';
    const fixture={engineVersion:'fixture',resourceSampling:'complete',containers:[{id:'a'.repeat(64),name:'fixture-container',image:'fixture',state:'running',health:'healthy',restarts:0,startedAt:'',finishedAt:'',resources:{cpuPercent:50,memoryBytes:800,memoryLimitBytes:2000,sampleSeconds:30}}]};
    assert.equal((await request('/api/ingest/'+enrollment.hostId, 'POST', fixture, {Authorization: 'Bearer '+config.hostToken})).status,200);
    const parallel = await Promise.all([request('/auth/login', 'POST', {username: 'owner', password}), request('/auth/login', 'POST', {username: 'owner', password})]);
    assert.ok(parallel.every(result => result.status === 200), 'two password hashes fit within the deployment memory limit');
    console.log('Image probe: concurrent sign-ins accepted');
    cookie=parallel[0].cookie;
    assert.equal((await request('/api/hosts/'+enrollment.hostId,'PATCH',{name:'image-test-host',group:'Fixture'})).status,200);
    assert.equal((await request('/api/notifications','PATCH',{enabled:false,recoveries:true,dead:false,priority:5,staleMinutes:10,cpuAlerts:true,cpuThreshold:200,resourceMinutes:15,restartBursts:true,restartCount:8,cooldownMinutes:30})).status,200);
    const resources=JSON.parse((await request('/api/resources?host='+enrollment.hostId)).text).samples;
    assert.equal(resources.length,1);assert.equal(resources[0].cpuPercent,50);assert.equal(resources[0].memoryBytes,800);
    assert.equal(resources[0].containers,undefined);
    assert.equal(JSON.parse((await request('/api/resources?host='+enrollment.hostId+'&container='+'a'.repeat(64))).text).samples[0].memoryBytes,800);
  } else {
    const login = await request('/auth/login', 'POST', {username: 'owner', password});
    assert.equal(login.status,200); cookie = login.cookie;
    const hosts = JSON.parse((await request('/api/hosts')).text).hosts;
    assert.equal(hosts.length,1); assert.equal(hosts[0].name,'image-test-host'); assert.ok(hosts[0].snapshot);
    assert.equal(hosts[0].group,'Fixture');
    assert.equal(JSON.parse((await request('/api/resources?host='+hosts[0].id)).text).samples[0].memoryBytes,800);
    assert.equal(JSON.parse((await request('/api/resources?host='+hosts[0].id+'&container='+'a'.repeat(64))).text).samples[0].memoryBytes,800);
    const policy=JSON.parse((await request('/api/notifications')).text);assert.equal(policy.dead,false);assert.equal(policy.priority,5);assert.equal(policy.staleMinutes,10);
    assert.equal(policy.cpuAlerts,true);assert.equal(policy.cpuThreshold,200);assert.equal(policy.resourceMinutes,15);assert.equal(policy.restartBursts,true);assert.equal(policy.restartCount,8);assert.equal(policy.cooldownMinutes,30);
  }
  console.log('Image check passed: '+phase);
  try { console.log('Image peak memory bytes: '+readFileSync('/sys/fs/cgroup/memory.peak','utf8').trim()); } catch {}
} finally { await storage.close(); }
`;
try {
  docker(['volume', 'create', volume]);
  docker(['run', '--detach', '--init', '--name', name, '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--pids-limit', '128', '--memory', '768m', '--tmpfs', '/tmp:size=16m,mode=1777', '--volume', volume + ':/data', '--env', 'CROWSNEST_PUBLIC_URL=https://fleet.example.com', image]);
  const inspect = JSON.parse(docker(['inspect', name]).stdout)[0];
  assert.equal(inspect.Config.User, 'node'); assert.equal(inspect.HostConfig.ReadonlyRootfs, true); assert.equal(inspect.HostConfig.Privileged, false);
  assert.equal(inspect.Mounts.some(mount => mount.Source.includes('docker.sock')), false);
  for (const phase of ['fresh', 'restart']) {
    if (phase === 'restart') docker(['restart', '--time', '30', name]);
    const result = docker(['exec', '-i', '--env', 'CROWSNEST_CHECK_PHASE=' + phase, name, 'node', '--input-type=module'], probe);
    process.stdout.write(result.stdout);
  }
  docker(['exec', name, 'node', 'server/cli.mjs', 'backup', '/data/backup.sqlite']);
  const blocked = docker(['exec', name, 'node', 'server/cli.mjs', 'restore', '/data/backup.sqlite'], undefined, true);
  assert.equal(blocked.status, 73, 'restore must refuse a running server');
  docker(['stop', '--time', '30', name]);
  docker(['run', '--rm', '--network', 'none', '--volume', volume + ':/data', '--entrypoint', 'node', image, 'server/cli.mjs', 'restore', '/data/backup.sqlite']);
  docker(['start', name]);
  process.stdout.write(docker(['exec', '-i', '--env', 'CROWSNEST_CHECK_PHASE=restored', name, 'node', '--input-type=module'], probe).stdout);
  console.log('Docker checks passed: isolated unprivileged runtime, enrollment/reporting, restart, consistent backup, live-restore refusal, stopped restore');
} catch (error) {
  // Only this fictional, owned test container is inspected. No production logs or credentials.
  const state = docker(['inspect', '--format', '{{json .State}}', name], undefined, true);
  if (state.status === 0) console.error('Test container state: ' + state.stdout.trim());
  const memory = docker(['exec', name, 'node', '--input-type=module', '-e', "import {readFileSync} from 'node:fs'; for(const key of ['memory.events','memory.current','memory.peak','memory.max']) {try {console.log(key+': '+readFileSync('/sys/fs/cgroup/'+key,'utf8').trim());}catch{}}"], undefined, true);
  if (memory.status === 0) console.error('Test cgroup memory: ' + memory.stdout.trim());
  throw error;
} finally {
  docker(['rm', '--force', name], undefined, true);
  docker(['volume', 'rm', volume], undefined, true);
}
