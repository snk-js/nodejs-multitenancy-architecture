# Snapshot — Epoch 08: Reliability & Performance

Companion code for [`epochs/epoch-08-reliability-and-performance.md`](../../epochs/epoch-08-reliability-and-performance.md).

```bash
cp .env.example .env
docker compose up -d               # postgres AND redis now
npm install && npm run migrate
npm run typecheck && npm test
npm run dev

curl localhost:3000/health/live    # liveness: no dependencies, ever
curl localhost:3000/health/ready   # readiness: checks pg + redis, 503 while draining
# deploy-drill: kill -TERM <pid> mid-request → drain, then exit 0
```

What changed vs epoch-07: `diff -ru ../epoch-07 .`
— timeouts everywhere (server, pool `statement_timeout`, fail-fast Redis), graceful
drain-then-exit shutdown + crash-on-unknown, liveness≠readiness, cache-aside with
tenant-namespaced keys (`src/cache.ts`), per-tenant distributed rate limiting, and
backoff-with-full-jitter retries (`src/lib/retry.ts`).
