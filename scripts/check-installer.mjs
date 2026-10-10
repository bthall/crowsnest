import assert from 'node:assert/strict';
import {chmodSync,mkdtempSync,mkdirSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const root=mkdtempSync(path.join(os.tmpdir(),'docker-watch-install-test-'));
const bin=path.join(root,'bin'), calls=path.join(root,'calls');
mkdirSync(bin);
writeFileSync(path.join(bin,'docker'),`#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$TEST_DOCKER_CALLS"
if [[ "$*" == 'container inspect '* ]]; then exit 1; fi
if [[ "$*" == 'info' && "\${TEST_DOCKER_DENIED:-}" == 1 && "\${TEST_USING_SUDO:-}" != 1 ]]; then exit 1; fi
if [[ "$*" == 'compose up -d' && "\${TEST_STARTUP_FAILURE:-}" == 1 ]]; then exit 1; fi
`);
writeFileSync(path.join(bin,'sudo'),`#!/usr/bin/env bash
set -eu
export TEST_USING_SUDO=1
exec "$@"
`);
for(const name of ['docker','sudo'])chmodSync(path.join(bin,name),0o755);
const env={...process.env,PATH:bin+':'+process.env.PATH,TEST_DOCKER_CALLS:calls};
const run=(script,args=[],extra={})=>spawnSync('bash',[script,...args],{cwd:root,env:{...env,...extra},encoding:'utf8'});
try {
  const script=path.join(process.env.DOCKER_WATCH_TEST_DIRECTORY||'/tmp','docker-watch-test-setup.sh');
  for(const file of [script])assert.equal(spawnSync('bash',['-n',file]).status,0);
  assert.match(readFileSync(script,'utf8'),/\/srv\/docker\/docker-dashboard-collector/);
  const target=path.join(root,'new-install');
  const result=run(script,[target]);assert.equal(result.status,0,result.stderr);
  assert.equal(statSync(target).mode&0o777,0o700);
  assert.equal(statSync(path.join(target,'collector.json')).mode&0o777,0o600);
  assert.equal(statSync(path.join(target,'.env')).mode&0o777,0o600);
  assert.equal(statSync(path.join(target,'proxy.cfg')).mode&0o777,0o644);
  const compose=readFileSync(path.join(target,'compose.yaml'),'utf8');
  assert.match(compose,/name: docker-dashboard\n/);
  assert.match(compose,/container_name: docker-dashboard-collector/);
  assert.match(compose,/container_name: docker-dashboard-socket-proxy/);
  assert.match(compose,/user: "\$\{COLLECTOR_UID/);
  const originalConfig=readFileSync(path.join(target,'collector.json'),'utf8');
  assert.notEqual(run(script,[target]).status,0);
  assert.equal(readFileSync(path.join(target,'collector.json'),'utf8'),originalConfig);
  const failed=path.join(root,'failed');
  const failure=run(script,[failed],{TEST_STARTUP_FAILURE:'1'});
  assert.notEqual(failure.status,0);
  assert.match(failure.stderr,/Installation files are retained/);
  assert.equal(statSync(path.join(failed,'collector.json')).mode&0o777,0o600);
  assert.notEqual(run(script,[path.join(root,'one'),path.join(root,'two')]).status,0);
  if(process.getuid()!==0) {
    const sudoTarget=path.join(root,'sudo-docker');
    const sudoResult=run(script,[sudoTarget],{TEST_DOCKER_DENIED:'1'});
    assert.equal(sudoResult.status,0,sudoResult.stderr);
    assert.match(sudoResult.stdout,/Docker access requires sudo/);
    assert.equal(statSync(path.join(sudoTarget,'collector.json')).uid,process.getuid());
    assert.equal(statSync(path.join(sudoTarget,'collector.json')).mode&0o777,0o600);
  }
  const link=path.join(root,'symlink');
  const {symlinkSync}=await import('node:fs');symlinkSync(target,link);
  assert.notEqual(run(script,[link]).status,0);
  console.log('Passed: installer paths, private credentials, readable code, clean names, overwrite protection, and failed-startup credential retention.');
} finally {rmSync(root,{recursive:true,force:true});}
