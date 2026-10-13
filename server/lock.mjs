import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

/** Kernel-owned lock: released automatically on exit, crash, or container restart. */
export async function underLock(dataDir, script, args = []) {
  await mkdir(dataDir, {recursive: true, mode: 0o700});
  const child = spawn('flock', ['--nonblock', '--no-fork', '--conflict-exit-code', '73', resolve(dataDir, 'server.lock'), process.execPath, script, ...args, '--lock-held'], {stdio: 'inherit'});
  const forward = signal => child.kill(signal);
  const term = () => forward('SIGTERM'), interrupt = () => forward('SIGINT');
  process.on('SIGTERM', term);
  process.on('SIGINT', interrupt);
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (code === 73) console.error('The data directory is in use. Stop Crowsnest before starting another instance or restoring.');
        process.exitCode = code ?? (signal ? 1 : 0);
        resolve();
      });
    });
  } finally { process.off('SIGTERM', term); process.off('SIGINT', interrupt); }
}
