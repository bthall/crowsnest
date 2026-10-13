import Database from 'better-sqlite3';
import {access, chmod, copyFile, mkdir, rename, rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {configuration} from './config.mjs';
import {Storage} from './storage.mjs';
import {Authentication} from './auth.mjs';
import {fileURLToPath} from 'node:url';
import {underLock} from './lock.mjs';

process.umask(0o077);
const config = configuration();
const [command, argument] = process.argv.slice(2);
async function exists(path) { try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }

try {
  if (command === 'restore' && !process.argv.includes('--lock-held')) {
    await underLock(config.dataDir, fileURLToPath(import.meta.url), ['restore', ...(argument ? [argument] : [])]);
  } else
  if (command === 'restore') {
    if (!argument) throw new Error('Usage: node server/cli.mjs restore /path/to/backup.sqlite');
    const backup = resolve(argument);
    if (backup === config.database) throw new Error('Choose a separate backup file');
    const check = new Database(backup, {readonly: true, fileMustExist: true});
    try {
      if (check.pragma('integrity_check', {simple: true}) !== 'ok' || check.pragma('user_version', {simple: true}) !== 1) throw new Error('Backup is invalid or uses an unsupported schema');
      for (const table of ['objects', 'owner', 'sessions', 'bootstrap', 'limits']) if (!check.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error('Not a Crowsnest backup');
    } finally { check.close(); }
    await mkdir(config.dataDir, {recursive: true, mode: 0o700});
    const staged = config.database + '.restore-' + randomUUID();
    try {
      await copyFile(backup, staged, constants.COPYFILE_EXCL);
      await chmod(staged, 0o600);
      // Restored browsers must authenticate again; discard setup/recovery codes.
      const restored = new Database(staged);
      try { restored.exec('DELETE FROM sessions; DELETE FROM bootstrap;'); restored.pragma('wal_checkpoint(TRUNCATE)'); } finally { restored.close(); }
      await rename(staged, config.database);
      await rm(config.database + '-wal', {force: true});
      await rm(config.database + '-shm', {force: true});
    } finally { await rm(staged, {force: true}); }
    console.log('Backup restored. Start Crowsnest and sign in again.');
  } else {
    const storage = new Storage(config.database);
    try {
      if (['setup-token', 'reset-token'].includes(command)) {
        const auth = new Authentication(storage, config.origin);
        const code = await auth.issueCode(command === 'setup-token' ? 'setup' : 'reset');
        console.log('Private code (expires in 15 minutes):\n' + code + '\nOpen ' + config.origin + '/login' + (command === 'reset-token' ? '?recover=1' : ''));
      } else if (command === 'backup') {
        if (!argument) throw new Error('Usage: node server/cli.mjs backup /path/to/new-backup.sqlite');
        const destination = resolve(argument);
        if (destination === config.database || await exists(destination)) throw new Error('Backup destination must be a new file');
        const claim = await import('node:fs/promises').then(fs => fs.open(destination, 'wx', 0o600));
        await claim.close();
        try { await storage.db.backup(destination); await chmod(destination, 0o600); }
        catch (error) { await rm(destination, {force: true}); throw error; }
        console.log('Consistent backup created. Keep it private; it contains fleet credentials.');
      } else if (command === 'doctor') {
        console.log(JSON.stringify({schema: storage.db.pragma('user_version', {simple: true}), integrity: storage.db.pragma('quick_check', {simple: true}), ownerConfigured: !!storage.db.prepare('SELECT id FROM owner').get(), hostCount: storage.db.prepare("SELECT count(*) AS count FROM objects WHERE key LIKE 'hosts/%'").get().count}, null, 2));
      } else throw new Error('Commands: setup-token, reset-token, backup <file>, restore <file>, doctor');
    } finally { await storage.close(); }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
