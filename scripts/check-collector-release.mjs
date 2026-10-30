import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {collectorContext, collectorManifest, collectorCompose, prepareCollectorRelease, verifyPublishedCollectorInputs} from './collector-release.mjs';
import {renderManager, validateCollectorMetadata} from './collector-metadata.mjs';

const sha = 'a'.repeat(40), digest = 'sha256:' + 'c'.repeat(64), proxyDigest = 'sha256:' + 'd'.repeat(64);
const event = {repository: {id: 1, full_name: 'fixture/crowsnest'}, workflow_run: {name: 'Security', event: 'push', head_branch: 'main', conclusion: 'success', head_sha: sha, head_repository: {id: 1}}};
const metadata = JSON.parse(readFileSync('collector/version.json', 'utf8'));
const context = collectorContext(event, 'fixture/crowsnest', metadata);
assert.equal(context.tag, 'collector-v' + metadata.version);
assert.equal(context.collector_image, 'ghcr.io/fixture/crowsnest-collector');
assert.equal(context.proxy_image, 'ghcr.io/fixture/crowsnest-socket-proxy');
for (const protocol of [0, -1, 1.5, '1', 65536, null]) assert.throws(() => collectorContext(event, 'fixture/crowsnest', {...metadata, protocol}));
for (const version of ['0.1.0-rc.1', '1.0', '01.0.0', '1.0.0\nskip=true']) assert.throws(() => collectorContext(event, 'fixture/crowsnest', {...metadata, version}));
for (const changes of [{event: 'pull_request'}, {head_branch: 'topic'}, {head_repository: {id: 2}}, {conclusion: 'failure'}]) assert.throws(() => collectorContext({...event, workflow_run: {...event.workflow_run, ...changes}}, 'fixture/crowsnest', metadata));
const managerTemplate = "#!/usr/bin/env python3\nimport json\nmetadata = json.loads('__MANAGER_METADATA__')\nprint(json.dumps(metadata))\n";
const managerSource = renderManager(managerTemplate, metadata);
const manifest = collectorManifest(context, digest, proxyDigest, managerSource);
assert.deepEqual(Object.keys(manifest).sort(), ['images', 'manager', 'protocol', 'schema', 'version']);
assert.equal(manifest.images.proxy, context.proxy_image + '@' + proxyDigest);
assert.throws(() => collectorManifest(context, 'latest', proxyDigest, managerSource));
const template = readFileSync('collector/compose.yaml', 'utf8');
const rendered = collectorCompose(template, manifest);
assert.ok(rendered.includes(manifest.images.collector) && rendered.includes(manifest.images.proxy));
assert.ok(!rendered.includes('COLLECTOR_IMAGE') && !rendered.includes('PROXY_IMAGE'));
assert.ok(!rendered.includes('./collector.py:') && !rendered.includes('./proxy.cfg:'));
assert.ok(rendered.includes('./collector.json:/run/config/collector.json:ro'));
assert.ok(rendered.includes('./.crowsnest/status:/run/crowsnest:ro'));
assert.ok(rendered.includes('cap_drop: [ALL]') && rendered.includes('internal: true'));
assert.throws(() => collectorCompose(template.replaceAll('COLLECTOR_IMAGE', 'UNKNOWN_IMAGE'), manifest));
assert.throws(() => collectorCompose(template, {...manifest, images: {...manifest.images, proxy: 'https://untrusted.example/image'}}));
const ci = {id: 2, path: '.github/workflows/check.yml', event: 'push', head_branch: 'main', head_sha: sha, status: 'completed', conclusion: 'success'};
const paths = [];
await prepareCollectorRelease(context, async path => {
  if (path.includes('/releases?')) return [];
  paths.push(path);
  if (path.includes('/releases/')) return null;
  if (path.includes('/actions/runs')) return {workflow_runs: [ci]};
  if (path.endsWith('/heads/main')) return {object: {sha}};
  if (path.includes('/tags/')) return null;
  throw new Error('Unexpected API path');
});
assert.ok(paths.some(path => path.endsWith('/tags/collector-v' + metadata.version)));
assert.ok(!paths.some(path => path.endsWith('/tags/v' + metadata.version)));

// An existing release must not silently swallow changed collector inputs.
for (const scenario of ['unchanged', 'source-unbumped', 'source-bumped', 'manager-unbumped', 'manager-bumped', 'truncated-tree']) {
  const oldSha = 'b'.repeat(40), oldBlob = '1'.repeat(40), newBlob = '2'.repeat(40);
  const next = {...metadata};
  if (scenario.endsWith('-bumped') || scenario === 'manager-unbumped') next.version = '0.11.2';
  if (scenario === 'manager-bumped') next.managerVersion = '1.0.1';
  const candidate = collectorContext(event, 'fixture/crowsnest', next);
  const base = '/repos/' + candidate.repository;
  const oldTree = [
    {path: 'collector/version.json', mode: '100644', type: 'blob', sha: oldBlob},
    {path: 'worker/collector.py', mode: '100644', type: 'blob', sha: '3'.repeat(40)},
    {path: 'collector/crowsnest', mode: '100755', type: 'blob', sha: '4'.repeat(40)},
    {path: 'collector/Dockerfile', mode: '100644', type: 'blob', sha: '7'.repeat(40)},
    {path: 'collector/Dockerfile.proxy', mode: '100644', type: 'blob', sha: '8'.repeat(40)},
  ];
  const newTree = oldTree.map(item => ({...item}));
  newTree[0].sha = newBlob;
  if (scenario === 'unchanged') newTree[0].sha = oldBlob;
  if (scenario.startsWith('source-')) newTree[1].sha = '5'.repeat(40);
  if (scenario.startsWith('manager-')) newTree[2].sha = '6'.repeat(40);
  let skipped = false;
  const api = async path => {
    if (path === base + '/releases?per_page=100&page=1') return [{tag_name: context.tag, draft: false, prerelease: false}];
    if (path === base + '/git/ref/tags/' + context.tag) return {object: {type: 'commit', sha: oldSha}};
    if (path === base + '/git/trees/' + oldSha + '?recursive=1') return {tree: oldTree};
    if (path === base + '/git/trees/' + sha + '?recursive=1') return {tree: newTree, truncated: scenario === 'truncated-tree'};
    if (path === base + '/git/blobs/' + '7'.repeat(40)) return {encoding: 'base64', content: Buffer.from('FROM python:fixture\nCOPY worker/collector.py /app/collector.py\n').toString('base64')};
    if (path === base + '/git/blobs/' + '8'.repeat(40)) return {encoding: 'base64', content: Buffer.from('FROM haproxy:fixture\n').toString('base64')};
    if (path === base + '/git/blobs/' + oldBlob) return {encoding: 'base64', content: Buffer.from(JSON.stringify(metadata)).toString('base64')};
    if (path === base + '/git/blobs/' + newBlob) return {encoding: 'base64', content: Buffer.from(JSON.stringify(next)).toString('base64')};
    if (path === base + '/releases/tags/' + context.tag) {skipped = true; return {draft: false};}
    throw new Error('Unexpected input verification request: ' + path);
  };
  if (scenario === 'unchanged') {
    assert.equal((await prepareCollectorRelease(candidate, api)).skip, true);
    assert.equal(skipped, true);
  } else if (scenario.endsWith('-unbumped') || scenario === 'truncated-tree') {
    await assert.rejects(() => prepareCollectorRelease(candidate, api), /without a newer|Incomplete/);
    assert.equal(skipped, false, 'Invalid input versions must fail before the existing-release skip');
  } else assert.ok((await verifyPublishedCollectorInputs(candidate, api)).changed.length > 0);
}

// Execute real packaging with fake registry and GitHub transports. No network or Docker.
const script = resolve('scripts/collector-release.mjs');
const index = {digest, annotations: {'org.opencontainers.image.revision': sha}, manifests: [
  {platform: {os: 'linux', architecture: 'amd64'}, digest: 'sha256:' + 'e'.repeat(64)},
  {platform: {os: 'linux', architecture: 'arm64'}, digest: 'sha256:' + 'f'.repeat(64)},
]};
for (const scenario of ['valid', 'proxy-conflict', 'source-mismatch', 'incomplete-sbom', 'main-advanced']) {
  const directory = mkdtempSync(join(tmpdir(), 'crowsnest-collector-package-'));
  try {
    mkdirSync(join(directory, 'collector'));
    writeFileSync(join(directory, 'collector/version.json'), JSON.stringify(metadata));
    writeFileSync(join(directory, 'collector/compose.yaml'), template);
    writeFileSync(join(directory, 'collector/crowsnest'), managerTemplate);
    writeFileSync(join(directory, 'LICENSE'), readFileSync('LICENSE'));
    writeFileSync(join(directory, 'event.json'), JSON.stringify(event));
    writeFileSync(join(directory, 'transport.mjs'), `
      import assert from 'node:assert/strict';
      import childProcess from 'node:child_process';
      import {syncBuiltinESMExports} from 'node:module';
      import {writeFileSync} from 'node:fs';
      const scenario=${JSON.stringify(scenario)}, context=${JSON.stringify(context)};
      const digests={collector:${JSON.stringify(digest)},proxy:${JSON.stringify(proxyDigest)}};
      const index=${JSON.stringify(index)}, published=new Set(), calls=[];
      const execute=childProcess.execFileSync;
      process.once('exit',()=>writeFileSync('calls.json',JSON.stringify(calls)));
      childProcess.spawnSync=(command,args)=>{
        assert.equal(command,'docker'); assert.deepEqual(args.slice(0,3),['buildx','imagetools','inspect']);
        calls.push({command,args});
        for(const kind of ['collector','proxy']){
          const image=context[kind+'_image'];
          if(args[3]===image+'@'+digests[kind])return {status:0,stdout:JSON.stringify({...index,digest:digests[kind],annotations:{'org.opencontainers.image.revision':scenario==='source-mismatch'?'b'.repeat(40):context.sha}}),stderr:''};
          if(args[3]!==image+':'+context.version)continue;
          if(scenario==='proxy-conflict' && kind==='proxy')return {status:0,stdout:JSON.stringify({...index,digest:'sha256:'+'b'.repeat(64)}),stderr:''};
          return published.has(kind)?{status:0,stdout:JSON.stringify({...index,digest:digests[kind]}),stderr:''}:{status:1,stdout:'',stderr:'manifest unknown'};
        }
        throw new Error('Unexpected image read');
      };
      childProcess.execFileSync=(command,args,options)=>{
        calls.push({command,args});
        if(command==='tar')return execute(command,args,options);
        if(command==='gh'){assert.deepEqual(args.slice(0,2),['release','create']);assert.ok(args.includes('--latest=false'));return '';}
        assert.equal(command,'docker');
        if(args[0]==='compose'){assert.equal(args.at(-1),'--quiet');return '';}
        if(args[2]==='create'){
          const kind=args[4].startsWith(context.collector_image+':')?'collector':'proxy';
          assert.deepEqual(args,['buildx','imagetools','create','--tag',context[kind+'_image']+':'+context.version,context[kind+'_image']+'@'+digests[kind]]);
          published.add(kind);return '';
        }
        assert.equal(args[2],'inspect');assert.equal(args.at(-1),'{{json .SBOM}}');
        return JSON.stringify(Object.fromEntries((scenario==='incomplete-sbom'?['linux/amd64']:['linux/amd64','linux/arm64']).map(p=>[p,{SPDX:{spdxVersion:'SPDX-2.3'}}])));
      };
      syncBuiltinESMExports();
      globalThis.fetch=async(url,options)=>{
        assert.equal(new URL(url).origin,'https://api.github.com');
        const path=new URL(url).pathname,method=options.method;
        calls.push({path,method,body:options.body?JSON.parse(options.body):null});
        const base='/repos/'+context.repository;
        if(path===base+'/releases')return Response.json([]);
        if(path===base+'/git/ref/heads/main')return Response.json({object:{sha:scenario==='main-advanced'?'b'.repeat(40):context.sha}});
        if(path===base+'/releases/tags/'+context.tag || path===base+'/git/ref/tags/'+context.tag)return Response.json({}, {status:404});
        if(path===base+'/git/tags' && method==='POST')return Response.json({sha:'e'.repeat(40)});
        if(path===base+'/git/refs' && method==='POST')return Response.json({});
        throw new Error('Unexpected release request');
      };
    `);
    const result = spawnSync(process.execPath, ['--import', join(directory, 'transport.mjs'), script, 'publish'], {
      cwd: directory, encoding: 'utf8', timeout: 30000,
      env: {...process.env, GITHUB_EVENT_PATH: join(directory, 'event.json'), GITHUB_REPOSITORY: 'fixture/crowsnest', GH_TOKEN: 'example-token', COLLECTOR_DIGEST: digest, PROXY_DIGEST: proxyDigest},
    });
    assert.ifError(result.error);
    const calls = JSON.parse(readFileSync(join(directory, 'calls.json'), 'utf8'));
    if (scenario !== 'valid') {
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.ok(!calls.some(call => call.command === 'gh' || call.method === 'POST' || call.args?.[2] === 'create'), 'Failed verification must not mutate version tags or publish assets');
      assert.match(result.stderr, /Refusing to overwrite|does not match|Missing collector platform SBOM|Main advanced/);
      continue;
    }
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'output/collector-release.json'), 'utf8')), manifest);
    const archiveName = 'crowsnest-collector-' + context.version + '.tar.gz';
    const archive = join(directory, 'output', archiveName);
    const members = JSON.parse(execFileSync('python3', ['-c', 'import json,tarfile,sys; t=tarfile.open(sys.argv[1]); m=t.getmembers(); assert all(x.isfile() for x in m); assert len({x.name for x in m})==len(m); print(json.dumps({x.name:{"content":t.extractfile(x).read().decode(),"mode":x.mode} for x in m}))', archive], {encoding: 'utf8'}));
    assert.deepEqual(Object.keys(members).sort(), ['LICENSE', 'README.md', 'collector-release.json', 'compose.yaml', 'crowsnest']);
    assert.equal(members.crowsnest.mode & 0o111, 0o111);
    assert.equal(members['compose.yaml'].content, rendered);
    assert.deepEqual(JSON.parse(members['collector-release.json'].content), manifest);
    assert.ok(members['README.md'].content.includes('collector-v' + context.version));
    assert.equal(members.crowsnest.content, managerSource);
    assert.equal(readFileSync(join(directory, 'output/crowsnest'), 'utf8'), managerSource);
    assert.equal(manifest.manager.sha256, createHash('sha256').update(managerSource).digest('hex'));
    assert.deepEqual(JSON.parse(execFileSync('python3', [join(directory, 'output/crowsnest')], {encoding: 'utf8'})), metadata);
    const names = [archiveName, 'collector-release.json', 'collector-sbom.json', 'crowsnest'];
    const sums = names.map(name => createHash('sha256').update(readFileSync(join(directory, 'output', name))).digest('hex') + '  ' + name).join('\n') + '\n';
    assert.equal(readFileSync(join(directory, 'output/collector-SHA256SUMS'), 'utf8'), sums);
    const publication = calls.find(call => call.command === 'gh');
    assert.ok(publication.args.includes('--latest=false'));
    for (const name of [...names, 'collector-SHA256SUMS']) assert.ok(publication.args.includes('output/' + name));
  } finally {rmSync(directory, {recursive: true, force: true});}
}
console.log('Collector release checks passed: independent versions, trusted CI, both immutable image references, real archives/checksums, and refusal before publication on invalid source/SBOM/digests');
