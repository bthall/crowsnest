import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

export function configuration(env = process.env) {
  const publicUrl = new URL(env.CROWSNEST_PUBLIC_URL || 'http://127.0.0.1:8080');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname);
  if (publicUrl.username || publicUrl.password || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash || (publicUrl.protocol !== 'https:' && !(publicUrl.protocol === 'http:' && loopback))) throw new Error('CROWSNEST_PUBLIC_URL must be an HTTPS origin, or a loopback HTTP origin for development');
  const port = Number(env.CROWSNEST_PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CROWSNEST_PORT');
  const dataDir = resolve(env.CROWSNEST_DATA_DIR || './data');
  let ntfyToken = env.NTFY_TOKEN || '';
  if (env.NTFY_TOKEN_FILE) {
    if (ntfyToken) throw new Error('Use NTFY_TOKEN or NTFY_TOKEN_FILE, not both');
    const buffer = readFileSync(env.NTFY_TOKEN_FILE);
    if (buffer.length > 8192) throw new Error('ntfy token file is too large');
    ntfyToken = buffer.toString('utf8').trim();
  }
  if (ntfyToken && !/^[\x21-\x7e]{1,8192}$/.test(ntfyToken)) throw new Error('Invalid ntfy token');
  return {origin: publicUrl.origin, host: publicUrl.host, port, bind: env.CROWSNEST_BIND || '127.0.0.1', dataDir, database: resolve(dataDir, 'crowsnest.sqlite'), ntfyUrl: env.NTFY_URL || '', ntfyToken, ntfyEnabled: env.NTFY_ENABLED === 'true'};
}
