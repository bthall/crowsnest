import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {readFile} from 'node:fs/promises';
import app from '../dist/server/index.js';
import {Storage} from './storage.mjs';
import {Authentication} from './auth.mjs';

const securityHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {status, headers: {...securityHeaders, 'Content-Type': 'application/json', ...headers}});

async function body(request, maximum) {
  if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') throw Object.assign(new Error('Compressed request bodies are not supported'), {status: 415});
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    const cleanup = () => { request.off('data', data); request.off('end', end); request.off('error', error); request.off('aborted', aborted); };
    const error = failure => { cleanup(); reject(failure); };
    const aborted = () => error(Object.assign(new Error('Request was interrupted'), {status: 400}));
    const data = part => {
      size += part.length;
      if (size > maximum) { cleanup(); request.resume(); reject(Object.assign(new Error('Request body exceeds the limit'), {status: 413})); }
      else parts.push(part);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(parts)); };
    request.on('data', data); request.once('end', end); request.once('error', error); request.once('aborted', aborted);
  });
}

function objectJson(bytes) {
  const data = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected an object');
  return data;
}

export async function createRuntime(config, {schedule = true, assets} = {}) {
  const storage = new Storage(config.database);
  const authentication = new Authentication(storage, config.origin);
  const authAssets = assets || await Promise.all(['auth.html', 'auth.js', 'auth.css'].map(file => readFile(new URL(file, import.meta.url), 'utf8')));
  const environment = {
    BUCKET: storage, AUTH_MODE: 'standalone', DEFER_NOTIFICATIONS: true,
    SITE_ORIGIN: config.origin, DASHBOARD_ORIGIN: config.origin,
    NTFY_URL: config.ntfyUrl, NTFY_TOKEN: config.ntfyToken,
    NTFY_ENABLED: String(config.ntfyEnabled),
  };
  let active = 0, closing = false, sweepPromise = null;

  async function sweep() {
    if (closing || sweepPromise) return sweepPromise;
    sweepPromise = (async () => {
      let work;
      await app.scheduled(null, environment, {waitUntil: promise => { work = promise; }});
      await work;
    })().catch(() => console.error('Background notification check failed')).finally(() => { sweepPromise = null; });
    return sweepPromise;
  }

  async function route(incoming) {
    if (closing) return json({error: 'Server is shutting down'}, 503);
    if (active >= 64) return json({error: 'Server is busy. Try again shortly.'}, 503, {'Retry-After': '5'});
    active++;
    try {
      const rawPath = incoming.url || '/';
      if (!rawPath.startsWith('/') || rawPath.startsWith('//') || rawPath.includes('\\') || rawPath.length > 8192) return json({error: 'Invalid request target'}, 400);
      const url = new URL(config.origin + rawPath);
      if (url.pathname === '/healthz' && incoming.method === 'GET') {
        await storage.run(() => storage.db.prepare('SELECT 1').get());
        return json({ok: true});
      }
      if (incoming.headers.host !== config.host) return json({error: 'Host does not match CROWSNEST_PUBLIC_URL'}, 421);
      const method = incoming.method || 'GET';
      const writes = !['GET', 'HEAD', 'OPTIONS'].includes(method);
      const ingest = /^\/api\/ingest\/[a-f0-9-]{36}$/.test(url.pathname) && method === 'POST';
      const authenticated = !ingest && await authentication.authenticated(incoming.headers.cookie);
      if (writes && !ingest && incoming.headers.origin !== config.origin) return json({error: 'Invalid origin'}, 403);
      if (url.pathname.startsWith('/auth/')) {
        if (url.pathname === '/auth/state' && method === 'GET') return json(await authentication.state());
        if (url.pathname === '/auth/logout' && method === 'POST') return json({ok: true}, 200, {'Set-Cookie': await authentication.logout(incoming.headers.cookie)});
        if (['/auth/login', '/auth/setup'].includes(url.pathname) && method === 'POST') {
          let data;
          try { data = objectJson(await body(incoming, 8192)); }
          catch (error) { return json({error: error.status === 413 ? error.message : 'Enter valid sign-in details'}, error.status || 400); }
          const cookie = await authentication[url.pathname === '/auth/setup' ? 'enroll' : 'login'](data, incoming.socket.remoteAddress);
          return json({ok: true}, 200, {'Set-Cookie': cookie});
        }
        return json({error: 'Not found'}, 404);
      }
      if (url.pathname === '/login' && method === 'GET') {
        let destination='/';
        try {const target=new URL(url.searchParams.get('next')||'/',config.origin);if(target.origin===config.origin && target.pathname==='/')destination=target.pathname+target.search;}catch{}
        if (authenticated && url.searchParams.get('recover') !== '1') return new Response(null, {status: 303, headers: {...securityHeaders, Location: destination}});
        return new Response(authAssets[0], {headers: {...securityHeaders, 'Content-Type': 'text/html; charset=utf-8'}});
      }
      if (['/assets/auth.js', '/assets/auth.css'].includes(url.pathname) && method === 'GET') return new Response(authAssets[url.pathname.endsWith('.js') ? 1 : 2], {headers: {...securityHeaders, 'Content-Type': url.pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8'}});
      const publicAsset = ['/assets/board.css', '/assets/crowsnest-mark.png'].includes(url.pathname) && method === 'GET';
      if (!authenticated && !ingest && !publicAsset) return url.pathname === '/' && method === 'GET' ? new Response(null, {status: 303, headers: {...securityHeaders, Location: '/login'+(url.search?'?next='+encodeURIComponent('/'+url.search):'')}}) : json({error: 'Sign in to view this private board'}, 401);
      if (url.pathname === '/api/session' && method === 'GET') return json({standalone: true});
      if (url.pathname === '/api/notifications/sweep' && method === 'POST') return json({error: 'Notification checks run automatically'}, 409);
      const requestHeaders = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string' && !key.startsWith('oai-') && !['cookie', 'host', 'connection', 'content-length', 'transfer-encoding'].includes(key)) requestHeaders.set(key, value);
      }
      if (authenticated || publicAsset) requestHeaders.set('oai-authenticated-user-id', 'standalone-owner');
      const bytes = writes ? await body(incoming, 131072) : undefined;
      const request = new Request(url, {method, headers: requestHeaders, ...(bytes ? {body: bytes} : {})});
      const response = writes ? await storage.run(() => app.fetch(request, environment), {atomic: true}) : await app.fetch(request, environment);
      if (url.pathname === '/' && response.status === 200) {
        return new Response((await response.text()).replace('<body>', '<body data-auth-mode="standalone">'), {status: response.status, headers: {...Object.fromEntries(response.headers), ...securityHeaders}});
      }
      for (const [key, value] of Object.entries(securityHeaders)) if (!response.headers.has(key)) response.headers.set(key, value);
      return response;
    } catch (error) {
      // Never log credentials, request bodies, cookies, or database content.
      if (!error.status) console.error('Request failed', error.name);
      return json({error: error.status ? error.message : 'Unable to complete the request. Try again.'}, error.status || 503);
    } finally { active--; }
  }

  const server = createServer({requestTimeout: 30000, headersTimeout: 10000, keepAliveTimeout: 5000, maxHeaderSize: 16384}, async (request, response) => {
    try {
      const result = await route(request);
      response.writeHead(result.status, Object.fromEntries(result.headers));
      if (result.body) await pipeline(Readable.fromWeb(result.body), response);
      else response.end();
    } catch { if (!response.headersSent) response.writeHead(500); response.end(); }
  });
  server.maxRequestsPerSocket = 100;
  const timer = schedule ? setInterval(sweep, 30000) : null;
  timer?.unref();
  return {
    server, storage, authentication, sweep,
    async close() {
      closing = true;
      if (timer) clearInterval(timer);
      const stopped = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeIdleConnections();
      await stopped;
      if (sweepPromise) await sweepPromise;
      await storage.close();
    },
  };
}
