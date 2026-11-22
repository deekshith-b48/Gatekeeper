import { createGatekeeper } from './gatekeeper.js';

const { API_KEYS, UPSTREAM_URL, RATE_LIMIT, RATE_WINDOW_MS, PORT = 8080 } = process.env;
if (!API_KEYS || !UPSTREAM_URL) {
  console.error('Set API_KEYS (comma-separated) and UPSTREAM_URL');
  process.exit(1);
}
createGatekeeper({
  keys: API_KEYS.split(',').map((k) => k.trim()).filter(Boolean),
  upstream: UPSTREAM_URL,
  limit: RATE_LIMIT ? Number(RATE_LIMIT) : undefined,
  windowMs: RATE_WINDOW_MS ? Number(RATE_WINDOW_MS) : undefined,
}).listen(PORT, () => console.log(`gatekeeper on :${PORT} -> ${UPSTREAM_URL}`));
