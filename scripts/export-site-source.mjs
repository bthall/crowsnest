// Export only approved source files; omit the maintainer's Site identity and all runtime data.
import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve, dirname, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const target = resolve(process.argv[2] || 'output/site-template');
const relation = relative(root, target);
if (!relation || relation === '..' || relation.startsWith('../') || isAbsolute(relation)) {
  throw new Error('Choose a new export directory inside this checkout.');
}
const files = [
  'package.json', 'package-lock.json',
  'scripts/build-board.mjs', 'scripts/validate-artifact.mjs',
  'scripts/preview.mjs', 'scripts/export-site-source.mjs',
  'scripts/check-board.mjs', 'scripts/check-installer.mjs',
  'scripts/check-enrollment.mjs',
  'scripts/check-collector-release.mjs', 'scripts/collector-release.mjs',
  'scripts/collector-metadata.mjs',
  'scripts/check-collector-changes.mjs', 'scripts/check-collector-change-guard.mjs',
  'scripts/collector-dependencies.mjs', 'scripts/check-collector-dependencies.mjs',
  'scripts/check-updater-manager.py',
  'scripts/check-credential-restart.mjs',
  'scripts/check-update-status.mjs', 'scripts/check-updater.py',
  'scripts/check-updater-engine.py',
  'collector/version.json', 'collector/crowsnest', 'collector/compose.yaml',
  'collector/Dockerfile', 'collector/Dockerfile.proxy',
  'scripts/check-notifications.mjs',
  'scripts/check-signals.mjs',
  'scripts/check-maintenance.mjs', 'scripts/check-collector.py',
  'scripts/check-details.mjs',
  'scripts/check-resources.mjs',
  'scripts/check-resilience.mjs', 'scripts/test-storage.mjs',
  'scripts/check-standalone.mjs', 'scripts/check-restore.mjs', 'scripts/check-docker.mjs',
  'scripts/check-proxy.mjs',
  'scripts/check-secret-scanner.mjs',
  'scripts/check-release.mjs', 'scripts/release.mjs', 'compose.yaml', 'CHANGELOG.md',
  'scripts/check-notifier.py', 'notifier/notifier.py', 'notifier/compose.yaml',
  'scripts/check-secrets.mjs', 'scripts/run-checks.mjs',
  'worker/index.js', 'worker/board.html', 'worker/board.js', 'worker/board.css',
  'worker/notifications.js',
  'worker/resources.js',
  'worker/signals.js',
  'worker/collector-directory.js',
  'worker/versions.js',
  'worker/collector.py', 'worker/proxy.cfg', 'worker/compose.yaml', 'worker/setup.sh',
  'worker/assets/crowsnest-mark.png', 'worker/assets/README.md',
  'LICENSE', 'server/storage.mjs', 'server/schema.mjs', 'server/auth.mjs', 'server/config.mjs',
  'server/runtime.mjs', 'server/index.mjs', 'server/cli.mjs', 'server/lock.mjs',
  'server/auth.html', 'server/auth.js', 'server/auth.css',
];
await mkdir(dirname(target), {recursive: true});
await mkdir(target); // Refuse to overwrite an existing export.
for (const file of files) {
  await mkdir(dirname(resolve(target, file)), {recursive: true});
  await copyFile(resolve(root, file), resolve(target, file));
}
await mkdir(resolve(target, '.openai'));
await writeFile(resolve(target, '.openai/hosting.json'), JSON.stringify({d1: null, r2: 'BUCKET'}, null, 2) + '\n');
await copyFile(resolve(root, '.gitignore'), resolve(target, '.gitignore'));
const {version} = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
await writeFile(resolve(target, 'README.md'), `# Crowsnest ${version} Site source

This source export has no Site ID, user records, host registrations, or collector credentials.
Use the ChatGPT Sites skill to create a new owner-private Site, preserve the returned identity,
provision the declared BUCKET storage, configure SITE_ORIGIN and the secret
COLLECTOR_SERVICE_TOKEN through Sites, and publish the matching Worker build.
Do not reuse the maintainer's Site identity or service credential.

Build: npm ci --ignore-scripts --no-audit --no-fund && npm run check

Setup guide: https://github.com/bthall/crowsnest/blob/main/docs/chatgpt-sites.md
`);
console.log('Clean Site source exported to ' + target);
