# Epoch 08 — Reliability & Performance

> **You arrive with:** a correct, isolated backend that works when everything around it works.
> **You leave with:** a backend engineered for the day things *don't*: timeouts everywhere, graceful shutdown, real health checks, Redis caching with honest invalidation, distributed rate limiting, retries that don't stampede — and load-test numbers instead of adjectives.

---

## 8.1 The pain

Production is not your laptop. In production: the database restarts mid-request, a tenant's webhook target holds sockets open for 90 seconds, a deploy replaces your process while 200 requests are in flight, and traffic arrives in spikes, not curls. None of these are *errors* in your code — they're the weather. Reliability engineering is building for weather.

One principle organizes this whole epoch: **a slow dependency is more dangerous than a dead one.** Dead things fail fast and trip error handling; slow things *accumulate* — every pending request holds memory, a socket, and (worst) a pooled DB connection. Slowness propagates upstream as *your* slowness. Nearly every mechanism below is a way of converting unbounded slowness into bounded, explicit failure.

## 8.2 Timeouts: nothing waits forever

Every await that crosses a process boundary gets a deadline. Inventory for Trellis:

```ts
// Server side — Fastify/Node
const app = Fastify({
  connectionTimeout: 10_000,     // slow-open connections
  requestTimeout: 30_000,        // hard cap on any request's lifetime
  keepAliveTimeout: 72_000,      // > your load balancer's idle timeout (see below)
});

// Database — pool AND statements
new pg.Pool({ connectionTimeoutMillis: 5_000, /* … */ });
// per-connection: SET statement_timeout = '10s'  → no query may hold a connection hostage

// Outbound HTTP — native fetch + AbortSignal
const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
```

- 🛡️ **`statement_timeout` is pool-exhaustion insurance.** One accidental `SELECT` without its index, on a big tenant, times 10 concurrent requests = your entire pool pinned (Epoch 03's arithmetic). A 10s statement cap turns that into 10 failed requests and an alert — bounded damage.
- 🛡️ **`keepAliveTimeout` must exceed the load balancer's idle timeout.** If Node closes an idle keep-alive socket *just* as the LB reuses it, users see random `502`s. Infamous, rare-enough-to-madden, and purely a config relationship: LB 60s → Node 72s. Now you know it before it costs you a weekend.
- ⚖️ Timeout values are budgets, not folklore: an end-user request worth 30s can afford a 10s query and a 5s outbound call with room for one retry. Set them top-down from the user-facing budget.

## 8.3 Graceful shutdown: deploys shouldn't drop requests

Every deploy kills your process. Kubernetes/ECS/systemd send `SIGTERM`, wait a grace period (default ~30s), then `SIGKILL`. What happens in between is your code's responsibility:

```ts
// src/server.ts
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;                       // 1. flip readiness → LB stops sending traffic
  app.log.info({ signal }, "shutdown: draining");
  const deadline = setTimeout(() => process.exit(1), 25_000);  // 2. hard backstop < SIGKILL

  try {
    await app.close();                       // 3. stop accepting; wait for in-flight to finish
    await pool.end();                        // 4. THEN close db pool (order matters:
    await redis.quit();                      //    in-flight requests still need connections)
    clearTimeout(deadline);
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "shutdown: forced");
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

The order is the content: **readiness off → drain → close resources → exit**, with a hard deadline shorter than the platform's. Epoch 00's little `SIGINT` handler was this pattern's seed; Epoch 09 adds "stop claiming new jobs, finish current ones" for workers.

Related process-level policy: 🛡️ **crash on truly unknown errors.** `uncaughtException`/`unhandledRejection` → log, then exit. A process that limps on past an unknown exception is in undefined state — corrupt in ways you can't enumerate. Let it die; the supervisor restarts clean. "Keep it alive at all costs" is how you get the 3-week-old zombie process that serves one stale response per hour.

## 8.4 Health: liveness vs readiness (they are not the same question)

- **Liveness** — "should this process be restarted?" Cheap, dependency-free: the event loop responds. *Never* check the DB here: a DB outage would make the platform kill and restart *every healthy app instance* — a restart storm on top of a database incident.
- **Readiness** — "should this process receive traffic?" *Does* check dependencies (`SELECT 1`, Redis `PING`), and returns false during shutdown drain (§8.3 step 1).

```ts
app.get("/health/live", async () => ({ status: "ok" }));

app.get("/health/ready", async (_, reply) => {
  if (shuttingDown) return reply.code(503).send({ status: "draining" });
  try {
    await Promise.all([pool.query("SELECT 1"), redis.ping()]);
    return { status: "ready" };
  } catch {
    return reply.code(503).send({ status: "degraded" });
  }
});
```

Conflating the two is one of the most common production-Kubernetes mistakes; the restart storm above is its signature incident.

## 8.5 Caching with Redis — and the only honest cache-invalidation story

```bash
npm install ioredis   # and add redis:7-alpine to compose.yaml
```

Cache-aside for read-heavy, rarely-changing data (here: workspace settings, member lists — *not* the fast-churning task list):

```ts
// src/cache.ts
export async function cached<T>(key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
  const hit = await redis.get(key);
  if (hit !== null) return JSON.parse(hit);
  const value = await load();
  await redis.set(key, JSON.stringify(value), "EX", ttlSec);
  return value;
}

// 🛡️ tenant-namespaced keys, ALWAYS — a cache is a data store, and Epoch 06's laws follow data
const key = `ws:${tenant.id}:settings`;
```

The three rules that keep caching from becoming your best bug generator:

1. **Tenant id in every key.** A cache key like `settings:${settingsId}` collides across tenants the day two tenants share an id-shaped value — cross-tenant leak via cache, no SQL involved, RLS helpless (it never saw a query). The cache is a second data store and inherits every isolation obligation. It's also now on Epoch 07's purge inventory: offboarding must sweep `ws:${id}:*`.
2. **TTL on everything, even with explicit invalidation.** Your `del()` calls will miss a write path someday; TTL turns "wrong forever" into "wrong for ≤60 seconds." Decide staleness tolerance per key — it's a product question wearing an engineering costume.
3. **Invalidate on write, tolerate the race.** `write DB → del key` still has a window (reader loads old value *while* writer commits, then fills the cache post-del). Sub-second staleness is fine for settings; where it isn't fine — permissions checks, entitlements — **don't cache**, or you'll relearn why "there are only two hard things in computer science."

⚖️ And the step-zero nobody skips twice: **before caching a slow query, `EXPLAIN` it.** Epoch 03's index discipline fixes most "we need a cache" moments for free, without buying an invalidation problem. Cache what is *expensive and correct*, not what is *slow and unindexed*.

## 8.6 Distributed rate limiting and the herd

Epoch 04's login limiter and Epoch 07's per-tenant limiter kept counters in process memory — meaningless the moment you run 2+ instances (each instance grants the full budget). Point them at Redis (the `redis` option in `@fastify/rate-limit`): one shared counter, atomic increments, and the per-tenant fairness meter finally means what it says. `429` responses include `retry-after` — well-behaved clients (and your own SDKs) should honor it.

Retries, the other half of the contract — for *your* outbound calls:

```ts
// exponential backoff + full jitter — the industry-standard herd-breaker
for (let attempt = 0; attempt <= max; attempt++) {
  try { return await call(); }
  catch (err) {
    if (!isRetryable(err) || attempt === max) throw err;   // 🛡️ retry 503/timeout, NEVER 400/422
    const cap = Math.min(baseMs * 2 ** attempt, 10_000);
    await sleep(Math.random() * cap);                       // full jitter: decorrelate the herd
  }
}
```

🛡️ **Jitter is not optional.** When a dependency blips, every instance's retry timer expires *in sync* — wave after synchronized wave onto a recovering service (the **thundering herd**; recovering services die of it regularly). Randomizing delay spreads the wave thin. And **only idempotent operations get retried** — retrying a non-idempotent POST that actually committed double-charges someone; Epoch 09 builds the idempotency keys that make retries safe end-to-end. A circuit breaker (stop calling a dependency that's failing; probe occasionally) is the same idea promoted to a state machine — reach for a library when you need it rather than hand-rolling.

## 8.7 Load: find the numbers, then the ceiling

Adjectives ("fast", "scalable") are not engineering. Measure:

```bash
npm install -D autocannon
npx autocannon -c 100 -d 30 -H "cookie: session=..." https://acme.localtest.me:3000/api/tasks
# watch: p50 / p99 latency, req/s, non-2xx count — p99 is where users live, averages lie
```

Load-test findings, in the order they usually appear: missing index (fix: Epoch 03), pool too small or statement cap absent (fix: §8.2), JSON serialization of huge payloads (fix: pagination — which is *also* a correctness feature: unbounded lists grow until they OOM someone), event-loop blocking (fix: move it to Epoch 09's workers). Two built-in probes tell you when the loop itself is the bottleneck: `perf_hooks.monitorEventLoopDelay()` — sustained p99 loop delay above ~100ms means CPU-bound work is living where it shouldn't.

⚖️ **Scaling up vs out:** one Node process uses one core; `cluster`/multiple containers per host use them all. But the real architectural question is *statefulness* — and notice what this course has already done: sessions in Postgres, counters in Redis, tenant context per-request, no process-local state anywhere load-bearing. **The app is horizontally scalable by construction**; "add instances" is now an ops action, not a refactor. (The pool-count arithmetic from Epoch 03 is the one thing to re-check as instance count grows — PgBouncer in transaction mode is the standard relief valve, and §7.3's transaction-scoped design is already compatible with it.)

## 8.8 💥 Break it yourself

1. `docker compose stop db` under load: watch requests fail *fast* (5s connect timeout) instead of piling up; watch `/health/ready` flip to 503 while `/health/live` stays 200. Restart the db; watch recovery with no process restarts.
2. Deploy-simulate: start a long request (`sleep`-ish endpoint), send `SIGTERM`, confirm the response completes and *then* the process exits, and new connections are refused meanwhile.
3. Remove the jitter from the retry helper, point 3 local instances at a flaky stub — watch the synchronized retry waves in the stub's log; restore jitter, watch them smear out.
4. Run autocannon before/after dropping the `(workspace_id, created_at)` index. Numbers, not vibes: this is the index discipline's receipt.

## 8.9 ⚖️ Decision log

| Decision | Alternatives | Why |
|---|---|---|
| Deadlines on every cross-process await | "Timeouts when we see problems" | Slowness accumulates into pool/socket exhaustion; bounded explicit failure beats unbounded implicit hanging |
| Drain-then-exit shutdown, crash on unknown errors | Instant exit; never-die process | Deploys shouldn't drop requests; unknown-state processes shouldn't serve them |
| Liveness ≠ readiness | One `/health` for both | DB blip + conflated checks = platform restarts every healthy instance |
| Cache-aside + TTL + tenant-namespaced keys | Write-through, cache-first, no TTL | Simplest correct model; TTL bounds every missed invalidation; tenancy follows data into every store |
| Backoff + full jitter, idempotent-only retries | Fixed-interval retries | Synchronized retries kill recovering dependencies; unsafe retries duplicate effects |

## 8.10 Checkpoint

1. Defend "a slow dependency is more dangerous than a dead one" using the connection pool as your worked example.
2. Why must readiness — and not liveness — check the database? Narrate the restart storm that conflation causes.
3. A teammate caches permission lookups for 5 minutes to save a query. Which two rules from §8.5 does that collide with, and what's your counter-proposal?
4. Why does jitter specifically help a *recovering* service? What does the load pattern look like with and without it?
5. What property, built silently across Epochs 03–07, made horizontal scaling a non-event in §8.7?

---

*Next: requests should do request-sized work. Everything else — emails, exports, webhooks — moves to queues, with idempotency and the outbox pattern keeping it honest. → [Epoch 09: Async Work](epoch-09-async-work.md)*
