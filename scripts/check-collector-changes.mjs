// Release-input drift guard, shared by pull-request CI and trusted publication.
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {posix} from 'node:path';
import {compareVersions, validateCollectorMetadata} from './collector-metadata.mjs';

const releasePaths = new Set([
  '.dockerignore', '.github/workflows/collector-release.yml', 'LICENSE',
  'worker/collector.py', 'worker/proxy.cfg', 'worker/compose.yaml', 'worker/setup.sh',
  'scripts/build-board.mjs', 'scripts/collector-metadata.mjs', 'scripts/collector-release.mjs',
  'scripts/check-collector-changes.mjs', 'scripts/collector-dependencies.mjs', 'scripts/release.mjs',
]);
const managerPaths = new Set(['collector/crowsnest', 'scripts/collector-metadata.mjs']);
export const isCollectorReleaseInput = path => path.startsWith('collector/') || releasePaths.has(path);

export function changedCollectorInputs(previous, current) {
  return [...new Set([...Object.keys(previous), ...Object.keys(current)])]
    .filter(isCollectorReleaseInput).filter(path => previous[path] !== current[path]).sort();
}

export const collectorRecipes = ['collector/Dockerfile', 'collector/Dockerfile.proxy'];

function copySources(text, recipe) {
  const sources = [];
  if (/^\s*#\s*escape\s*=\s*[^\\\s]/im.test(text)) throw new Error('Unsupported Dockerfile escape directive in ' + recipe);
  // Deliberately accept the simple, auditable recipe subset used by these two
  // images. Fail closed when a new build context/stage needs dependency analysis.
  const lines = text.replace(/\\\r?\n[ \t]*/g, ' ').split(/\r?\n/);
  for (const line of lines) {
    const match = /^\s*(COPY|ADD)\s+(.+)$/i.exec(line);
    if (!match) {
      if (/^\s*(COPY|ADD)\b/i.test(line)) throw new Error('Malformed image copy instruction in ' + recipe);
      continue;
    }
    if (match[1].toUpperCase() === 'ADD') throw new Error('Release input coverage cannot verify ADD in ' + recipe + '; use local COPY sources');
    let rest = match[2].trim();
    while (rest.startsWith('--')) {
      const flag = /^(--[^\s]+)\s+(.+)$/.exec(rest);
      if (!flag) throw new Error('Malformed COPY options in ' + recipe);
      if (!/^(?:--(?:chown|chmod)=[a-zA-Z0-9_:,+-]+|--link|--parents)$/.test(flag[1])) {
        throw new Error('Release input coverage cannot verify COPY option ' + flag[1] + ' in ' + recipe + '; declare the build inputs explicitly and extend the coverage check');
      }
      rest = flag[2];
    }
    let entries;
    if (rest.startsWith('[')) {
      try {entries = JSON.parse(rest);} catch {throw new Error('Malformed JSON COPY in ' + recipe);}
    } else {
      if (/['"`\\]/.test(rest)) throw new Error('Use JSON COPY syntax for quoted paths in ' + recipe);
      entries = rest.split(/\s+/);
    }
    if (!Array.isArray(entries) || entries.length < 2 || entries.some(value => typeof value !== 'string' || !value || /[\x00-\x1f]/.test(value))) throw new Error('Malformed COPY sources in ' + recipe);
    for (const source of entries.slice(0, -1)) {
      if (/\$|\\|\[|\]|:/.test(source) || source.split('/').includes('..')) throw new Error('Unsupported COPY source ' + source + ' in ' + recipe + '; use explicit local paths or * / ? globs');
      sources.push(posix.normalize(source.replace(/^\/+/, '')).replace(/\/$/, ''));
    }
  }
  return sources;
}

export function validateCopyInputCoverage(files, recipes) {
  const paths = Object.keys(files);
  for (const recipe of collectorRecipes) {
    if (typeof recipes?.[recipe] !== 'string') throw new Error('Release input coverage is missing image recipe ' + recipe);
    for (const source of copySources(recipes[recipe], recipe)) {
      const escaped = source.match(/\*\*|[\s\S]/g).map(character => character === '**' ? '.*' : character === '*' ? '[^/]*' : character === '?' ? '[^/]' : character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
      const pattern = new RegExp('^' + escaped + '$');
      const matches = paths.filter(path => source === '.' || pattern.test(path) || path.split('/').slice(0, -1).some((_, index, parts) => pattern.test(parts.slice(0, index + 1).join('/'))));
      if (!matches.length) throw new Error('COPY source ' + source + ' in ' + recipe + ' matches no tracked build input');
      const uncovered = matches.filter(path => !isCollectorReleaseInput(path));
      if (uncovered.length) throw new Error('Untracked collector release inputs from ' + recipe + ': ' + uncovered.join(', ') + '; add them to isCollectorReleaseInput before changing the image');
      const unsupported = matches.filter(path => !/^100(?:644|755) blob /.test(files[path]));
      if (unsupported.length) throw new Error('Unsupported collector build input type: ' + unsupported.join(', '));
    }
  }
}

export function checkCollectorChanges(previous, current) {
  const metadata = validateCollectorMetadata(current.metadata);
  validateCopyInputCoverage(current.files, current.recipes);
  if (!previous) return {firstRelease: true, changed: []};
  const before = validateCollectorMetadata(previous.metadata);
  const changed = changedCollectorInputs(previous.files, current.files);
  const comparison = compareVersions(metadata.version, before.version);
  if (comparison < 0 || (changed.length && comparison === 0)) {
    throw new Error('Collector release inputs changed without a newer collector/version.json version: ' + changed.join(', '));
  }
  const managerChanged = changed.some(path => managerPaths.has(path)) || metadata.protocol !== before.protocol || metadata.minimumProtocol !== before.minimumProtocol;
  const managerComparison = compareVersions(metadata.managerVersion, before.managerVersion);
  if (managerComparison < 0 || (managerChanged && managerComparison === 0)) {
    throw new Error('Updater source or reporting protocol changed without a newer managerVersion in collector/version.json');
  }
  return {firstRelease: false, changed, managerChanged};
}

function git(args, cwd) {
  return execFileSync('git', args, {cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
}

export function gitSnapshot(ref, cwd = process.cwd(), includeRecipes = true) {
  const files = {};
  for (const entry of git(['ls-tree', '-r', '-z', '--full-tree', ref], cwd).split('\0').filter(Boolean)) {
    const match = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
    if (!match) throw new Error('Invalid Git tree entry');
    const [, mode, type, sha, path] = match;
    files[path] = [mode, type, sha].join(' ');
  }
  const recipes = includeRecipes ? Object.fromEntries(collectorRecipes.map(path => [path, git(['show', ref + ':' + path], cwd)])) : undefined;
  return {files, recipes, metadata: JSON.parse(git(['show', ref + ':collector/version.json'], cwd))};
}

export function checkGitCollectorChanges(cwd = process.cwd()) {
  if (git(['rev-parse', '--is-shallow-repository'], cwd).trim() !== 'false') throw new Error('Collector release guard requires full history and tags; set actions/checkout fetch-depth: 0');
  const tags = git(['tag', '--list', 'collector-v*'], cwd).trim().split('\n')
    .filter(tag => /^collector-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag))
    .sort((left, right) => compareVersions(left.slice(11), right.slice(11)));
  const tag = tags.at(-1);
  const previous = tag ? gitSnapshot(tag, cwd, false) : null;
  if (previous && previous.metadata.version !== tag.slice(11)) throw new Error('Collector release tag disagrees with its version metadata');
  return {...checkCollectorChanges(previous, gitSnapshot('HEAD', cwd)), baseline: tag || null};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = checkGitCollectorChanges();
    console.log(result.firstRelease ? 'Collector release guard: first independent release' : 'Collector release guard passed against ' + result.baseline);
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
