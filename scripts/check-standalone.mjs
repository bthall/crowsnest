import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {request as httpRequest} from 'node:http';
import {createRuntime} from '../server/runtime.mjs';
import {configuration} from '../server/config.mjs';
import {Storage} from '../server/storage.mjs';
import {Authentication} from '../server/auth.mjs';

const directory = await mkdtemp(join(tmpdir(), 'crowsnest-standalone-'));
let runtime;
let cookie = '';
const domain = 'https://fleet.example.com:8443';
const config = {...configuration({CROWSNEST_PUBLIC_URL: domain, CROWSNEST_DATA_DIR: directory}), port: 0};
let address;
async function start() {
  runtime = await createRuntime(config, {schedule: false});
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  address = 'http://127.0.0.1:' + runtime.server.address().port;
}
async function request(path, {method = 'GET', data, headers = {}, signed = true} = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(address + path, {method, headers: {Host: 'fleet.example.com:8443', ...(signed && cookie ? {Cookie: cookie} : {}), ...(method !== 'GET' ? {Origin: domain} : {}), ...(data !== undefined ? {'Content-Type': 'application/json'} : {}), ...headers}}, response => {
      const parts = [];
      response.on('data', part => parts.push(part));
      response.once('end', () => resolve(new Response(Buffer.concat(parts), {status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value]))})));
      response.once('error', reject);
    });
    outgoing.once('error', reject);
    outgoing.end(data === undefined ? undefined : JSON.stringify(data));
  });
}
function cli(args) {
  const result = spawnSync(process.execPath, ['server/cli.mjs', ...args], {cwd: resolve('.'), env: {...process.env, CROWSNEST_PUBLIC_URL: domain, CROWSNEST_DATA_DIR: directory}, encoding: 'utf8'});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
const password = 'fictional-owner-password-for-tests';
try {
  for (const url of ['http://fleet.example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?token=test']) assert.throws(() => configuration({CROWSNEST_PUBLIC_URL: url}));
  await start();
  assert.equal((await request('/healthz', {signed: false, headers: {Host: '127.0.0.1'}})).status, 200);
  assert.equal((await request('/api/hosts', {signed: false})).status, 401);
  assert.equal((await request('/api/hosts', {signed: false, headers: {'oai-authenticated-user-id': 'spoofed', 'OAI-Sites-Authorization': 'Bearer spoofed'}})).status, 401);
  assert.equal((await request('/api/hosts', {headers: {Host: 'attacker.example.com'}})).status, 421);
  const home = await request('/', {signed: false});
  assert.equal(home.status, 303); assert.equal(home.headers.get('location'), '/login');
  const linked='/?host=00000000-0000-4000-8000-000000000000&container='+('a'.repeat(64));
  assert.equal((await request(linked,{signed:false})).headers.get('location'),'/login?next='+encodeURIComponent(linked));
  assert.equal((await request('/login', {signed: false})).status, 200);
  assert.equal((await request('/assets/crowsnest-mark.png', {signed: false})).status, 200);
  assert.equal((await request('/assets/board.js', {signed: false})).status, 401);
  assert.equal((await request('/auth/state')).headers.get('cache-control'), 'no-store');
  assert.deepEqual(await (await request('/auth/state')).json(), {setupRequired: true});
  assert.equal((await request('/auth/setup', {method: 'POST', signed: false, data: {username: 'owner', password, code: 'unissued-code'}})).status, 403);
  const code = await runtime.authentication.issueCode();
  assert.equal((await request('/auth/setup', {method: 'POST', data: {username: 'owner', password, code}, headers: {Origin: 'https://attacker.example.com'}})).status, 403);
  const enrolled = await request('/auth/setup', {method: 'POST', data: {username: 'owner', password, code}});
  assert.equal(enrolled.status, 200);
  const setCookie = enrolled.headers.get('set-cookie');
  for (const flag of ['__Host-crowsnest=', 'HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/']) assert.ok(setCookie.includes(flag));
  cookie = setCookie.split(';')[0];
  assert.equal((await request('/login?next='+encodeURIComponent(linked))).headers.get('location'),linked);
  for(const next of ['https://attacker.example.com/','//attacker.example.com/','/\\attacker.example.com/','/api/hosts'])assert.equal((await request('/login?next='+encodeURIComponent(next))).headers.get('location'),'/');
  const owner = runtime.storage.db.prepare('SELECT * FROM owner').get();
  assert.notEqual(owner.password, password); assert.ok(owner.password.startsWith('scrypt$'));
  const session = runtime.storage.db.prepare('SELECT hash FROM sessions').get();
  assert.ok(!cookie.includes(session.hash));
  assert.equal(runtime.storage.db.prepare('SELECT id FROM bootstrap').get(), undefined);
  assert.equal((await request('/auth/setup', {method: 'POST', data: {username: 'other', password, code}})).status, 403);
  const board = await request('/'); assert.equal(board.status, 200); assert.ok((await board.text()).includes('data-auth-mode="standalone"'));
  const enroll = await request('/api/hosts', {method: 'POST', data: {name: 'test-host', format: 'setup'}});
  assert.equal(enroll.status, 200);
  const setup = await enroll.json();
  const packageBytes = Buffer.from(setup.packageBase64, 'base64');
  let collector;
  for (let offset = 0; offset + 512 <= packageBytes.length;) {
    const name = packageBytes.subarray(offset, offset + 100).toString().split('\0')[0];
    if (!name) break;
    const length = parseInt(packageBytes.subarray(offset + 124, offset + 136).toString().split('\0')[0], 8);
    if (name === 'collector.json') collector = JSON.parse(packageBytes.subarray(offset + 512, offset + 512 + length));
    offset += 512 + Math.ceil(length / 512) * 512;
  }
  assert.equal(collector.url, domain); assert.equal(collector.serviceToken, undefined);
  assert.equal((await request('/api/ingest/' + setup.hostId, {method: 'POST', signed: false, data: {engineVersion: 'test', collectorVersion: '0.8.0', containers: []}, headers: {Authorization: 'Bearer ' + collector.hostToken, Origin: 'https://unrelated.example.com'}})).status, 200);
  const hosts = await (await request('/api/hosts')).json();
  assert.equal(hosts.hosts[0].snapshot.containers.length, 0);
  const simultaneous = await Promise.all(['TEST-HOST', 'new-host', 'NEW-HOST'].map(name => request('/api/hosts', {method: 'POST', data: {name, format: 'setup'}})));
  assert.equal(simultaneous[0].status, 409);
  assert.equal(simultaneous.filter(response => response.status === 200).length, 1);
  assert.equal((await request('/api/hosts', {method: 'POST', data: {name: 'wrong-origin'}, headers: {Origin: ''}})).status, 403);
  assert.equal((await request('/auth/login', {method: 'POST', data: null})).status, 400);
  assert.equal((await request('/auth/login', {method: 'POST', data: {username: 'owner', password: 'x'.repeat(9000)}})).status, 413);
  assert.equal((await request('/auth/login', {method: 'POST', data: {username: 'owner', password: 'incorrect-test-password'}})).status, 401);
  const before = await (await request('/api/hosts')).json();
  await runtime.close();
  runtime = null;
  await start();
  assert.equal((await request('/api/hosts')).status, 200);
  assert.deepEqual((await (await request('/api/hosts')).json()).hosts, before.hosts);
  const backup = join(directory, 'backup.sqlite');
  cli(['backup', backup]);
  assert.equal((await stat(backup)).mode & 0o777, 0o600);
  await runtime.storage.run(async () => { await runtime.storage.put('rollback-test', '{}'); throw new Error('forced rollback'); }, {atomic: true}).catch(() => {});
  assert.equal(await runtime.storage.get('rollback-test'), null);
  // A separate operation must wait until the entire transaction commits.
  assert.ok(await runtime.storage.put('first-write-check','{}',{onlyIf:{etagDoesNotMatch:'*'}}));
  assert.equal(await runtime.storage.put('first-write-check','{"changed":true}',{onlyIf:{etagDoesNotMatch:'*'}}),null);
  assert.deepEqual(await (await runtime.storage.get('first-write-check')).json(),{});
  await runtime.storage.delete('first-write-check');
  const transaction = runtime.storage.run(async () => { await runtime.storage.put('coherent-a', '{}'); await new Promise(resolve => setTimeout(resolve, 10)); await runtime.storage.put('coherent-b', '{}'); }, {atomic: true});
  const observer = runtime.storage.run(() => runtime.storage.db.prepare("SELECT count(*) AS n FROM objects WHERE key LIKE 'coherent-%'").get().n);
  await transaction; assert.equal(await observer, 2);
  const recoveredCode = await runtime.authentication.issueCode('reset');
  const recovery = await request('/auth/setup', {method: 'POST', data: {username: 'owner', password: password + '-new', code: recoveredCode, recovery: true}});
  assert.equal(recovery.status, 200);
  assert.equal((await request('/api/hosts')).status, 401);
  cookie = recovery.headers.get('set-cookie').split(';')[0];
  await runtime.sweep();
  assert.ok((await (await request('/api/notifications/sweep')).json()).at);
  await runtime.close(); runtime = null;
  cli(['restore', backup]);
  await start();
  assert.equal((await request('/api/hosts')).status, 401);
  cookie = '';
  const login = await request('/auth/login', {method: 'POST', data: {username: 'owner', password}});
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
  assert.deepEqual((await (await request('/api/hosts')).json()).hosts, before.hosts);
  assert.equal((await request('/auth/logout', {method: 'POST'})).status, 200);
  assert.equal((await request('/api/hosts')).status, 401);
  const localAuth = new Authentication(runtime.storage, 'http://127.0.0.1:8080');
  assert.equal(localAuth.cookieName, 'crowsnest_local');
  for (let i = 0; i < 11; i++) await localAuth.login({username: 'owner', password: ''}, 'fictional-rate-test').catch(() => {});
  await assert.rejects(localAuth.login({username: 'owner', password}, 'fictional-rate-test'), error => error.status === 429);
  assert.equal((await stat(config.database)).mode & 0o777, 0o600);
  console.log('Standalone checks passed: private access, CSRF, spoofed identity, setup/recovery, persistence, concurrent enrollment, transactions, backup/restore, logout, rate limits');
} finally { if (runtime) await runtime.close(); await rm(directory, {recursive: true, force: true}); }
