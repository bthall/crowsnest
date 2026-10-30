import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {checkGitCollectorChanges, validateCopyInputCoverage} from './check-collector-changes.mjs';
import {compareVersions, renderManager, validateCollectorMetadata} from './collector-metadata.mjs';

const metadata = {version: '0.11.1', protocol: 1, minimumProtocol: 1, managerVersion: '1.0.0', minimumManagerVersion: '1.0.0'};
assert.equal(compareVersions('0.11.10', '0.11.9'), 1);
for (const patch of [{protocol: 0}, {minimumProtocol: 2}, {minimumProtocol: null}, {managerVersion: '1'}, {minimumManagerVersion: '1.0.1'}]) {
  assert.throws(() => validateCollectorMetadata({...metadata, ...patch}));
}
assert.throws(() => renderManager('missing marker', metadata));
assert.throws(() => renderManager('__MANAGER_METADATA__ __MANAGER_METADATA__', metadata));

const covered = {'collector/a.py': '100644 blob a', 'collector/runtime/b.py': '100644 blob b', 'worker/collector.py': '100644 blob c'};
const recipes = copy => ({'collector/Dockerfile': 'FROM python:fixture\n' + copy + '\n', 'collector/Dockerfile.proxy': 'FROM haproxy:fixture\n'});
for (const copy of ['COPY --chown=1000:1000 --chmod=0444 collector/*.py /app/', 'COPY ["collector/runtime/", "/app/"]', 'COPY collector/ /app/', 'COPY collector/**/*.py /app/', 'COPY worker/collector.py \\\n    /app/collector.py']) validateCopyInputCoverage(covered, recipes(copy));
for (const copy of ['COPY --from=builder /app/result /app/', 'ADD https://example.invalid/code /app/', 'COPY $SOURCE /app/', 'COPY ["collector/a.py"]', 'COPY collector/missing/ /app/', 'COPY collector/[ab].py /app/', 'COPY collector/a.py `\n worker/untracked.py /app/']) assert.throws(() => validateCopyInputCoverage(covered, recipes(copy)), /coverage|COPY|tracked/);
assert.throws(() => validateCopyInputCoverage({...covered, 'worker/untracked.py': '100644 blob d'}, recipes('COPY worker/*.py /app/')), /Untracked collector release inputs/);
assert.throws(() => validateCopyInputCoverage({...covered, 'collector/link': '120000 blob a'}, recipes('COPY collector/ /app/')), /Unsupported collector build input type/);
assert.throws(() => validateCopyInputCoverage(covered, {'collector/Dockerfile': '# escape=`\nCOPY collector/a.py `\n worker/untracked.py /app/', 'collector/Dockerfile.proxy': 'FROM haproxy:fixture'}), /Unsupported Dockerfile escape/);

for (const scenario of ['first', 'unchanged', 'dashboard', 'tests', 'collector-unbumped', 'collector-bumped', 'base-unbumped', 'proxy-unbumped', 'manager-unbumped', 'manager-bumped', 'protocol-unbumped', 'protocol-bumped', 'version-decreased', 'new-uncovered-copy', 'new-covered-copy', 'missing-copy-source']) {
  const directory = mkdtempSync(join(tmpdir(), 'crowsnest-version-guard-'));
  const git = args => execFileSync('git', args, {cwd: directory, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8'});
  const put = (path, value) => {mkdirSync(join(directory, path.split('/').slice(0, -1).join('/')), {recursive: true}); writeFileSync(join(directory, path), value);};
  try {
    git(['init', '--quiet']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
    put('collector/version.json', JSON.stringify(metadata));
    put('collector/crowsnest', "metadata='__MANAGER_METADATA__'\n");
    put('collector/Dockerfile', 'FROM python:fixture\nCOPY worker/collector.py /app/collector.py\n');
    put('collector/Dockerfile.proxy', 'FROM haproxy:fixture\nCOPY worker/proxy.cfg /app/proxy.cfg\n');
    put('worker/collector.py', '# Initial collector\n');
    put('worker/proxy.cfg', '# Initial proxy\n');
    git(['add', '.']); git(['commit', '--quiet', '-m', 'Initial collector']);
    if (scenario !== 'first') git(['tag', '-a', 'collector-v0.11.1', '-m', 'Published collector']);
    const next = {...metadata};
    if (scenario === 'dashboard') put('worker/board.js', '// UI change\n');
    if (scenario === 'tests') put('scripts/check-collector.py', '# New test\n');
    if (scenario.startsWith('collector-')) put('worker/collector.py', '# Fixed collector\n');
    if (scenario.startsWith('manager-')) put('collector/crowsnest', "metadata='__MANAGER_METADATA__'\n# Manager improvement\n");
    if (scenario.startsWith('protocol-')) next.protocol = 2;
    if (scenario === 'base-unbumped') put('collector/Dockerfile', 'FROM python:new-fixture\n');
    if (scenario === 'proxy-unbumped') put('worker/proxy.cfg', '# Fixed proxy\n');
    if (scenario.endsWith('-bumped') || scenario === 'manager-unbumped' || scenario === 'protocol-unbumped') next.version = '0.11.2';
    if (scenario === 'manager-bumped' || scenario === 'protocol-bumped') next.managerVersion = '1.0.1';
    if (scenario === 'new-uncovered-copy') {
      put('worker/new-runtime.py', '# New helper\n');
      put('collector/Dockerfile', 'FROM python:fixture\nCOPY worker/new-runtime.py /app/helper.py\n');
      next.version = '0.11.2';
    }
    if (scenario === 'new-covered-copy') {
      put('collector/runtime/helper.py', '# New helper\n');
      put('collector/Dockerfile', 'FROM python:fixture\nCOPY ["collector/runtime/", "/app/"]\n');
      next.version = '0.11.2';
    }
    if (scenario === 'missing-copy-source') put('collector/Dockerfile', 'FROM python:fixture\nCOPY collector/missing/ /app/\n');
    if (scenario === 'version-decreased') next.version = '0.11.0';
    put('collector/version.json', JSON.stringify(next));
    git(['add', '.']); git(['commit', '--quiet', '--allow-empty', '-m', 'Candidate']);
    if (scenario === 'new-uncovered-copy') assert.throws(() => checkGitCollectorChanges(directory), /Untracked collector release inputs/);
    else if (scenario === 'missing-copy-source') assert.throws(() => checkGitCollectorChanges(directory), /matches no tracked build input/);
    else if (scenario.endsWith('-unbumped') || scenario === 'version-decreased') assert.throws(() => checkGitCollectorChanges(directory), /without a newer/, scenario);
    else {
      const result = checkGitCollectorChanges(directory);
      assert.equal(result.firstRelease, scenario === 'first');
      if (['unchanged', 'dashboard', 'tests'].includes(scenario)) assert.deepEqual(result.changed, []);
    }
  } finally {rmSync(directory, {recursive: true, force: true});}
}
console.log('Collector change guard passed: published-tag baselines, base/source/proxy changes, release and manager bumps, protocol changes, and dashboard/test-only exemptions');
