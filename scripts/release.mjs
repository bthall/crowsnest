// Runs only in the trusted, CI-gated release workflow. Credentials stay in its environment.
import {appendFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const shaPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][A-Za-z0-9-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][A-Za-z0-9-]*))*)?$/;

export function releaseContext(event, repository, version) {
  const run = event.workflow_run;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || event.repository?.full_name !== repository ||
      !Number.isSafeInteger(event.repository?.id) || run?.head_repository?.id !== event.repository.id ||
      run?.name !== 'Security' || run.event !== 'push' || run.head_branch !== 'main' ||
      run.conclusion !== 'success' || !shaPattern.test(run.head_sha) || !versionPattern.test(version)) {
    throw new Error('Release requires successful Security on a trusted main push and a valid release version');
  }
  return {repository, sha: run.head_sha, version, tag: 'v' + version, image: 'ghcr.io/' + repository.toLowerCase()};
}

export function changelogNotes(changelog, version) {
  const title = '## [' + version + ']';
  const start = changelog.split('\n').findIndex(line => line.startsWith(title + ' ') || line === title);
  if (start < 0) throw new Error('Release version is missing from CHANGELOG.md');
  const lines = changelog.split('\n').slice(start + 1);
  const end = lines.findIndex(line => line.startsWith('## ['));
  const notes = (end < 0 ? lines : lines.slice(0, end)).join('\n').trim();
  if (!notes) throw new Error('Release notes are empty');
  return notes;
}

export function releaseCompose(template, version, image, digest) {
  if (!versionPattern.test(version) || !/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(image) || !digestPattern.test(digest)) throw new Error('Invalid release image');
  if (!template.includes('    build: .\n') || !template.includes('    image: crowsnest:' + version + '\n')) throw new Error('Compose version differs from package.json');
  return template.replace('    build: .\n', '').replace('    image: crowsnest:' + version + '\n', '    image: ' + image + '@' + digest + '\n');
}

export async function prepareRelease(context, api, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const base = '/repos/' + context.repository;
  const existing = await api(base + '/releases/tags/' + context.tag, {allow404: true});
  if (existing) {
    if (existing.draft) throw new Error('A draft release already exists; reconcile it before automatic publication');
    return {...context, skip: true}; // A published version is never rebuilt or replaced.
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    const {workflow_runs: runs} = await api(base + '/actions/runs?head_sha=' + context.sha + '&event=push&per_page=100');
    const check = runs.filter(run => run.path === '.github/workflows/check.yml' && run.head_sha === context.sha && run.head_branch === 'main' && run.event === 'push').sort((a, b) => b.id - a.id)[0];
    if (check?.status === 'completed') {
      if (check.conclusion !== 'success') throw new Error('Checks did not succeed on the release commit');
      const head = await api(base + '/git/ref/heads/main');
      if (head.object.sha !== context.sha) throw new Error('Main advanced; release only the current reviewed commit');
      const tag = await api(base + '/git/ref/tags/' + context.tag, {allow404: true});
      if (tag) {
        let target = tag.object;
        if (target.type === 'tag') target = (await api(base + '/git/tags/' + target.sha)).object;
        if (target.type !== 'commit' || target.sha !== context.sha) throw new Error('Existing version tag belongs to another commit; increment the version');
      }
      return {...context, skip: false};
    }
    await wait(15000);
  }
  throw new Error('Timed out waiting for Checks on the release commit');
}

function githubApi(token) {
  if (!token) throw new Error('Missing workflow token');
  return async (path, {method = 'GET', body, allow404 = false} = {}) => {
    const response = await fetch('https://api.github.com' + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'},
      ...(body ? {body: JSON.stringify(body)} : {}),
    });
    if (response.status === 404 && allow404) return null;
    if (!response.ok) throw new Error('GitHub release request failed: HTTP ' + response.status);
    return response.json();
  };
}

function output(values) {
  if (!process.env.GITHUB_OUTPUT) throw new Error('Release outputs require GitHub Actions');
  for (const [key, value] of Object.entries(values)) {
    if (/\r|\n/.test(String(value))) throw new Error('Invalid workflow output');
    appendFileSync(process.env.GITHUB_OUTPUT, key + '=' + value + '\n');
  }
}

function manifest(reference, allowMissing = false) {
  const result = spawnSync('docker', ['buildx', 'imagetools', 'inspect', reference, '--format', '{{json .Manifest}}'], {encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024});
  if (result.error) throw new Error('Registry inspection failed');
  if (result.status) {
    if (allowMissing && /manifest unknown|not found|NAME_UNKNOWN/i.test(result.stderr)) return null;
    throw new Error('Could not verify registry image; no release tag was changed');
  }
  const value = JSON.parse(result.stdout);
  if (!digestPattern.test(value.digest)) throw new Error('Registry returned an invalid digest');
  return value;
}

async function run() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const {version} = JSON.parse(readFileSync('package.json', 'utf8'));
  const context = releaseContext(event, process.env.GITHUB_REPOSITORY, version);
  const notes = changelogNotes(readFileSync('CHANGELOG.md', 'utf8'), version);
  const api = githubApi(process.env.GH_TOKEN);
  const mode = process.argv[2];
  if (mode === 'prepare') {
    output(await prepareRelease(context, api));
    return;
  }
  if (mode === 'inspect') {
    const existing = manifest(context.image + ':' + version, true);
    if (existing && existing.annotations?.['org.opencontainers.image.revision'] !== context.sha) throw new Error('Published image belongs to another commit; increment the version');
    output({reuse: !!existing, digest: existing?.digest || ''});
    return;
  }
  if (mode !== 'publish' || !digestPattern.test(process.env.RELEASE_DIGEST)) throw new Error('Invalid release operation');
  const digest = process.env.RELEASE_DIGEST;
  const base = '/repos/' + context.repository;
  if ((await api(base + '/git/ref/heads/main')).object.sha !== context.sha) throw new Error('Main advanced before publication');
  const source = manifest(context.image + '@' + digest);
  if (source.annotations?.['org.opencontainers.image.revision'] !== context.sha) throw new Error('Image revision does not match the release source');
  const platforms = new Set(source.manifests?.map(value => value.platform?.os + '/' + value.platform?.architecture));
  if (!platforms.has('linux/amd64') || !platforms.has('linux/arm64')) throw new Error('Release image is missing a supported architecture');
  const existing = manifest(context.image + ':' + version, true);
  if (existing && existing.digest !== digest) throw new Error('Refusing to overwrite a published version image');
  if (!existing) execFileSync('docker', ['buildx', 'imagetools', 'create', '--tag', context.image + ':' + version, context.image + '@' + digest], {stdio: 'inherit', timeout: 60000});
  if (manifest(context.image + ':' + version).digest !== digest) throw new Error('Version image differs from the tested image');

  mkdirSync('output/release', {recursive: true});
  writeFileSync('output/release/compose.yaml', releaseCompose(readFileSync('compose.yaml', 'utf8'), version, context.image, digest));
  for (const name of ['.env.example', 'LICENSE']) writeFileSync('output/release/' + name, readFileSync(name));
  writeFileSync('output/release/README.md', '# Crowsnest ' + version + '\n\nImage: `' + context.image + '@' + digest + '`\n\nCreate a user-owned directory under `/srv/docker/crowsnest`, extract this package,\nrun `umask 077`, copy `.env.example` to `.env`, and set your HTTPS origin.\nConfigure an HTTPS reverse proxy to `127.0.0.1:8080`, then run:\n\n```bash\ndocker compose up -d\ndocker compose exec crowsnest node server/cli.mjs setup-token\n```\n\nClaim the instance using the private server code. There is one owner account.\nWhile the registry package is private, authenticate to GHCR with read permission first.\nProtect `.env` and back up the persistent volume. Upgrades are deliberate.\n\nFull guide: https://github.com/' + context.repository + '/blob/' + context.tag + '/docs/self-hosting.md\n');
  execFileSync('docker', ['compose', '--file', 'output/release/compose.yaml', 'config', '--quiet'], {env: {...process.env, CROWSNEST_PUBLIC_URL: 'https://fleet.example.com'}, stdio: 'inherit'});
  const archive = 'output/crowsnest-' + version + '.tar.gz';
  execFileSync('tar', ['-czf', archive, '-C', 'output/release', 'compose.yaml', '.env.example', 'LICENSE', 'README.md']);
  const sbom = execFileSync('docker', ['buildx', 'imagetools', 'inspect', context.image + '@' + digest, '--format', '{{json .SBOM}}'], {encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024});
  const parsed = JSON.parse(sbom);
  for (const platform of ['linux/amd64', 'linux/arm64']) if (!parsed[platform]?.SPDX?.spdxVersion) throw new Error('Missing platform SBOM');
  const sbomPath = 'output/crowsnest-' + version + '-sbom.json';
  writeFileSync(sbomPath, sbom + '\n');
  const sums = 'output/SHA256SUMS';
  writeFileSync(sums, [archive, sbomPath].map(path => createHash('sha256').update(readFileSync(path)).digest('hex') + '  ' + path.split('/').pop()).join('\n') + '\n');
  const tag = await api(base + '/git/ref/tags/' + context.tag, {allow404: true});
  if (!tag) {
    const annotated = await api(base + '/git/tags', {method: 'POST', body: {tag: context.tag, message: 'Crowsnest ' + context.tag, object: context.sha, type: 'commit'}});
    await api(base + '/git/refs', {method: 'POST', body: {ref: 'refs/tags/' + context.tag, sha: annotated.sha}});
  } else {
    const target = tag.object.type === 'tag' ? (await api(base + '/git/tags/' + tag.object.sha)).object : tag.object;
    if (target.type !== 'commit' || target.sha !== context.sha) throw new Error('Refusing to change an existing release tag');
  }
  writeFileSync('output/release-notes.md', notes + '\n\nTested image: `' + context.image + '@' + digest + '`\n\nLinux amd64 and arm64; SBOM and build provenance are attached to the image.\nThe deployment archive pins the tested digest. Repository and registry visibility\nremain controlled by the owner. Publishing does not update running instances.\n');
  execFileSync('gh', ['release', 'create', context.tag, '--repo', context.repository, '--verify-tag', '--title', 'Crowsnest ' + context.tag, '--notes-file', 'output/release-notes.md', ...(version.includes('-') ? ['--prerelease'] : []), archive, sbomPath, sums], {stdio: 'inherit', timeout: 120000});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(error => {console.error(error.message); process.exitCode = 1;});
}
