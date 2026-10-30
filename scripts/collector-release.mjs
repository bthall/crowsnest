// Trusted main-only publication. Collector releases are independent of dashboard versions.
import {appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {releaseContext, prepareRelease, releasePlatforms} from './release.mjs';
import {compareVersions, readCollectorMetadata, renderManager, validateCollectorMetadata} from './collector-metadata.mjs';
import {checkCollectorChanges, collectorRecipes} from './check-collector-changes.mjs';

const digestPattern = /^sha256:[a-f0-9]{64}$/;

export function collectorContext(event, repository, metadata) {
  metadata = validateCollectorMetadata(metadata);
  const context = releaseContext(event, repository, metadata.version);
  return {...context, protocol: metadata.protocol, manager_version: metadata.managerVersion, minimum_manager_version: metadata.minimumManagerVersion, tag: 'collector-v' + metadata.version,
    collector_image: context.image + '-collector', proxy_image: context.image + '-socket-proxy'};
}

export function collectorManifest(context, collectorDigest, proxyDigest, managerSource) {
  if (!digestPattern.test(collectorDigest) || !digestPattern.test(proxyDigest)) throw new Error('Collector releases require immutable image digests');
  if (typeof managerSource !== 'string' || !managerSource || managerSource.includes('__MANAGER_METADATA__')) throw new Error('Collector release requires a stamped manager');
  return {schema: 1, manager: {version: context.manager_version, minimumVersion: context.minimum_manager_version, sha256: createHash('sha256').update(managerSource).digest('hex')}, version: context.version, protocol: context.protocol,
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


// A version that was already published may only be skipped when its release
// inputs are unchanged. Compare immutable Git blobs, never a mutable branch URL.
export async function verifyPublishedCollectorInputs(context, api) {
  const base = '/repos/' + context.repository;
  const releases = [];
  let complete = false;
  for (let page = 1; page <= 10; page++) {
    const batch = await api(base + '/releases?per_page=100&page=' + page);
    if (!Array.isArray(batch)) throw new Error('Invalid collector release listing');
    releases.push(...batch.filter(release => !release.draft && !release.prerelease
      && /^collector-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.tag_name)));
    if (batch.length < 100) {complete = true; break;}
  }
  if (!complete) throw new Error('Collector release history exceeds the verification bound');
  if (!releases.length) return {firstRelease: true, changed: []};
  releases.sort((a, b) => compareVersions(a.tag_name.slice(11), b.tag_name.slice(11)));
  const tag = releases.at(-1).tag_name;
  const reference = await api(base + '/git/ref/tags/' + tag);
  let target = reference.object;
  if (target?.type === 'tag') target = (await api(base + '/git/tags/' + target.sha)).object;
  if (target?.type !== 'commit' || !/^[a-f0-9]{40}$/.test(target.sha)) throw new Error('Invalid published collector tag target');
  const snapshot = async (sha, includeRecipes = true) => {
    const tree = await api(base + '/git/trees/' + sha + '?recursive=1');
    if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('Incomplete collector release tree');
    const files = {};
    for (const item of tree.tree) if (item.type !== 'tree') files[item.path] = [item.mode, item.type, item.sha].join(' ');
    const metadata = tree.tree.find(item => item.path === 'collector/version.json' && item.type === 'blob');
    if (!metadata || !/^[a-f0-9]{40}$/.test(metadata.sha)) throw new Error('Published collector metadata is missing');
    const blob = await api(base + '/git/blobs/' + metadata.sha);
    if (blob.encoding !== 'base64' || typeof blob.content !== 'string' || blob.size > 65536) throw new Error('Invalid collector metadata blob');
    const recipes = includeRecipes ? Object.fromEntries(await Promise.all(collectorRecipes.map(async path => {
      const item = tree.tree.find(entry => entry.path === path && entry.type === 'blob' && /^100(?:644|755)$/.test(entry.mode));
      if (!item || !/^[a-f0-9]{40}$/.test(item.sha)) throw new Error('Collector image recipe is missing: ' + path);
      const source = await api(base + '/git/blobs/' + item.sha);
      if (source.encoding !== 'base64' || typeof source.content !== 'string' || source.size > 1048576) throw new Error('Invalid collector recipe blob');
      return [path, Buffer.from(source.content, 'base64').toString('utf8')];
    }))) : undefined;
    return {files, recipes, metadata: JSON.parse(Buffer.from(blob.content, 'base64').toString('utf8'))};
  };
  const [previous, current] = await Promise.all([snapshot(target.sha, false), snapshot(context.sha)]);
  if (previous.metadata.version !== tag.slice(11) || current.metadata.version !== context.version) throw new Error('Collector tag or checkout disagrees with version metadata');
  return checkCollectorChanges(previous, current);
}

export async function prepareCollectorRelease(context, api) {
  await verifyPublishedCollectorInputs(context, api);
  return prepareRelease(context, api);
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
  const metadata = readCollectorMetadata();
  const context = collectorContext(event, process.env.GITHUB_REPOSITORY, metadata);
  const api = githubApi(process.env.GH_TOKEN), mode = process.argv[2];
  if (mode === 'prepare') { output(await prepareCollectorRelease(context, api)); return; }
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
  const managerSource = renderManager(readFileSync('collector/crowsnest', 'utf8'), metadata);
  const manifest = collectorManifest(context, digests.collector, digests.proxy, managerSource);
  if (mode === 'platforms') {
    const values = {};
    for (const kind of ['collector', 'proxy']) for (const [key, value] of Object.entries(releasePlatforms(inspect(manifest.images[kind]), context.sha))) values[kind + '_' + key] = value;
    output(values); return;
  }
  if (mode !== 'publish') throw new Error('Unknown collector release operation');
  const base = '/repos/' + context.repository;
  await verifyPublishedCollectorInputs(context, api);
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
  writeFileSync(directory + 'crowsnest', managerSource); chmodSync(directory + 'crowsnest', 0o755);
  writeFileSync(directory + 'LICENSE', readFileSync('LICENSE'));
  writeFileSync(directory + 'README.md', '# Crowsnest collector ' + context.version + '\n\nThis archive contains no reporting credentials. For an existing deployment, copy only\n`crowsnest` to the installation directory, then run `./crowsnest migrate --version ' + context.version + '`.\nMigration preserves the private credentials and checks accepted reporting before committing.\nFor a new installation, obtain collector.json from your private dashboard, create .env\nwith COLLECTOR_UID and COLLECTOR_GID, and keep both files private.\nCreate the host-owned state directory with `install -d -m 0700 .crowsnest; install -d -m 0755 .crowsnest/status` before\nstarting containers. Run `docker compose up -d`, then `./crowsnest migrate --version ' + context.version + '` to adopt and verify reporting.\nUse `./crowsnest status` for saved management state; confirm fresh reports in the dashboard.\nAutomatic updates remain disabled until explicitly enabled per host.\n\nFull guide: https://github.com/' + context.repository + '/blob/' + context.tag + '/docs/deployment.md\n');
  execFileSync('docker', ['compose', '--file', directory + 'compose.yaml', 'config', '--quiet'], {env: {...process.env, COLLECTOR_UID: '1000', COLLECTOR_GID: '1000'}, stdio: 'inherit'});
  const archive = 'output/crowsnest-collector-' + context.version + '.tar.gz';
  execFileSync('tar', ['-czf', archive, '-C', directory, 'compose.yaml', 'collector-release.json', 'crowsnest', 'LICENSE', 'README.md']);
  const manifestPath = 'output/collector-release.json', sbomPath = 'output/collector-sbom.json', managerPath = 'output/crowsnest';
  writeFileSync(managerPath, managerSource); chmodSync(managerPath, 0o755);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(sbomPath, JSON.stringify(sboms) + '\n');
  const sums = 'output/collector-SHA256SUMS';
  writeFileSync(sums, [archive, manifestPath, sbomPath, managerPath].map(path => createHash('sha256').update(readFileSync(path)).digest('hex') + '  ' + path.split('/').pop()).join('\n') + '\n');
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
  execFileSync('gh', ['release', 'create', context.tag, '--repo', context.repository, '--verify-tag', '--latest=false', '--title', 'Crowsnest collector ' + context.version, '--notes-file', 'output/collector-release-notes.md', archive, manifestPath, sbomPath, managerPath, sums], {stdio: 'inherit', timeout: 120000});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run().catch(error => {console.error(error.message); process.exitCode = 1;});
