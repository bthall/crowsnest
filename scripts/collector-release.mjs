// Trusted main-only publication. Collector releases are independent of dashboard versions.
import {appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {releaseContext, prepareRelease, releasePlatforms} from './release.mjs';

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function collectorContext(event, repository, metadata) {
  if (!metadata || !stableVersion.test(metadata.version) || !Number.isSafeInteger(metadata.protocol) || metadata.protocol < 1 || metadata.protocol > 65535) throw new Error('Invalid collector release metadata');
  const context = releaseContext(event, repository, metadata.version);
  return {...context, protocol: metadata.protocol, tag: 'collector-v' + metadata.version,
    collector_image: context.image + '-collector', proxy_image: context.image + '-socket-proxy'};
}

export function collectorManifest(context, collectorDigest, proxyDigest) {
  if (!digestPattern.test(collectorDigest) || !digestPattern.test(proxyDigest)) throw new Error('Collector releases require immutable image digests');
  return {schema: 1, version: context.version, protocol: context.protocol,
    images: {collector: context.collector_image + '@' + collectorDigest, proxy: context.proxy_image + '@' + proxyDigest}};
}

export function collectorCompose(template, manifest) {
  const names = {COLLECTOR_IMAGE: manifest.images.collector, PROXY_IMAGE: manifest.images.proxy};
  let result = template;
  for (const [name, reference] of Object.entries(names)) {
    if (!/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$/.test(reference)) throw new Error('Invalid collector release image');
    const expression = new RegExp('\\$\\{' + name + ':\\?[^}]+\\}', 'g');
    if (!expression.test(result)) throw new Error('Collector Compose image placeholder missing: ' + name);
    result = result.replace(expression, reference);
  }
  return result;
}

function output(values) {
  if (!process.env.GITHUB_OUTPUT) throw new Error('Release outputs require GitHub Actions');
  for (const [key, value] of Object.entries(values)) {
    if (/\r|\n/.test(String(value))) throw new Error('Invalid workflow output');
    appendFileSync(process.env.GITHUB_OUTPUT, key + '=' + value + '\n');
  }
}

function githubApi(token) {
  if (!token) throw new Error('Missing workflow token');
  return async (path, {method = 'GET', body, allow404 = false} = {}) => {
    const response = await fetch('https://api.github.com' + path, {method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'},
      ...(body ? {body: JSON.stringify(body)} : {})});
    if (response.status === 404 && allow404) return null;
    if (!response.ok) throw new Error('GitHub collector release request failed: HTTP ' + response.status);
    return response.json();
  };
}

function inspect(reference, allowMissing = false) {
  const result = spawnSync('docker', ['buildx', 'imagetools', 'inspect', reference, '--format', '{{json .Manifest}}'], {encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024});
  if (result.error) throw new Error('Registry inspection failed');
  if (result.status) {
    if (allowMissing && /manifest unknown|not found|NAME_UNKNOWN/i.test(result.stderr)) return null;
    throw new Error('Could not verify registry image; no collector release tag was changed');
  }
  const manifest = JSON.parse(result.stdout);
  if (!digestPattern.test(manifest.digest)) throw new Error('Registry returned an invalid digest');
  return manifest;
}

function sbom(reference) {
  const value = execFileSync('docker', ['buildx', 'imagetools', 'inspect', reference, '--format', '{{json .SBOM}}'], {encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024});
  const parsed = JSON.parse(value);
  for (const platform of ['linux/amd64', 'linux/arm64']) if (!parsed[platform]?.SPDX?.spdxVersion) throw new Error('Missing collector platform SBOM');
  return parsed;
}

async function run() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const context = collectorContext(event, process.env.GITHUB_REPOSITORY, JSON.parse(readFileSync('collector/version.json', 'utf8')));
  const api = githubApi(process.env.GH_TOKEN), mode = process.argv[2];
  if (mode === 'prepare') { output(await prepareRelease(context, api)); return; }
  if (mode === 'inspect') {
    const values = {};
    for (const kind of ['collector', 'proxy']) {
      const existing = inspect(context[kind + '_image'] + ':' + context.version, true);
      if (existing) releasePlatforms(existing, context.sha);
      values[kind + '_reuse'] = !!existing;
      values[kind + '_digest'] = existing?.digest || '';
    }
    output(values); return;
  }
  const digests = {collector: process.env.COLLECTOR_DIGEST, proxy: process.env.PROXY_DIGEST};
  const manifest = collectorManifest(context, digests.collector, digests.proxy);
  if (mode === 'platforms') {
    const values = {};
    for (const kind of ['collector', 'proxy']) for (const [key, value] of Object.entries(releasePlatforms(inspect(manifest.images[kind]), context.sha))) values[kind + '_' + key] = value;
    output(values); return;
  }
  if (mode !== 'publish') throw new Error('Unknown collector release operation');
  const base = '/repos/' + context.repository;
  if ((await api(base + '/git/ref/heads/main')).object.sha !== context.sha) throw new Error('Main advanced before collector publication');
  if (await api(base + '/releases/tags/' + context.tag, {allow404: true})) throw new Error('Collector release already exists; refusing to replace it');
  const sboms = {};
  for (const kind of ['collector', 'proxy']) {
    releasePlatforms(inspect(manifest.images[kind]), context.sha);
    const existing = inspect(context[kind + '_image'] + ':' + context.version, true);
    if (existing && existing.digest !== digests[kind]) throw new Error('Refusing to overwrite a published collector version image');
    sboms[kind] = sbom(manifest.images[kind]);
  }
  mkdirSync('output/collector-release', {recursive: true});
  const directory = 'output/collector-release/';
  writeFileSync(directory + 'compose.yaml', collectorCompose(readFileSync('collector/compose.yaml', 'utf8'), manifest));
  writeFileSync(directory + 'collector-release.json', JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(directory + 'crowsnest', readFileSync('collector/crowsnest')); chmodSync(directory + 'crowsnest', 0o755);
  writeFileSync(directory + 'LICENSE', readFileSync('LICENSE'));
  writeFileSync(directory + 'README.md', '# Crowsnest collector ' + context.version + '\n\nThis archive contains no reporting credentials. For an existing deployment, copy only\n`crowsnest` to the installation directory, then run `./crowsnest migrate --version ' + context.version + '`.\nMigration preserves the private credentials and checks accepted reporting before committing.\nFor a new installation, obtain collector.json from your private dashboard, create .env\nwith COLLECTOR_UID and COLLECTOR_GID, and keep both files private.\nCreate the host-owned state directory with `install -d -m 0700 .crowsnest; install -d -m 0755 .crowsnest/status` before\nstarting containers. Run `docker compose up -d`, then `./crowsnest migrate --version ' + context.version + '` to adopt and verify reporting.\nUse `./crowsnest status` for saved management state; confirm fresh reports in the dashboard.\nAutomatic updates remain disabled until explicitly enabled per host.\n\nFull guide: https://github.com/' + context.repository + '/blob/' + context.tag + '/docs/deployment.md\n');
  execFileSync('docker', ['compose', '--file', directory + 'compose.yaml', 'config', '--quiet'], {env: {...process.env, COLLECTOR_UID: '1000', COLLECTOR_GID: '1000'}, stdio: 'inherit'});
  const archive = 'output/crowsnest-collector-' + context.version + '.tar.gz';
  execFileSync('tar', ['-czf', archive, '-C', directory, 'compose.yaml', 'collector-release.json', 'crowsnest', 'LICENSE', 'README.md']);
  const manifestPath = 'output/collector-release.json', sbomPath = 'output/collector-sbom.json';
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(sbomPath, JSON.stringify(sboms) + '\n');
  const sums = 'output/collector-SHA256SUMS';
  writeFileSync(sums, [archive, manifestPath, sbomPath].map(path => createHash('sha256').update(readFileSync(path)).digest('hex') + '  ' + path.split('/').pop()).join('\n') + '\n');
  // All source, platform, SBOM, and packaging checks precede version/tag mutation.
  for (const kind of ['collector', 'proxy']) {
    const image = context[kind + '_image'], reference = image + ':' + context.version;
    const existing = inspect(reference, true);
    if (existing && existing.digest !== digests[kind]) throw new Error('Refusing to overwrite a published collector version image');
    if (!existing) execFileSync('docker', ['buildx', 'imagetools', 'create', '--tag', reference, manifest.images[kind]], {stdio: 'inherit', timeout: 60000});
    if (inspect(reference).digest !== digests[kind]) throw new Error('Collector version image differs from the tested image');
  }
  const tag = await api(base + '/git/ref/tags/' + context.tag, {allow404: true});
  if (!tag) {
    const annotated = await api(base + '/git/tags', {method: 'POST', body: {tag: context.tag, message: 'Crowsnest collector ' + context.version, object: context.sha, type: 'commit'}});
    await api(base + '/git/refs', {method: 'POST', body: {ref: 'refs/tags/' + context.tag, sha: annotated.sha}});
  } else {
    const target = tag.object.type === 'tag' ? (await api(base + '/git/tags/' + tag.object.sha)).object : tag.object;
    if (target.type !== 'commit' || target.sha !== context.sha) throw new Error('Refusing to change an existing collector release tag');
  }
  const notes = 'Collector ' + context.version + ', reporting protocol ' + context.protocol + '.\n\nImages contain the collector code and restricted proxy configuration.\nLinux amd64 and arm64 images passed smoke tests and vulnerability checks.\nThe manifest and archive pin both images by digest; SBOMs and checksums are attached.\nUpdates remain manual unless explicitly enabled on a host. Publishing does not restart collectors.\n';
  writeFileSync('output/collector-release-notes.md', notes);
  execFileSync('gh', ['release', 'create', context.tag, '--repo', context.repository, '--verify-tag', '--latest=false', '--title', 'Crowsnest collector ' + context.version, '--notes-file', 'output/collector-release-notes.md', archive, manifestPath, sbomPath, sums], {stdio: 'inherit', timeout: 120000});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run().catch(error => {console.error(error.message); process.exitCode = 1;});
