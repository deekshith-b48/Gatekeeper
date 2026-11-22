import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGatekeeper } from '../src/gatekeeper.js';

const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`)));

async function setup(opts = {}) {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ url: req.url, method: req.method, body, auth: req.headers['x-api-key'] ?? req.headers.authorization });
      res.writeHead(201, { 'x-up': '1' });
      res.end(`echo:${body}`);
    });
  });
  const gw = createGatekeeper({ keys: ['secret'], upstream: await listen(upstream), ...opts });
  const base = await listen(gw);
  return { base, seen, close: () => { gw.close(); upstream.close(); } };
}

test('health is open', async () => {
  const t = await setup();
  assert.equal((await fetch(`${t.base}/healthz`)).status, 200);
  t.close();
});

test('rejects missing and wrong keys', async () => {
  const t = await setup();
  assert.equal((await fetch(`${t.base}/x`)).status, 401);
  assert.equal((await fetch(`${t.base}/x`, { headers: { 'x-api-key': 'nope' } })).status, 401);
  assert.equal(t.seen.length, 0);
  t.close();
});

test('proxies with x-api-key or Bearer, forwards body, strips credentials', async () => {
  const t = await setup();
  const r = await fetch(`${t.base}/a?b=1`, { method: 'POST', body: 'hi', headers: { 'x-api-key': 'secret' } });
  assert.equal(r.status, 201);
  assert.equal(r.headers.get('x-up'), '1');
  assert.equal(await r.text(), 'echo:hi');
  const r2 = await fetch(`${t.base}/z`, { headers: { authorization: 'Bearer secret' } });
  assert.equal(r2.status, 201);
  assert.deepEqual(t.seen.map((s) => [s.url, s.body, s.auth]), [['/a?b=1', 'hi', undefined], ['/z', '', undefined]]);
  t.close();
});

test('rate limits per key', async () => {
  const t = await setup({ limit: 2 });
  const h = { 'x-api-key': 'secret' };
  assert.equal((await fetch(`${t.base}/`, { headers: h })).status, 201);
  const second = await fetch(`${t.base}/`, { headers: h });
  assert.equal(second.headers.get('x-ratelimit-remaining'), '0');
  const third = await fetch(`${t.base}/`, { headers: h });
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers.get('retry-after')) >= 1);
  t.close();
});

test('502 when upstream is down', async () => {
  const gw = createGatekeeper({ keys: ['k'], upstream: 'http://127.0.0.1:1' });
  const base = await listen(gw);
  assert.equal((await fetch(`${base}/`, { headers: { 'x-api-key': 'k' } })).status, 502);
  gw.close();
});

test('requires keys', () => {
  assert.throws(() => createGatekeeper({ keys: [], upstream: 'http://x' }));
});
