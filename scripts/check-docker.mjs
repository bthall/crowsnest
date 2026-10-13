// Isolated image smoke test. Never mounts a real Docker socket or fleet credentials.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const image = process.argv[2] || 'crowsnest:0.8.0';
const name = 'crowsnest-check-' + randomUUID();
const volume = name + '-data';
const environment = {...process.env};
for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete environment[key];
function docker(args, input, acceptFailure = false) {
  const result = spawnSync('docker', ['--host=unix:///var/run/docker.sock', ...args], {env: environment, input, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024});
  if (result.error) throw result.error;
  if (!acceptFailure) assert.equal(result.status, 0, result.stderr);
  return result;
}
const probe = `
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
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
  assert.equal((await request('/api/hosts', 'GET', undefined, {'oai-authenticated-user-id': 'spoofed'})).status, 401);
  const password = 'fictional-image-test-password';
  if(phase === 'fresh') {
    const code = await auth.issueCode();
    const setup = await request('/auth/setup', 'POST', {username: 'owner', password, code});
    assert.equal(setup.status, 200); cookie = setup.cookie;
    const result = await request('/api/hosts', 'POST', {name: 'image-test-host', format: 'setup'});
    assert.equal(result.status, 200);
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
    assert.equal((await request('/api/ingest/'+enrollment.hostId, 'POST', {engineVersion: 'fixture', containers: []}, {Authorization: 'Bearer '+config.hostToken})).status,200);
  } else {
    const login = await request('/auth/login', 'POST', {username: 'owner', password});
    assert.equal(login.status,200); cookie = login.cookie;
    const hosts = JSON.parse((await request('/api/hosts')).text).hosts;
    assert.equal(hosts.length,1); assert.equal(hosts[0].name,'image-test-host'); assert.ok(hosts[0].snapshot);
  }
  console.log('Image check passed: '+phase);
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
} finally {
  docker(['rm', '--force', name], undefined, true);
  docker(['volume', 'rm', volume], undefined, true);
}
