// Packaged Dockerfiles own the runtime pins. Keep legacy enrollment on exactly
// those images without maintaining a second list of versions or hashes.
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const runtimes = [
  {service: 'collector', image: 'python', file: 'collector/Dockerfile'},
  {service: 'socket-proxy', image: 'haproxy', file: 'collector/Dockerfile.proxy'},
];

export function runtimePin(source, image, file) {
  const instructions = source.split(/\r?\n/).filter(line => /^FROM\s/i.test(line));
  if (instructions.length !== 1) throw new Error(file + ' must declare exactly one runtime FROM; review pin synchronization when adding stages');
  const from = /^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+\S+)?\s*$/i.exec(instructions[0]);
  if (!from || !new RegExp('^' + image + ':[A-Za-z0-9_.-]+@sha256:[a-f0-9]{64}$').test(from[1])) {
    throw new Error(file + ' must pin ' + image + ' by tag and sha256 digest');
  }
  return from[1];
}

export function synchronizeCompose(source, pins) {
  const lines = source.split('\n');
  let inServices = false, service = null;
  const foundServices = new Set(), foundImages = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^[^\s#]/.test(line)) {
      inServices = /^services:\s*(?:#.*)?$/.test(line);
      service = null;
      continue;
    }
    if (!inServices) continue;
    const heading = /^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$/.exec(line);
    if (heading) {
      service = heading[1];
      if (Object.hasOwn(pins, service)) {
        if (foundServices.has(service)) throw new Error('Duplicate legacy Compose service: ' + service);
        foundServices.add(service);
      }
      continue;
    }
    if (!Object.hasOwn(pins, service) || !/^    image:/.test(line)) continue;
    if (foundImages.has(service)) throw new Error('Duplicate legacy Compose image: ' + service);
    // Require one scalar image; a changed template needs deliberate adaptation,
    // never a broad replacement of matching strings elsewhere in the document.
    const image = /^    image:\s+(?:"[^"\r\n]+"|'[^'\r\n]+'|[A-Za-z0-9][A-Za-z0-9._:/@+-]*)(\s*(?:#.*)?)$/.exec(line);
    if (!image) throw new Error('Expected a scalar legacy Compose image for ' + service);
    lines[i] = '    image: ' + pins[service] + image[1];
    foundImages.add(service);
  }
  for (const service of Object.keys(pins)) {
    if (!foundImages.has(service)) throw new Error('Missing legacy Compose image for ' + service);
  }
  return lines.join('\n');
}

export function checkDependencies(root = process.cwd(), write = false) {
  const pins = Object.fromEntries(runtimes.map(({service, image, file}) =>
    [service, runtimePin(readFileSync(resolve(root, file), 'utf8'), image, file)]));
  const file = resolve(root, 'worker/compose.yaml');
  const existing = readFileSync(file, 'utf8'), rendered = synchronizeCompose(existing, pins);
  if (existing === rendered) return false;
  if (!write) throw new Error('Legacy collector image pins differ from the Dockerfiles. Run node scripts/collector-dependencies.mjs --write and commit worker/compose.yaml with the runtime update.');
  writeFileSync(file, rendered);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.slice(2).some(arg => arg !== '--write') || process.argv.length > 3) throw new Error('Usage: node scripts/collector-dependencies.mjs [--write]');
    const changed = checkDependencies(process.cwd(), process.argv.includes('--write'));
    console.log(changed ? 'Updated legacy collector runtime pins from Dockerfiles' : 'Collector runtime pins match');
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
