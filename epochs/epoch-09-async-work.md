# Epoch 09 — Async Work

> **You arrive with:** request handlers quietly doing too much — sending email, building exports, calling third parties — inside the request/response window.
> **You leave with:** a worker tier on BullMQ, jobs that survive crashes and retries (idempotency), events that can't be lost (the outbox pattern), signed webhooks, and dead-letter queues for the jobs that never make it.

---

## 9.1 The pain

"Invite a teammate" currently: insert membership → call the email API → respond. Three ways this bites, all inevitable:

1. **Latency coupling** — the user waits 2s because the email provider is slow. The email is not *their* job to wait for.
2. **Failure coupling** — email API down ⇒ invitation fails?! The membership insert worked; the 500 is a lie about someone else's outage.
3. **The crash window** — membership committed, process dies (deploy! Epoch 08 normalized this), email never sent. No error, no retry, no record: the invitee just never hears. This silent third case is the one that motivates real machinery.

The cure is old and good: **the request records intent; a worker executes it.** The rule of thumb: a request handler may do request-sized work — validate, write, respond. Anything slower than ~100ms of *someone else's* time (email, PDFs, third-party APIs, tenant exports from Epoch 07) belongs in a queue.

## 9.2 The queue and the worker tier

⚖️ *Postgres-as-queue (`SELECT … FOR UPDATE SKIP LOCKED`) is legitimate* — fewer moving parts, transactional with your data — and fine at modest scale. We adopt **BullMQ on the Redis we already run**: mature retry/backoff/DLQ semantics out of the box, and the concepts (visibility, acking, poison messages) transfer to SQS/RabbitMQ/Kafka wholesale.

```ts
// src/jobs/queues.ts
import { Queue } from "bullmq";
export const emailQueue = new Queue("email", { connection: redis });

// enqueue from the request path — milliseconds, local, reliable-ish (see §9.4 for "ish")
await emailQueue.add("invite", {
  tenantId: tenant.id,            // ← context travels IN THE PAYLOAD
  membershipId: m.id,
}, {
  attempts: 5,
  backoff: { type: "exponential", delay: 2_000 },  // Epoch 08's backoff, built in
});
```

```ts
// src/jobs/worker.ts — a SEPARATE PROCESS, not the API
import { Worker } from "bullmq";

const worker = new Worker("email", async (job) => {
  const ctx = await rebuildContext(job.data.tenantId);      // 🛡️ re-enter tenant context explicitly
  await runWithContext(ctx, () => handlers[job.name](job.data));
}, { connection: redis, concurrency: 10 });

// Epoch 08's graceful shutdown, worker flavor: stop claiming, finish current, exit
process.on("SIGTERM", async () => { await worker.close(); process.exit(0); });
```

Two structural points:

- **Workers are a separate deployment.** They scale on queue depth (not HTTP traffic), their crashes don't take the API down, and CPU-heavy jobs (that PDF export) stop threatening the API's event loop — Epoch 00's oldest lesson, finally fully resolved.
- 🛡️ **`AsyncLocalStorage` does not cross the queue.** ALS rides the *in-process* async chain; a job runs hours later in another process. Tenant identity must travel in the payload and be *re-established* (and re-validated — the tenant may have been suspended since enqueue!) at the top of every job. Forgetting this produces the worker-flavored cross-tenant bug, and Epoch 07's RLS still backstops it **only if** the worker also wraps its DB work in `withTenantDb`. Same laws, new tier.

## 9.3 Idempotency: the price of retries

Queues guarantee **at-least-once** delivery, never exactly-once — a worker can crash *after* doing the work but *before* acknowledging the job, and the job runs again. (Exactly-once delivery across processes is famously impossible; exactly-once *effect* is your job.) So the iron law: 🛡️ **every job handler must be safe to run twice.**

Mechanisms, cheapest first:

```ts
// 1. Natural idempotency — state-setting, not state-changing
//    ❌ "increment counter"        ✅ "set status = 'sent'"
//    ❌ "append row"               ✅ "upsert row keyed by (invite_id)"

// 2. Idempotency keys — for side effects you can't upsert (external APIs)
const already = await db.insert(processedJobs)
  .values({ key: `invite-email:${membershipId}` })
  .onConflictDoNothing().returning();
if (already.length === 0) return;      // this exact effect already happened — ack and move on
await emailApi.send(...);
```

That second pattern — *record the effect's unique key transactionally, act only if the record is new* — is the workhorse. It also plugs into the request side: accept an `Idempotency-Key` header on your own POST endpoints and your API becomes safely retryable by clients, closing the loop Epoch 08 opened ("only idempotent operations get retried").

## 9.4 The outbox pattern: closing the last crash window

The subtle flaw left in §9.2's enqueue: **database commit and queue add are two systems, no shared transaction.** Commit-then-crash-before-add ⇒ membership exists, email job never enqueued — the original silent failure, shrunk but alive. (Enqueue-then-commit inverts it: email for a membership that rolled back.)

The fix is to make "intent to enqueue" part of the transaction itself:

```ts
// 1. ONE atomic transaction: the business write AND the event, same commit
await withTenantDb(async (db) => {
  const m = await memberships.create(db, {...});
  await db.insert(outbox).values({
    kind: "invite.created",
    payload: { tenantId, membershipId: m.id },
  });                                    // outbox table has RLS too, naturally
});

// 2. A relay loop (or worker) polls the outbox and moves events to the real queue
//    marking each row published — itself idempotent (keyed by outbox row id)
```

Now the two outcomes are the only outcomes: *both* the membership and its event exist, or *neither* does. The relay might publish twice (crash between publish and mark) — and §9.3 already made consumers immune to that. The patterns compose: **outbox gives at-least-once out of your transaction; idempotency makes at-least-once equal exactly-once-in-effect.** This pair is the backbone of every reliable event-driven system you'll meet; you now own both halves.

⚖️ Don't cargo-cult it, though: the outbox costs a table, a relay, and operational attention. Use it where a lost event is *unacceptable* (billing events, provisioning, anything contractual); plain enqueue is honest enough for a lost "weekly digest" email.

## 9.5 Webhooks: being the third party

Tenants will want events pushed to *their* systems ("notify our Slack when a task completes"). You're now the flaky third party someone else fears. Being a good one:

```ts
// signing: tenants must be able to verify it's really you
const signature = createHmac("sha256", tenantEndpoint.secret)
  .update(`${timestamp}.${body}`).digest("hex");
// send as: X-Trellis-Signature: t=<ts>,v1=<sig>
// timestamp in the signed material → replay attacks expire (verifier rejects |now - t| > 5min)
```

- **Deliveries are jobs** — the full §9.2–9.3 machinery: retries with backoff, per-endpoint, idempotent on your side; consumers deduplicate via the event id you include.
- 🛡️ **Never call tenant URLs from the request path** — a tenant's 90-second-hang endpoint must burn a worker slot, not an API request (Epoch 08's slow-dependency law, applied to URLs *your customers* control). Timeout each delivery (5s), cap retries, and **disable endpoints that fail for days** — with a UI showing delivery status, because "is the webhook working" is otherwise a support ticket generator.
- 🛡️ **SSRF check:** tenant-supplied URLs can point at `169.254.169.254`, `localhost:6379`, or your VPC's internals. Resolve and reject private/link-local ranges before fetching. Tenant-controlled URLs are user input aimed at your *network*.

## 9.6 Scheduled work and the missing-heartbeat alarm

BullMQ's repeatable jobs cover cron duties (session sweeping from Epoch 04, outbox relay, Epoch 07's purge grace-periods, weekly digests):

```ts
await maintenanceQueue.add("purge-expired-sessions", {}, { repeat: { pattern: "0 4 * * *" } });
```

Two guardrails that separate toy cron from production cron:

- 🛡️ **Multi-instance safety.** With N workers, does the job fire N times? BullMQ's repeatables dedupe via Redis; if you ever hand-roll scheduling, you need a distributed lock — and per §9.3, the job body should be idempotent *anyway*, because locks have edge cases too. Idempotency is the moat; dedup is the wall.
- 🛡️ **Alert on absence.** A crashed scheduler produces no errors — nothing runs, nothing logs, nothing pages. Silent absence is worse than loud failure. The pattern: each run records a heartbeat; a monitor alerts when the heartbeat is *stale* ("dead man's switch"). Epoch 10 gives us the metrics to build it.

## 9.7 When jobs keep failing: the dead-letter queue

Retries handle transient failure; some jobs are just *broken* — a payload that hits a bug, a deleted tenant, a poisoned message. Without a policy, a poison job retries forever, soaking up worker capacity and log volume. With `attempts: 5` exhausted, BullMQ parks the job in the **failed set** — your dead-letter queue. The DLQ contract:

- **Monitor its depth** (Epoch 10 metric); a growing DLQ is a quiet outage — some feature is silently not happening for some tenants.
- **Keep payloads inspectable** (they're tenant data — the DLQ is on Epoch 07's purge inventory, of course).
- **Re-drive after fixing the bug** — replay is a routine op, not archaeology; §9.3 made replays safe.

💥 **Break it yourself.** (1) Throw in the invite handler after `emailApi.send` succeeds; watch the retry double-send, add the idempotency key, watch it not. (2) `kill -9` the API between commit and (non-outbox) enqueue; observe the orphaned membership; repeat with the outbox and observe the relay heal it. (3) Enqueue a job whose handler always throws; watch it march through 5 backoffs into the failed set; re-drive it after "fixing" the handler.

## 9.8 ⚖️ Decision log

| Decision | Alternatives | Why |
|---|---|---|
| BullMQ on existing Redis | Postgres `SKIP LOCKED` queue, SQS/RabbitMQ | Mature retry/DLQ semantics with zero new infrastructure; pg-queue is the right call for smaller systems — the *concepts* are identical |
| Workers as a separate deployment | In-process background tasks | Independent scaling & failure domains; CPU work leaves the API's event loop for good |
| Tenant identity in payload + re-validated + `withTenantDb` in workers | Assume context somehow | ALS dies at the process boundary; suspended tenants must not have jobs act for them; RLS must cover the worker tier too |
| Idempotency keys + outbox for critical flows | "Retries rarely double-run", enqueue-after-commit everywhere | At-least-once is a law, not a bug; outbox+idempotency = exactly-once *in effect*, the only kind that exists |
| Signed, timestamped, SSRF-checked webhooks | Bare POSTs to tenant URLs | You are now someone's untrusted third party; act like the good ones |

## 9.9 Checkpoint

1. Narrate the three-line crash window the outbox closes, and why "enqueue inside the DB transaction" is a category error rather than a fix.
2. Prove "exactly-once delivery" can't be promised by walking the crash-after-work-before-ack case; then show where exactly-once *effect* comes from.
3. Why must a worker re-validate the tenant (not just trust the payload's tenantId) before acting? Give the suspension scenario.
4. Your DLQ has 400 jobs from one tenant. What do you check, in what order, and what makes re-driving safe?
5. Which Epoch 08 rule makes "call the tenant's webhook URL synchronously in the request" indefensible even at tiny scale?

---

*Next: the system now does many things in many processes — and when something's wrong, you need to see it. Structured logs, traces, metrics, and alerts that page on symptoms, not superstition. → [Epoch 10: Observability](epoch-10-observability.md)*
