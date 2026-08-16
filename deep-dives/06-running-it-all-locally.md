# Deep Dive 06 — Running It All Locally (and Starting the Business)

> You cannot rent a hundred servers to learn what breaks at scale — but you *can* reproduce almost every failure mode in this course on one laptop. This deep dive is the lab: a local stack that runs the whole architecture (API, workers, Postgres, Redis, tracing, multiple frontends), a catalogue of **experiments that make each scalability problem visible**, and a sequencing plan for building the actual business without drowning in the architecture you just learned.

---

## 1. The insight that makes local learning work

You can't simulate *scale* on a laptop. You don't need to. Every lesson in Epochs 03–11 comes from one of three things, and **all three are reproducible locally**:

| What actually teaches you | Reproduce locally by |
|---|---|
| **Data volume** (the index that stops mattering) | Seeding 10M rows with `generate_series` and reading `EXPLAIN` |
| **Concurrency & contention** (pool exhaustion, lock waits, herds) | Shrinking the limits until you hit them — `max: 2` beats 10,000 users |
| **Failure & latency** (timeouts, retries, degraded deps) | Injecting faults deliberately (Toxiproxy, `docker stop`, kill signals) |

That last row is the point of leverage. Production teaches you these lessons at 3am, once, expensively. A local lab teaches them on demand, repeatably, with a debugger attached. **Shrink the limits instead of growing the load.**

## 2. The local stack

Docker Compose remains the right local control plane in 2026 — faster startup, simpler debugging, no cluster indirection between a code change and a running service, even for teams whose production is Kubernetes ([Compose vs Kubernetes for local dev](https://dev.to/_d7eb1c1703182e3ce1782/docker-compose-vs-kubernetes-when-to-use-each-in-2026-1hji), [Compose vs k3s](https://theartofcto.com/technologies/compare/docker-compose/k3s)).

```mermaid
flowchart TB
    subgraph edge ["Edge (one entry point, like prod)"]
        LB["Caddy/nginx :8080<br/>*.localtest.me → tenants<br/>path prefixes → zones"]
    end
    subgraph front ["Frontends (microfrontend zones)"]
        Z1["shell / app zone"]
        Z2["docs zone"]
    end
    subgraph back ["Backend tier"]
        API1["api #1"]
        API2["api #2 ← two replicas make<br/>distributed problems REAL"]
        WRK["worker (BullMQ + outbox relay)"]
    end
    subgraph data ["Data + fault injection"]
        TP["toxiproxy ← latency/drops on demand"]
        PG[("postgres 17")]
        RD[("redis 7")]
    end
    subgraph obs ["Observability (the part people skip — don't)"]
        COL["otel collector"]
        GRAF["Grafana + Tempo/Loki/Prometheus<br/>(or Jaeger, if you want one container)"]
    end
    subgraph fakes ["Fake third parties"]
        MAIL["Mailpit (SMTP + web UI)"]
        S3["MinIO (S3 API)"]
        HOOK["webhook sink / WireMock"]
    end
    LB --> Z1 & Z2 --> API1 & API2
    API1 & API2 --> TP --> PG
    API1 & API2 --> RD --> WRK --> TP
    WRK --> MAIL & HOOK
    Z1 & Z2 & API1 & API2 & WRK --> COL --> GRAF
```

Reference `compose.yaml` sketch (the course's snapshots already ship the `db`/`redis` half):

```yaml
services:
  db:        { image: postgres:17-alpine, ports: ["5432:5432"], environment: { POSTGRES_USER: trellis, POSTGRES_PASSWORD: trellis, POSTGRES_DB: trellis } }
  redis:     { image: redis:7-alpine, ports: ["6379:6379"] }
  toxiproxy: { image: ghcr.io/shopify/toxiproxy, ports: ["8474:8474", "25432:25432"] }   # 25432 → db, controllable
  jaeger:    { image: jaegertracing/all-in-one, ports: ["16686:16686", "4318:4318"] }
  mailpit:   { image: axllent/mailpit, ports: ["8025:8025", "1025:1025"] }
  minio:     { image: minio/minio, command: server /data --console-address ":9001", ports: ["9000:9000", "9001:9001"] }
  api:       { build: ., environment: { DATABASE_URL: "postgres://trellis:trellis@toxiproxy:25432/trellis", OTEL_EXPORTER_OTLP_ENDPOINT: "http://jaeger:4318" }, deploy: { replicas: 2 } }
  worker:    { build: ., command: ["npm", "run", "worker"] }
  proxy:     { image: caddy:alpine, ports: ["8080:8080"], volumes: ["./Caddyfile:/etc/caddy/Caddyfile"] }
```

Three details that matter more than they look:

- **Two API replicas, always.** Single-instance local dev hides *every* distributed bug: in-memory rate limits that don't share state, cache invalidation races, session assumptions, connection-count arithmetic. Two replicas + one proxy is the cheapest possible production simulator.
- **Postgres reached *through Toxiproxy*.** Costs nothing when idle, and the moment you want to know what a 500ms database is like, it's one API call away (§4).
- **Traces on from day one.** The entire payoff of Epoch 10 and deep-dive 04 is invisible until you can click a waterfall. Jaeger is one container; add it before you think you need it.

**`*.localtest.me` resolves to 127.0.0.1** with zero DNS setup — so `acme.localtest.me:8080` and `globex.localtest.me:8080` exercise the real Epoch 06 tenant-resolution path locally, subdomain and all.

## 3. Seed like production, not like a demo

A three-row database teaches nothing. A seed script that produces *realistic cardinality* is the highest-value hour you'll spend:

```sql
-- 3 tenants with wildly different sizes — the whale/long-tail shape of real SaaS
INSERT INTO tasks (workspace_id, owner_id, title, created_at)
SELECT
  (ARRAY[:acme, :globex, :initech])[1 + (i % 3)],
  :owner,
  'task ' || i,
  now() - (i || ' minutes')::interval
FROM generate_series(1, 5000000) AS i;   -- ~5M rows: laptop-friendly, index-honest
```

Rules that make seeded data useful: **skewed tenant sizes** (one tenant with 90% of rows — that's the noisy-neighbor and query-plan reality), **deterministic randomness** (a fixed seed so a bug reproduces tomorrow), and **realistic distributions** (most workspaces tiny, a few enormous; timestamps spread over months, not all `now()`).

## 4. The experiment catalogue

This is the lab manual — each experiment maps to an epoch, takes minutes, and converts a paragraph you read into something you've *seen*.

### Multitenancy & isolation (Epochs 06–07)
- **The leak that isn't.** Add a deliberately unscoped `SELECT * FROM tasks` route; call it as Acme with two seeded tenants. Watch RLS return only Acme's rows. Then `DROP POLICY` and re-run: the same code leaks everything. One command, and enforcement-by-construction stops being abstract.
- **The pooled-connection leak.** Change `set_config(..., true)` to `false` (session-scoped) in `withTenantDb`, run concurrent requests from two tenants against a `max: 2` pool, and watch a request get *the previous tenant's* stamp. This is the single most instructive five minutes in the whole course.
- **The meta-test.** Add a new `workspace_id` table without RLS and run the suite — CI fails by default. Deny-by-default, demonstrated.

### Performance & the database (Epochs 03, 08)
- **Index archaeology.** `EXPLAIN ANALYZE` the tenant task list at 5M rows, drop `(workspace_id, created_at)`, re-run. Seq scan + sort vs index scan — with real millisecond numbers on your own machine.
- **Pool exhaustion.** Set `max: 2`, add a `pg_sleep(5)` endpoint, fire 10 concurrent requests: watch `connectionTimeoutMillis` fire and — crucially — watch *unrelated* endpoints fail too. "A slow dependency is more dangerous than a dead one," observed.
- **Statement timeout as insurance.** Repeat with `statement_timeout=1s` and see damage become bounded.
- **Noisy neighbor.** `autocannon` Globex at full tilt while curling Acme; watch Acme's p99 degrade. Turn on the per-tenant rate limiter; watch it recover. That's Epoch 07 §7.7 as a before/after graph.

### Reliability & failure (Epoch 08)
- **Latency injection.** Add 500ms to the Postgres proxy via Toxiproxy's API and watch timeouts, traces, and readiness react — surgical, per-connection fault injection is exactly what it's built for ([Toxiproxy for chaos with Docker](https://oneuptime.com/blog/post/2026-02-08-how-to-use-docker-for-chaos-engineering-with-toxiproxy/view), [network chaos with Toxiproxy](https://medium.com/cloudbulletin/chaos-in-the-network-using-toxiproxy-for-network-chaos-engineering-13fb0ae2deea)).
- **Kill the database.** `docker compose stop db`: `/health/live` stays 200, `/health/ready` flips 503, requests fail fast. Restart; watch recovery without a process restart.
- **The deploy drill.** Start a long request, `docker compose kill -s SIGTERM api`, confirm the response completes and the process exits 0 — then do it with the drain logic removed and watch the dropped request.
- **Thundering herd.** Point both API replicas at a flaky stub; remove jitter from `withRetry`; watch synchronized retry waves in the stub's log; restore jitter; watch them smear.

### Async work (Epoch 09)
- **The crash window.** Kill the API between commit and enqueue in a non-outbox version → orphaned membership, no email, no error. Repeat with the outbox → the relay heals it.
- **Double delivery.** Throw in the handler *after* the effect; watch the retry double-send; add the idempotency key; watch it not.
- **The DLQ.** Ship a poison job, watch five backoffs, inspect the failed set, "fix" the handler, re-drive.

### Observability (Epoch 10, deep-dive 04)
- **Find the bug by trace alone.** Have a colleague (or your past self) insert a `sleep(1500)` somewhere; find it in the Jaeger waterfall without reading code. Time yourself.
- **The redaction near-miss.** Log a whole `req` object with redaction off, look at the cookie header, turn it back on.
- **Cross-boundary continuity.** Trigger the invite flow and confirm one trace spans browser → API → outbox → worker via the propagated context.

### Microfrontends (deep-dives 02–04)
- **Zone failure.** Stop the docs zone; confirm the shell degrades (error boundary) rather than white-screening.
- **The deleted-chunk trap.** Load the app, deploy a zone with pruned old assets, then navigate in the *already-open* tab → `ChunkLoadError`. Now keep old assets and repeat.
- **Version skew.** Run two API versions behind the proxy with an old frontend bundle; break a field name and watch which contract actually protects you.

## 5. When to graduate past Compose

```mermaid
flowchart TD
    A["Docker Compose<br/>(default: fastest inner loop)"] -->|"prod IS Kubernetes and<br/>you need to test manifests"| B["kind / k3d locally<br/>+ Tilt or Skaffold for live reload"]
    A -->|"stack too heavy for a laptop,<br/>or you need real cloud services"| C["ephemeral preview environments<br/>(per-PR, from IaC — deep-dive 05)"]
    B -.- B1["cost: startup time, RAM,<br/>a layer of indirection"]
    C -.- C1["cost: infra work + cloud spend<br/>payoff: review on real infra"]
```

k3d/kind boot a real cluster in seconds and Tilt gives fast rebuilds and dependency-aware inner-loop workflows ([choosing a local dev cluster](https://docs.tilt.dev/choosing_clusters.html), [Tilt for microservice inner loop](https://medium.com/@kiana.proudmoore/streamlining-kubernetes-development-with-tilt-solving-the-pain-of-microservices-workflows-767dc120e151)) — but only take that on when your production really is Kubernetes and manifests need local validation. Otherwise the indirection costs you the thing local dev is *for*: the shortest possible edit→observe loop.

## 6. Starting the actual business without building all of this

The most expensive mistake available to you right now is building Epoch 12's architecture for a product with zero customers. The course is a **map of destinations, not an itinerary.** Here's the itinerary:

### Ship at Epoch 03's level. With one exception.

An MVP needs: Fastify + schemas (02), Postgres + migrations + repositories (03), sessions (04), and deploys (11, in its simplest managed-platform form). That's it. Skip RLS, queues, OTel, zones, IaC.

🛡️ **The one exception — the cheapest insurance in this entire course: put `workspace_id` on every tenant-owned table from the very first migration, and route every query through the repository seam.** It costs one column and one function parameter *today*; retrofitting tenancy into a single-tenant schema with live customers is a multi-month project that touches every query, every index, every cache key. Design multi-tenant, *enforce* later.

### Then let the signals decide

Each investment gets bought by a specific, observable event — never by anticipation:

| Signal you actually observe | What you build next | Epoch |
|---|---|---|
| Second paying customer | memberships + tenant resolution | 06 |
| Team hits 3–4 engineers, or a scary refactor | strict TS + real tests + CI gates | 05, 11 |
| A support ticket that says "I saw someone else's data" *or* an enterprise security review | **RLS + hostile isolation tests** (do this before the ticket, if you can) | 07 |
| "The email never arrived" / a request taking >2s on someone else's API | queues + outbox + idempotency | 09 |
| First 3am page you can't diagnose in 20 minutes | structured logs + traces + per-tenant RED | 10 |
| A tenant's runaway integration degrades everyone | per-tenant rate limits + caching | 07, 08 |
| First enterprise lead says "Okta" | SSO (buy it) + SCIM | deep-dive 01 |
| Second team wants to deploy without coordinating | zones / microfrontends | deep-dives 02–03 |
| Second environment, or compliance asks "who changed that?" | IaC, plan-on-PR | deep-dive 05 |

### A concrete first quarter

- **Week 1** — Compose (db + redis), epoch-03-shaped API with `workspace_id` everywhere, one deployed environment on a managed platform, one real user flow end to end.
- **Weeks 2–4** — sessions + memberships (04, 06), the seed script (§3), the two-replica local stack, CI running typecheck + tests.
- **Month 2** — RLS + the hostile isolation suite (07) *before* the first enterprise conversation; graceful shutdown + health checks + timeouts (08) the first time a deploy drops a request.
- **Month 3** — traces and per-tenant RED (10) the first time triage takes an afternoon; queues + outbox (09) the first time a slow third party is in the request path.
- **Continuously** — run one experiment from §4 per week against your real system. That's how the architecture stays understood rather than merely deployed.

The pattern is the course's own thesis, applied to your calendar: **nothing appears before its pain does** — with exactly one exception, `workspace_id`, because that pain arrives too late to fix cheaply.

## Sources

- [Docker Compose vs Kubernetes: when to use each in 2026](https://dev.to/_d7eb1c1703182e3ce1782/docker-compose-vs-kubernetes-when-to-use-each-in-2026-1hji) · [Docker Compose vs K3s (2026)](https://theartofcto.com/technologies/compare/docker-compose/k3s) · [Kubernetes vs Docker Compose: when to use which](https://codingprotocols.com/blog/kubernetes-vs-docker-compose)
- [Tilt: choosing a local dev cluster](https://docs.tilt.dev/choosing_clusters.html) · [Tilt for microservices inner loop](https://medium.com/@kiana.proudmoore/streamlining-kubernetes-development-with-tilt-solving-the-pain-of-microservices-workflows-767dc120e151) · [Kubernetes dev environments for large teams](https://blog.ugurelveren.com/post/best-kubernetes-development-environment-for-large-teams/)
- [Docker + Toxiproxy for chaos engineering](https://oneuptime.com/blog/post/2026-02-08-how-to-use-docker-for-chaos-engineering-with-toxiproxy/view) · [Network chaos with Toxiproxy](https://medium.com/cloudbulletin/chaos-in-the-network-using-toxiproxy-for-network-chaos-engineering-13fb0ae2deea) · [Fault injection testing explained (2026)](https://totalshiftleft.ai/blog/fault-injection-testing-explained)
