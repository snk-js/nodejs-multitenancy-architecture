# Epoch 10 — Observability

> **You arrive with:** a distributed system (API × N, workers, Postgres, Redis) and `console.log` archaeology when it misbehaves.
> **You leave with:** structured logs correlated by request and tenant, OpenTelemetry traces that show *where* the time went, RED metrics, alerts that page on symptoms — and the ability to answer "is it slow for everyone, or just for Acme?" in one query.

---

## 10.1 The pain

A tenant writes in: *"Trellis was slow yesterday around 3pm."* With today's tooling, your investigation is: grep gigabytes of interleaved `console.log` lines across two services and N instances, with no way to tell which lines belong to the same request, which requests belong to Acme, or whether "slow" was the database, the pool, Redis, or the event loop. Every question costs an hour and yields a shrug.

Observability is the discipline of **making the system answer questions about itself** — including questions you didn't anticipate. Three pillars, three different questions:

| Pillar | Question it answers | Granularity |
|---|---|---|
| **Logs** | *What happened, exactly?* | Discrete events, full detail |
| **Traces** | *Where did the time go?* | One request's journey across services |
| **Metrics** | *How is the system trending?* | Cheap aggregates over everything |

## 10.2 Structured logs: events, not prose

Fastify's built-in pino (chosen with foreknowledge in Epoch 02) emits JSON. The upgrade is what we *put in* every line — and here two courses of plumbing pay off at once. `AsyncLocalStorage` already carries request id, user, and tenant; a pino mixin stamps them on **every log line from anywhere in the stack, automatically**:

```ts
// src/logging.ts
import pino from "pino";
import { tryGetContext } from "./context.ts";   // non-throwing sibling of getContext

export const logger = pino({
  level: config.logLevel,
  mixin() {
    const ctx = tryGetContext();
    return ctx ? { reqId: ctx.requestId, tenantId: ctx.tenant?.id, userId: ctx.userId } : {};
  },
  redact: {
    paths: ["req.headers.cookie", "req.headers.authorization", "*.password", "*.token", "*.email"],
    censor: "[redacted]",
  },
});
```

```json
{"level":30,"time":"...","reqId":"01J...","tenantId":"9f2...","msg":"task created","taskId":"7ab..."}
```

Now `tenantId=9f2...` filters the *entire system's* output down to Acme's story, and `reqId=01J...` down to one request's story across API and (because job payloads carry the originating request id — one line of code in the enqueue helper) the worker tier too.

The rules that keep logs useful at 4am:

- 🛡️ **Log events with fields, never interpolated prose.** `log.info({ taskId }, "task created")` is queryable (`WHERE taskId = …`); `log.info(\`created task ${id}\`)` is grep-and-pray. Prose is for the `msg`; facts go in fields.
- 🛡️ **Redaction is configured centrally, at the logger** — because the day someone logs the whole `req` object (someone will), the cookie header contains session tokens, i.e. **credentials in log storage**, which outlives the request by your retention period and is readable by everyone with log access. The redact list is the guardrail that doesn't rely on per-callsite vigilance — recognize the deny-by-default shape yet again. PII (emails!) is redacted too: logs are on Epoch 07's purge inventory otherwise, and log stores are terrible at surgical deletion.
- **Levels are policy:** `error` = a human should look; `warn` = degraded but handled (retry succeeded, breaker opened); `info` = business events at low volume; `debug` = off in prod, on by config. An `error` level that pages nobody and a log stream that's 90% noise are the same disease: signal destroyed by crying wolf.

## 10.3 Traces: the request's journey, visualized

Logs tell you what happened; traces tell you **where the 1,900ms went**. OpenTelemetry — the vendor-neutral standard — auto-instruments the stack we chose (Node http, Fastify, pg, ioredis) via one bootstrap file loaded before anything else (`node --import ./src/otel.ts …`):

```ts
// src/otel.ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

const sdk = new NodeSDK({
  serviceName: "trellis-api",
  instrumentations: [getNodeAutoInstrumentations()],
  // exports OTLP to any backend: Jaeger/Tempo/Honeycomb/Datadog — the code doesn't care
});
sdk.start();
```

A trace for "invite a teammate" now renders as a waterfall:

```
POST /api/invites ......................................... 1,910ms
├── preHandler auth (session SELECT) ......... 4ms
├── preHandler tenant (membership SELECT) .... 3ms
├── INSERT memberships ....................... 6ms
├── INSERT outbox ............................ 2ms
└── pg COMMIT ............................ 1,890ms   ← THERE. (checkpoint stall? lock? io?)
```

That `COMMIT` span converts "Trellis was slow" into a *specific* database question in one glance — the class of insight logs structurally cannot give, because no single log line *contains* the shape of the request. Two practices complete the picture:

- **Context propagation:** OTel passes `traceparent` headers on outbound HTTP automatically; for the queue, we put trace context into job payloads (same slot as `reqId`) so a worker's spans attach to the originating request's trace. The full story — request → outbox → relay → worker → email API — is one trace.
- **Sampling:** tracing everything at scale is expensive; head sampling (e.g. 10%) plus "always sample errors and slow requests" (tail-based, backend-dependent) keeps cost sane while keeping the interesting traces. Metrics (next) are the always-on layer; traces are the deep-dive layer.

## 10.4 Metrics and the RED method

Metrics are pre-aggregated numbers, cheap enough to record for *every* request forever. For a request-driven service, the **RED method** is the complete starter kit — per route *and* per tenant:

- **R**ate — requests/sec
- **E**rrors — failure rate
- **D**uration — latency *histogram* (yielding p50/p95/p99 — 🛡️ never alert on averages; the mean of [5ms…5000ms] is a comfortable lie. p99 is where the pain lives).

Plus the platform gauges that explain *why* REDs go bad: event-loop delay (Epoch 08's probe, now exported), pg pool utilization (`totalCount/idleCount/waitingCount` — the leak from Epoch 03 becomes a visible ramp instead of a mystery outage), queue depth and job age, DLQ depth (Epoch 09's contract), cache hit ratio.

The multi-tenant twist that makes the `tenantId` label priceless: **aggregate dashboards hide single-tenant pain.** Global p99 can look flawless while Acme — 1% of traffic, 30% of revenue — suffers a 100% error rate on their integration. Per-tenant RED answers "everyone, or just Acme?" *first*, because the two answers have disjoint runbooks (systemic → look at infrastructure; single-tenant → look at their data shape, their usage pattern, their noisy-neighbor status from Epoch 07). ⚖️ Mind label cardinality: per-tenant labels on a 50,000-tenant system explode storage — top-N tenants labeled individually + `other` is the standard compromise.

## 10.5 Alerts: symptoms, not causes — and budgets, not vibes

- 🛡️ **Page on symptoms** (user-visible: error rate, p99, DLQ growth, staleness of the Epoch-09 heartbeat), **dashboard the causes** (CPU, pool, memory). Cause-based paging is how you get "CPU 80%" at 3am for a system serving every request perfectly — and after five of those, humans stop reading pages at all. Alert fatigue isn't an annoyance; it's the standard prelude to sleeping through a real one.
- **SLOs make "reliable enough" a number.** Pick targets from product reality (e.g. 99.9% of requests succeed in <500ms, monthly). The complement is the **error budget** (0.1% ≈ 43 min/month): burn it fast → page and stop shipping; barely touch it → you can afford more release velocity. SLOs turn the eternal "move fast vs. stay up" argument into arithmetic both sides can read.
- Two audiences, two artifacts: the on-call dashboard (REDs, saturation, queue health — is it broken *now*?) and the tenant-health view (per-tenant REDs, usage — feeds support *and* the account team; observability quietly becomes a product feature).

## 10.6 💥 Break it yourself

1. Log a fake `req` object with a cookie header; confirm `[redacted]` in output. Then remove the redact rule and look at what you almost shipped to log storage.
2. Add `await sleep(1500)` inside the invite flow's repository call; find it by *trace waterfall alone*, no code reading. Time yourself — this is the drill that sells tracing.
3. Grep-race yourself: answer "what did request X touch?" once via `reqId` filter, once via raw grep across two service logs. 
4. Set a p99 alert at 500ms, autocannon a heavy endpoint (Epoch 08), watch it fire; confirm the *average*-based version of the same alert stays green. The lie, demonstrated.

## 10.7 ⚖️ Decision log

| Decision | Alternatives | Why |
|---|---|---|
| pino JSON + ALS mixin + central redaction | Prose logs, per-callsite discipline | Queryable events; correlation for free from Epoch 06's plumbing; redaction that survives careless callsites |
| OpenTelemetry, auto-instrumented, OTLP export | Vendor SDK lock-in, hand-rolled timing | The standard; our stack is covered; backends swappable without touching code |
| RED per route + per tenant (top-N) | Global-only metrics | "Everyone or just Acme?" is the first triage question in multi-tenant ops; cardinality bounded deliberately |
| Symptom-based paging + SLO/error budget | Cause-based alerts on host metrics | Pages that map to user pain; a shared number that prices release risk |

## 10.8 Checkpoint

1. Assign each pillar the question it alone answers, and give a concrete Trellis failure where the *other two* would leave you stuck.
2. Why must redaction live in the logger config rather than in code review? Which earlier deny-by-default guardrails share this shape? (There are at least three by now.)
3. Global p99 is 80ms; Acme is on the phone, angry. Which dashboard do you open, what do you expect to see, and which two runbooks does the answer choose between?
4. Your on-call gets "CPU > 80%" pages nightly and error-rate pages never. Predict, mechanically, what happens over the next month — then fix the policy.

---

*Next: it runs, it's correct, it's observable — now it has to ship, repeatedly and boringly: containers, CI gates, zero-downtime migrations, and the security hardening pass. → [Epoch 11: Shipping](epoch-11-shipping.md)*
