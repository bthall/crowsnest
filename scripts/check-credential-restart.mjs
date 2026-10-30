// Execute the dashboard's real token-replacement handler and its generated Bash.
// The transport and Docker entry points are fixtures; install still writes a real
// private configuration file, and the saved deployment must remain byte-exact.
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import vm from 'node:vm';

const board = readFileSync('worker/board.js', 'utf8');
const start = board.indexOf("$('rotate-token').onclick=async()=>{");
const end = board.indexOf('const context = document.modelContext;', start);
assert.ok(start >= 0 && end > start, 'Locate the actual token replacement handler');
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, {focus() {}});
  return elements.get(id);
};
let mutations = 0, enrollmentUpdates = 0;
const context = vm.createContext({
  $: element, managedId: 'fixture-host', managementSession: 3,
  hosts: [{id: 'fixture-host', credentialRevision: 8}],
  configUrl: null, rotationRevision: null, rotationExpiry: null,
  Date, URL: {createObjectURL() {return 'blob:fixture';}, revokeObjectURL() {}},
  managementCurrent: (session, id) => session === 3 && id === 'fixture-host',
  async mutate(path, method, options) {
    mutations++;
    assert.equal(path, '/api/hosts/fixture-host/collector');
    assert.equal(method, 'POST');
    assert.equal(options.format, 'config');
    return {async blob() {return {};}};
  },
  updateEnrollment() {enrollmentUpdates++;},
  showError(_id, error) {throw error;},
});
vm.runInContext(readFileSync('worker/collector-directory.js', 'utf8') + '\n' + board.slice(start, end), context);
await vm.runInContext("$('rotate-token').onclick()", context);
assert.equal(mutations, 1);
assert.equal(enrollmentUpdates, 1);
assert.equal(element('rotate-token').disabled, false);
assert.equal(element('rotation-result').hidden, false);
assert.equal(context.rotationRevision, 8);
const command = element('rotation-commands').textContent;
assert.equal(typeof command, 'string');

const temporary = mkdtempSync(join(tmpdir(), 'crowsnest-credential-restart-'));
try {
  const bin = join(temporary, 'bin');
  mkdirSync(bin);
  const install = execFileSync('sh', ['-c', 'command -v install'], {encoding: 'utf8'}).trim();
  // Redirect only the download source through an install shim, without changing
  // HOME or reading any actual user download. The generated command is unchanged.
  writeFileSync(join(bin, 'install'), `#!/bin/sh
set -eu
test "$#" -eq 4
test "$1" = -m
test "$2" = 0600
test "$3" = "$HOME/Downloads/collector.json"
test "$4" = ./collector.json
exec "$ROTATION_INSTALL" -m 0600 "$ROTATION_SOURCE" "$4"
`, {mode: 0o755});
  const log = name => `printf '${name}' >> "$ROTATION_CALLS"\nprintf ' <%s>' "$@" >> "$ROTATION_CALLS"\nprintf '\\n' >> "$ROTATION_CALLS"\n`;
  writeFileSync(join(bin, 'sudo'), '#!/bin/sh\nset -eu\n' + log('sudo') + 'exec "$@"\n', {mode: 0o755});
  writeFileSync(join(bin, 'docker'), '#!/bin/sh\nset -eu\n' + log('docker'), {mode: 0o755});
  const newCredentials = '{"hostToken":"test-host-token","hostId":"fixture-host"}\n';
  const source = join(temporary, 'replacement.json');
  writeFileSync(source, newCredentials, {mode: 0o600});
  const scenarios = [
    {name: 'legacy-with-manager', manager: true},
    {name: 'managed-active', active: true, manager: true},
    {name: 'managed-state', state: true, manager: true},
    {name: 'managed-both', active: true, state: true, manager: true},
    {name: 'interrupted-first-migration', pending: true, manager: true, fail: true},
    {name: 'managed-restart-fails', active: true, state: true, manager: true, fail: true},
    {name: 'managed-manager-missing', active: true, state: true},
    {name: 'managed-manager-not-executable', active: true, state: true, manager: true, notExecutable: true},
  ];
  for (const scenario of scenarios) {
    const directory = join(temporary, scenario.name + " collector's files");
    mkdirSync(directory);
    const files = new Map([
      ['compose.yaml', 'name: fixture\nservices: {}\n'],
      ['compose.override.yaml', 'services: {collector: {environment: {CUSTOM: "literal$value"}}}\n'],
      ['.env', 'COLLECTOR_UID=1234\nCOLLECTOR_GID=1234\n'],
    ]);
    if (scenario.active || scenario.state || scenario.pending) {
      mkdirSync(join(directory, '.crowsnest'), {mode: 0o700});
      if (scenario.active) files.set('.crowsnest/active.json', '{"name":"saved-deployment","images":"immutable-fixture"}\n');
      if (scenario.state) files.set('.crowsnest/state.json', '{"version":"0.11.1","daemonId":"fixture-daemon"}\n');
      if (scenario.pending) files.set('.crowsnest/pending.json', '{"previous":"pending-recovery-fixture"}\n');
      files.set('.crowsnest/previous.json', '{"config":"private-recovery-fixture"}\n');
    }
    for (const [file, contents] of files) writeFileSync(join(directory, file), contents, {mode: 0o600});
    writeFileSync(join(directory, 'collector.json'), 'old-fixture-config', {mode: 0o600});
    if (scenario.manager) writeFileSync(join(directory, 'crowsnest'), '#!/bin/sh\nset -eu\n' + log('manager') +
      'test "$#" -eq 1\ntest "$1" = restart\n' + (scenario.fail ? 'exit 42\n' : ''), {mode: scenario.notExecutable ? 0o600 : 0o700});
    const calls = join(directory, 'calls');
    writeFileSync(calls, '');
    const result = spawnSync('bash', [], {input: command, encoding: 'utf8', timeout: 10000,
      env: {...process.env, PATH: bin + ':' + process.env.PATH, CROWSNEST_COLLECTOR_DIR: directory,
        ROTATION_INSTALL: install, ROTATION_SOURCE: source, ROTATION_CALLS: calls}});
    assert.ifError(result.error);
    const managed = !!(scenario.active || scenario.state || scenario.pending);
    const success = !managed || (scenario.manager && !scenario.fail && !scenario.notExecutable);
    if (success) assert.equal(result.status, 0, scenario.name + ': ' + result.stderr);
    else assert.notEqual(result.status, 0, scenario.name + ' must report failure');
    const observed = readFileSync(calls, 'utf8');
    if (managed) {
      const expected = scenario.manager && !scenario.notExecutable ? 'manager <restart>\n' : '';
      assert.equal(observed, expected, scenario.name + ' must never fall back to the legacy deployment');
    } else {
      assert.equal(observed, 'sudo <docker> <compose> <up> <-d> <--force-recreate> <collector>\n' +
        'docker <compose> <up> <-d> <--force-recreate> <collector>\n');
    }
    assert.equal(readFileSync(join(directory, 'collector.json'), 'utf8'), newCredentials);
    assert.equal(statSync(join(directory, 'collector.json')).mode & 0o777, 0o600);
    for (const [file, contents] of files) assert.equal(readFileSync(join(directory, file), 'utf8'), contents,
      scenario.name + ' must preserve ' + file);
  }
} finally {rmSync(temporary, {recursive: true, force: true});}
console.log('Credential restart checks passed: actual dashboard command, legacy/managed routing, fail-closed manager restart, private credentials, and unchanged saved deployment');
