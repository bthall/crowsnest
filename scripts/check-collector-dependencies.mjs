import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkDependencies, runtimePin, synchronizeCompose} from './collector-dependencies.mjs';

// Real repository drift is a failing check, not something CI silently rewrites.
checkDependencies();
const python = 'python:3.13.18-alpine@sha256:' + 'a'.repeat(64);
const proxy = 'haproxy:3.0.31-alpine@sha256:' + 'b'.repeat(64);
const oldPython = 'python:3.13.17-alpine@sha256:' + 'c'.repeat(64);
const oldProxy = 'haproxy:3.0.30-alpine@sha256:' + 'd'.repeat(64);
const template = `name: fixture
services:
  collector:
    image: ${oldPython} # preserve this comment
    environment:
      image: ${oldPython}
    volumes:
      - ./collector.json:/run/config/collector.json:ro
  unrelated:
    image: ${oldPython}
  socket-proxy:
    image: '${oldProxy}'
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
networks:
  collector:
    image: retained-even-if-not-valid-compose
`;
const directory = mkdtempSync(join(tmpdir(), 'crowsnest-runtime-pins-'));
try {
  mkdirSync(join(directory, 'collector'));
  mkdirSync(join(directory, 'worker'));
  writeFileSync(join(directory, 'collector/Dockerfile'), 'FROM ' + python + '\nCOPY worker/collector.py /app/collector.py\n');
  writeFileSync(join(directory, 'collector/Dockerfile.proxy'), 'FROM ' + proxy + '\n');
  const path = join(directory, 'worker/compose.yaml');
  writeFileSync(path, template);
  assert.throws(() => checkDependencies(directory), /--write/);
  assert.equal(readFileSync(path, 'utf8'), template, 'Validation must not rewrite files');
  assert.equal(checkDependencies(directory, true), true);
  const updated = readFileSync(path, 'utf8');
  assert.equal(updated, template.replace('    image: ' + oldPython + ' #', '    image: ' + python + ' #').replace("    image: '" + oldProxy + "'", '    image: ' + proxy));
  assert.equal(checkDependencies(directory), false);
  assert.equal(checkDependencies(directory, true), false, 'Synchronization must be idempotent');
  assert.equal(readFileSync(path, 'utf8'), updated);
  writeFileSync(join(directory, 'collector/Dockerfile'), 'FROM python:latest\n');
  assert.throws(() => checkDependencies(directory, true), /sha256 digest/);
  assert.equal(readFileSync(path, 'utf8'), updated, 'Invalid source pins must leave Compose untouched');
} finally {rmSync(directory, {recursive: true});}

assert.equal(runtimePin('FROM --platform=$BUILDPLATFORM ' + python + ' AS runtime\n', 'python', 'fixture'), python);
for (const source of ['FROM python:latest', 'FROM ' + python + '\nFROM ' + python,
  'FROM ' + python.replace('sha256:', 'sha512:'), 'FROM ' + proxy, 'FROM ${PYTHON_IMAGE}']) {
  assert.throws(() => runtimePin(source, 'python', 'fixture'));
}
for (const source of [template.replace('  collector:', '  another:'), template.replace('    image: ' + oldPython + ' #', '    image: [' + oldPython + '] #'),
  template.replace('  socket-proxy:', '  collector:'), template.replace('    image: ' + oldPython + ' #', '    image: ' + oldPython + '\n    image: ' + oldPython + ' #')]) {
  assert.throws(() => synchronizeCompose(source, {collector: python, 'socket-proxy': proxy}));
}
console.log('Collector dependency checks passed: pinned sources, legacy consistency, scoped synchronization, and failure without partial writes');
