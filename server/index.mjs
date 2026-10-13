import {fileURLToPath} from 'node:url';
import {configuration} from './config.mjs';
import {createRuntime} from './runtime.mjs';
import {underLock} from './lock.mjs';

process.umask(0o077);
const config = configuration();
if (!process.argv.includes('--lock-held')) {
  await underLock(config.dataDir, fileURLToPath(import.meta.url));
} else {
  const runtime = await createRuntime(config);
  await new Promise((resolve, reject) => { runtime.server.once('error', reject); runtime.server.listen(config.port, config.bind, resolve); });
  console.log('Crowsnest is ready. Owner setup: node server/cli.mjs setup-token');
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    const forced = setTimeout(() => process.exit(1), 25000);
    forced.unref();
    try { await runtime.close(); clearTimeout(forced); }
    catch { console.error('Shutdown did not complete cleanly'); process.exitCode = 1; }
  }
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
