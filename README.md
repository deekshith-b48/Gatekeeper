# Gatekeeper

Zero-dependency API gateway in front of any HTTP service: API-key auth, per-key rate limiting, streaming reverse proxy.

```bash
API_KEYS=key1,key2 UPSTREAM_URL=http://localhost:3000 npm start
curl -H 'x-api-key: key1' localhost:8080/some/path   # or Authorization: Bearer key1
```

| Env | Default | |
|---|---|---|
| `API_KEYS` | required | comma-separated valid keys |
| `UPSTREAM_URL` | required | where requests are proxied |
| `RATE_LIMIT` / `RATE_WINDOW_MS` | 60 / 60000 | requests per key per window |
| `PORT` | 8080 | |

- `/healthz` is unauthenticated. Missing/invalid key → 401; over limit → 429 with `Retry-After`; upstream failure → 502.
- API keys are stripped before forwarding. Rate-limit state is in-memory per process.
- Tests: `npm test` (Node ≥ 20). CI runs on every push/PR.
