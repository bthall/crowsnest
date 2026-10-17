import assert from 'node:assert/strict';
import {copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {releaseContext, prepareRelease, releaseCompose, releasePlatforms, changelogNotes} from './release.mjs';

const sha = 'a'.repeat(40), other = 'b'.repeat(40), digest = 'sha256:' + 'c'.repeat(64);
const event = {repository: {id: 1, full_name: 'fixture/crowsnest'}, workflow_run: {name: 'Security', event: 'push', head_branch: 'main', conclusion: 'success', head_sha: sha, head_repository: {id: 1}}};
const context = releaseContext(event, 'fixture/crowsnest', '0.8.0');
assert.equal(context.image, 'ghcr.io/fixture/crowsnest');
for (const changes of [{event: 'pull_request'}, {head_repository: {id: 2}}, {head_branch: 'topic'}, {conclusion: 'failure'}, {head_sha: 'invalid'}]) assert.throws(() => releaseContext({...event, workflow_run: {...event.workflow_run, ...changes}}, 'fixture/crowsnest', '0.8.0'));
for (const version of ['01.0.0', '1.0.0-01', '1.0.0+metadata', '1.0.0\nskip=false']) assert.throws(() => releaseContext(event, 'fixture/crowsnest', version));
releaseContext(event, 'fixture/crowsnest', '1.0.0-rc.1');
const index = {annotations: {'org.opencontainers.image.revision': sha}, manifests: [{platform: {os: 'linux', architecture: 'amd64'}, digest}, {platform: {os: 'linux', architecture: 'arm64'}, digest: 'sha256:' + 'd'.repeat(64)}, {platform: {os: 'unknown', architecture: 'unknown'}, digest: 'sha256:' + 'e'.repeat(64)}]};
assert.deepEqual(releasePlatforms(index, sha), {amd64_digest: digest, arm64_digest: 'sha256:' + 'd'.repeat(64)});
assert.throws(() => releasePlatforms(index, other), /does not match/);
assert.throws(() => releasePlatforms({...index, manifests: index.manifests.slice(0, 1)}, sha), /Missing/);
assert.throws(() => releasePlatforms({...index, manifests: [...index.manifests, index.manifests[0]]}, sha), /ambiguous/);
assert.throws(() => releasePlatforms({...index, manifests: [{...index.manifests[0], digest: 'latest'}, ...index.manifests.slice(1)]}, sha), /Missing/);
const successful = {id: 2, path: '.github/workflows/check.yml', event: 'push', head_branch: 'main', head_sha: sha, status: 'completed', conclusion: 'success'};
let run = successful, head = sha, existing = null, tag = null, waited = 0;
const api = async path => {
  if (path.includes('/releases/')) return existing;
  if (path.includes('/actions/runs')) return {workflow_runs: [{...successful, id: 1, conclusion: 'success'}, run]};
  if (path.endsWith('/heads/main')) return {object: {sha: head}};
  if (path.includes('/git/ref/tags/')) return tag;
  if (path.includes('/git/tags/')) return {object: {type: 'commit', sha: head}};
  throw new Error('Unexpected release API read');
};
assert.equal((await prepareRelease(context, api)).skip, false);
run = {...successful, conclusion: 'failure'};
await assert.rejects(prepareRelease(context, api), /Checks did not succeed/);
run = successful; head = other;
await assert.rejects(prepareRelease(context, api), /Main advanced/);
head = sha; tag = {object: {type: 'commit', sha: other}};
await assert.rejects(prepareRelease(context, api), /another commit/);
tag = {object: {type: 'tag', sha: other}};
assert.equal((await prepareRelease(context, api)).skip, false);
tag = null; run = {...successful, status: 'in_progress', conclusion: null};
assert.equal((await prepareRelease(context, api, async () => {waited++; run = successful;})).skip, false);
assert.equal(waited, 1);
existing = {draft: false};
assert.equal((await prepareRelease(context, api)).skip, true);
existing = {draft: true}; await assert.rejects(prepareRelease(context, api), /draft release/);
const template = readFileSync('compose.yaml', 'utf8');
const {version} = JSON.parse(readFileSync('package.json', 'utf8'));
const compose = releaseCompose(template, version, context.image, digest);
assert.ok(compose.includes(context.image + '@' + digest));
assert.ok(!compose.includes('    build: .'));
assert.ok(compose.includes('read_only: true') && compose.includes('127.0.0.1:') && compose.includes('crowsnest-data:/data'));
assert.throws(() => releaseCompose(template, '7.0.0', context.image, digest));
assert.throws(() => releaseCompose(template, version, context.image, 'latest'));
const notes = changelogNotes(readFileSync('CHANGELOG.md', 'utf8'), version);
assert.ok(notes.length > 20 && !notes.includes('## ['));
assert.throws(() => changelogNotes('## [1.0.0]\n\n', '1.0.0'));

// Execute the production publish command against synthetic API/registry transports.
// Packaging uses real files and tar; no external publication or network is allowed.
const releaseScript = resolve('scripts/release.mjs');
for (const scenario of ['valid', 'conflicting-image', 'incomplete-sbom']) {
  const directory = mkdtempSync(join(tmpdir(), 'crowsnest-release-package-'));
  try {
    for (const name of ['package.json', 'compose.yaml', 'CHANGELOG.md', 'LICENSE']) copyFileSync(name, join(directory, name));
    writeFileSync(join(directory, '.env.example'), 'CROWSNEST_PUBLIC_URL=\n');
    writeFileSync(join(directory, 'event.json'), JSON.stringify(event));
    writeFileSync(join(directory, 'transport.mjs'), `
      import assert from 'node:assert/strict';
      import childProcess from 'node:child_process';
      import {syncBuiltinESMExports} from 'node:module';
      import {writeFileSync} from 'node:fs';
      const calls=[], image='ghcr.io/fixture/crowsnest', digest=${JSON.stringify(digest)};
      const index=${JSON.stringify({...index, digest})}, scenario=${JSON.stringify(scenario)};
      let published=false;
      process.once('exit',()=>writeFileSync('calls.json',JSON.stringify(calls)));
      const execute=childProcess.execFileSync;
      childProcess.spawnSync=(command,args)=>{
        assert.equal(command,'docker');
        assert.deepEqual(args.slice(0,3),['buildx','imagetools','inspect']);
        assert.equal(args[4],'--format');
        assert.equal(args[5],'{{json .Manifest}}');
        calls.push({command,args});
        if(args[3]===image+'@'+digest)return {status:0,stdout:JSON.stringify(index),stderr:''};
        assert.equal(args[3],image+':'+${JSON.stringify(version)});
        if(scenario==='conflicting-image')return {status:0,stdout:JSON.stringify({...index,digest:'sha256:'+'f'.repeat(64)}),stderr:''};
        return published?{status:0,stdout:JSON.stringify(index),stderr:''}:{status:1,stdout:'',stderr:'manifest unknown'};
      };
      childProcess.execFileSync=(command,args,options)=>{
        calls.push({command,args});
        if(command==='tar')return execute(command,args,options);
        if(command==='gh'){assert.deepEqual(args.slice(0,2),['release','create']);return '';}
        assert.equal(command,'docker');
        if(args[0]==='compose'){assert.equal(args.at(-1),'--quiet');return '';}
        if(args[2]==='create'){
          assert.deepEqual(args,['buildx','imagetools','create','--tag',image+':'+${JSON.stringify(version)},image+'@'+digest]);
          published=true;return '';
        }
        assert.deepEqual(args,['buildx','imagetools','inspect',image+'@'+digest,'--format','{{json .SBOM}}']);
        return JSON.stringify(Object.fromEntries((scenario==='incomplete-sbom'?['linux/amd64']:['linux/amd64','linux/arm64']).map(platform=>[platform,{SPDX:{spdxVersion:'SPDX-2.3'}}])));
      };
      syncBuiltinESMExports();
      globalThis.fetch=async(url,options)=>{
        const path=new URL(url).pathname, method=options.method;
        assert.equal(new URL(url).origin,'https://api.github.com');
        calls.push({path,method,body:options.body?JSON.parse(options.body):null});
        if(path==='/repos/fixture/crowsnest/git/ref/heads/main' && method==='GET')return Response.json({object:{sha:${JSON.stringify(sha)}}});
        if(path==='/repos/fixture/crowsnest/git/ref/tags/v'+${JSON.stringify(version)} && method==='GET')return Response.json({}, {status:404});
        if(path==='/repos/fixture/crowsnest/git/tags' && method==='POST')return Response.json({sha:'e'.repeat(40)});
        if(path==='/repos/fixture/crowsnest/git/refs' && method==='POST')return Response.json({});
        throw new Error('Unexpected publication request');
      };
    `);
    const result = spawnSync(process.execPath, ['--import', join(directory, 'transport.mjs'), releaseScript, 'publish'], {
      cwd: directory, encoding: 'utf8', timeout: 30000,
      env: {...process.env, GITHUB_EVENT_PATH: join(directory, 'event.json'), GITHUB_REPOSITORY: 'fixture/crowsnest', GH_TOKEN: 'example-token', RELEASE_DIGEST: digest},
    });
    assert.ifError(result.error);
    const calls = JSON.parse(readFileSync(join(directory, 'calls.json'), 'utf8'));
    const publication = calls.find(call => call.command === 'gh');
    if (scenario !== 'valid') {
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.equal(publication, undefined, 'Failed image/SBOM checks must not publish a GitHub release');
      assert.ok(!calls.some(call => call.method === 'POST'), 'Failed image/SBOM checks must not create Git tags');
      assert.match(result.stderr, scenario === 'conflicting-image' ? /Refusing to overwrite/ : /Missing platform SBOM/);
      continue;
    }
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const artifacts = ['crowsnest-' + version + '.tar.gz', 'crowsnest-' + version + '-sbom.json'];
    const archive = join(directory, 'output', artifacts[0]);
    const members = JSON.parse(execFileSync('python3', ['-c', "import json,tarfile,sys; archive=tarfile.open(sys.argv[1]); members=archive.getmembers(); assert all(member.isfile() for member in members); assert len({member.name for member in members})==len(members); print(json.dumps({member.name: archive.extractfile(member).read().decode() for member in members}))", archive], {encoding: 'utf8'}));
    assert.deepEqual(Object.keys(members).sort(), ['.env.example', 'LICENSE', 'README.md', 'compose.yaml']);
    const reference = 'ghcr.io/fixture/crowsnest@' + digest;
    assert.ok(members['compose.yaml'].includes('image: ' + reference));
    assert.ok(!members['compose.yaml'].includes('build:'));
    assert.ok(members['README.md'].includes(reference));
    assert.ok(members['README.md'].includes('https://github.com/fixture/crowsnest/blob/v' + version + '/docs/self-hosting.md'));
    assert.equal(members['.env.example'], 'CROWSNEST_PUBLIC_URL=\n');
    assert.equal(members.LICENSE, readFileSync('LICENSE', 'utf8'));
    const expectedSums = artifacts.map(name => createHash('sha256').update(readFileSync(join(directory, 'output', name))).digest('hex') + '  ' + name).join('\n') + '\n';
    assert.equal(readFileSync(join(directory, 'output/SHA256SUMS'), 'utf8'), expectedSums);
    assert.ok(publication, 'Successful verification must reach release publication');
    assert.equal(publication.args[publication.args.indexOf('--repo') + 1], 'fixture/crowsnest');
    assert.ok(publication.args.includes('--verify-tag'));
    for (const name of [...artifacts, 'SHA256SUMS']) assert.ok(publication.args.includes('output/' + name));
    assert.deepEqual(calls.find(call => call.path === '/repos/fixture/crowsnest/git/tags').body, {tag: 'v' + version, message: 'Crowsnest v' + version, object: sha, type: 'commit'});
    assert.ok(readFileSync(join(directory, 'output/release-notes.md'), 'utf8').includes(reference));
  } finally { rmSync(directory, {recursive: true, force: true}); }
}
console.log('Release checks passed: trusted CI, immutability/retry, real archive/checksums, digest/source links, and publication refusal for invalid images/SBOMs');
