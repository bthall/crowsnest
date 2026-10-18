import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import Database from 'better-sqlite3';
import {Storage} from '../server/storage.mjs';

const directory = await mkdtemp(join(tmpdir(), 'crowsnest-restore-'));
const dataDir = join(directory, 'live'), database = join(dataDir, 'crowsnest.sqlite');
function restore(source) {
  const result = spawnSync(process.execPath, ['server/cli.mjs', 'restore', source], {
    cwd: resolve('.'), encoding: 'utf8', timeout: 30000,
    env: {...process.env, CROWSNEST_DATA_DIR: dataDir},
  });
  if (result.error) throw result.error;
  return result;
}
let source;
try {
  const live = new Storage(database);
  await live.put('sentinel', '{"preserve":true}');
  await live.close();
  const original = await readFile(database);
  for (const variant of ['columns', 'constraints', 'index', 'trigger', 'version']) {
    const filename = join(directory, variant + '.sqlite');
    const fixture = new Storage(filename);
    if (variant === 'columns') fixture.db.exec('ALTER TABLE objects RENAME COLUMN value TO wrong');
    if (variant === 'constraints') fixture.db.exec('DROP TABLE owner; CREATE TABLE owner (id INTEGER PRIMARY KEY, username TEXT NOT NULL, password TEXT NOT NULL) STRICT');
    if (variant === 'index') fixture.db.exec('DROP INDEX sessions_expiry');
    if (variant === 'trigger') fixture.db.exec('CREATE TRIGGER retain_sessions BEFORE DELETE ON sessions BEGIN SELECT RAISE(IGNORE); END');
    if (variant === 'version') fixture.db.pragma('user_version = 2');
    await fixture.close();
    const result = restore(filename);
    assert.notEqual(result.status, 0, variant + ': incompatible backup was accepted');
    assert.deepEqual(await readFile(database), original, variant + ': live database changed');
    assert.ok(!(await readdir(dataDir)).some(name => name.includes('.restore-')), variant + ': staging files leaked');
  }

  // Keep committed changes in the source WAL while the CLI snapshots it.
  // A raw copy of only the database file would silently lose this state.
  const filename = join(directory, 'wal.sqlite');
  source = new Storage(filename);
  source.db.pragma('wal_checkpoint(TRUNCATE)');
  await source.put('latest', '{"committedInWal":true}');
  source.db.prepare('INSERT INTO sessions VALUES (?, ?)').run('synthetic-session', Date.now() + 60000);
  source.db.prepare('INSERT INTO bootstrap VALUES (1, ?, ?, ?)').run('synthetic-code', Date.now() + 60000, 'setup');
  assert.ok((await stat(filename + '-wal')).size > 0);
  const result = restore(filename);
  assert.equal(result.status, 0, result.stderr);
  const restored = new Storage(database);
  try {
    assert.deepEqual(await (await restored.get('latest'))?.json(), {committedInWal: true});
    assert.equal(await restored.get('sentinel'), null);
    assert.equal(restored.db.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
    assert.equal(restored.db.prepare('SELECT count(*) AS n FROM bootstrap').get().n, 0);
  } finally { await restored.close(); }
  assert.equal(source.db.prepare('SELECT count(*) AS n FROM sessions').get().n, 1);
  assert.equal(source.db.prepare('SELECT count(*) AS n FROM bootstrap').get().n, 1);
  assert.equal((await stat(database)).mode & 0o777, 0o600);
  assert.ok(!(await readdir(dataDir)).some(name => name.includes('.restore-')));
  console.log('Restore checks passed: incompatible schema rejection, original preservation, WAL snapshot, credential invalidation, private files, and staging cleanup');
} finally {
  if (source) await source.close();
  await rm(directory, {recursive: true, force: true});
}
