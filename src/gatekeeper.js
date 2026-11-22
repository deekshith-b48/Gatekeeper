import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';

const sha = (s) => createHash('sha256').update(s).digest();
const HOP = ['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host', 'content-length', 'content-encoding'];

/**
 * @param {{keys: string[], upstream: string, limit?: number, windowMs?: number}} opts
 * Rate limit is a fixed window kept in memory (per process) — use a shared store if you run several instances.
 */
export function createGatekeeper({ keys, upstream, limit = 60, windowMs = 60_000 }) {
  if (!keys?.length) throw new Error('at least one API key is required');
  const hashes = keys.map(sha);
  const hits = new Map(); // key index -> {count, resetAt}

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    if (req.url === '/healthz') return send(res, 200, { ok: true });

    const auth = req.headers.authorization;
    const supplied = req.headers['x-api-key'] ?? (auth?.startsWith('Bearer ') ? auth.slice(7) : '');
    const h = sha(String(supplied));
    const idx = hashes.findIndex((k) => timingSafeEqual(k, h));
    if (idx < 0) return send(res, 401, { error: 'invalid or missing API key' });

    const now = Date.now();
    let w = hits.get(idx);
    if (!w || now >= w.resetAt) hits.set(idx, (w = { count: 0, resetAt: now + windowMs }));
    w.count++;
    const rl = {
      'x-ratelimit-limit': limit,
      'x-ratelimit-remaining': Math.max(0, limit - w.count),
    };
    if (w.count > limit) {
      return send(res, 429, { error: 'rate limit exceeded' }, { ...rl, 'retry-after': Math.ceil((w.resetAt - now) / 1000) });
    }

    try {
      const headers = Object.fromEntries(
        Object.entries(req.headers).filter(([k]) => !HOP.includes(k) && k !== 'x-api-key' && k !== 'authorization'),
      );
      const hasBody = !['GET', 'HEAD'].includes(req.method);
      const up = await fetch(new URL(req.url, upstream), {
        method: req.method,
        headers,
        body: hasBody ? Readable.toWeb(req) : undefined,
        duplex: 'half',
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      });
      const out = Object.fromEntries([...up.headers].filter(([k]) => !HOP.includes(k)));
      res.writeHead(up.status, { ...out, ...rl });
      if (up.body) Readable.fromWeb(up.body).pipe(res);
      else res.end();
    } catch {
      if (!res.headersSent) send(res, 502, { error: 'upstream unavailable' }, rl);
      else res.destroy();
    }
  });
  return server;
}
