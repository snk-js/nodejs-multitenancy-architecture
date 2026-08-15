# Epoch 07 — Multitenancy II: Enforcement

> **You arrive with:** tenant isolation that holds as long as every engineer remembers a `WHERE` clause.
> **You leave with:** isolation the database enforces — PostgreSQL Row-Level Security wired through a tenant-scoped transaction helper — plus hostile tests, tenant lifecycle handling, and per-tenant fairness. Forgetting the `WHERE` clause now returns zero rows instead of another company's data.

---

## 7.1 The pain, made concrete

Fast-forward eighteen months. A new teammate ships a search endpoint:

```ts
// innocent, reviewed, tested against their own workspace, WRONG
db.select().from(tasks).where(ilike(tasks.title, `%${q}%`));
```

No `workspaceId` predicate. It works perfectly in every manual test (the dev only *has* one workspace) and leaks every tenant's tasks in production. Code review missed it because humans miss things; that's not a process failure, it's a process *property*. The fix is categorical: **move enforcement to a layer that cannot be forgotten.**

This is **defense in depth** — the same reason banks have both vault doors *and* alarms. Our layers, after this epoch:

```
1. Scoped repositories (Ep. 06)   → correctness by convention   (can be forgotten)
2. Postgres Row-Level Security    → correctness by construction (cannot be bypassed by app code)
3. Hostile cross-tenant tests     → proof both layers hold, forever, in CI
```

## 7.2 How Row-Level Security works

RLS attaches a **policy** — a boolean expression — to a table. Once enabled, *every* query against that table is implicitly filtered: rows failing the expression are invisible to `SELECT`/`UPDATE`/`DELETE` and rejected on `INSERT`. The policy needs to know "the current tenant," which we supply per-transaction via a session setting:

```sql
-- migrations/...._enable-rls.sql  (raw SQL migration — this is why we kept the escape hatch)

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;   -- applies even to the table owner

CREATE POLICY tenant_isolation ON tasks
  USING       (workspace_id = current_setting('app.tenant_id')::uuid)   -- read/update/delete visibility
  WITH CHECK  (workspace_id = current_setting('app.tenant_id')::uuid);  -- insert/update legality

-- repeat for every tenant-owned table (memberships, projects, …)
```

- `USING` filters what exists; `WITH CHECK` vetoes what you may write. With only `USING`, a buggy insert could *create* rows in another tenant (write-side leaks are still leaks).
- `current_setting('app.tenant_id')` reads a per-connection variable we'll set with `SET LOCAL` — scoped to the current transaction, which is exactly the granularity we want under connection pooling (more in §7.4).

🛡️ **The privilege split that makes RLS real.** RLS does not constrain superusers or roles with `BYPASSRLS`. So the application must not connect as the database owner:

```sql
CREATE ROLE trellis_app LOGIN PASSWORD '...';                  -- NOT superuser, NOT owner
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO trellis_app;
```

Two connection strings, two jobs: **migrations** run as the owner (DDL rights, bypasses nothing that matters — it's schema work); **the app** runs as `trellis_app`, fully subject to policies. One `DATABASE_URL` for each in config. This split is also just least-privilege hygiene: the app credential physically cannot `DROP TABLE`.

🛡️ And the failure mode is the *safe* direction: if `app.tenant_id` was never set, `current_setting` errors (or, with a `missing_ok` default pattern, matches nothing) — **queries without tenant context return zero rows instead of all rows.** Compare that to convention's failure mode. That inversion is the entire epoch.

## 7.3 The tenant-scoped transaction helper

One primitive delivers the whole model to application code — Epoch 03's `withTransaction`, grown tenant-aware:

```ts
// src/db/tenant-db.ts
import { pool } from "./pool.ts";
import { getContext } from "../context.ts";

export async function withTenantDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const { tenant } = getContext();               // throws if absent — loud, remember
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // set_config with 'true' → SET LOCAL semantics: dies with the transaction
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.id]);
    const result = await fn(drizzle(client));    // repositories run inside, unchanged
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

Layers of intent packed in here:

- **Parameterized `set_config`, not `SET LOCAL app.tenant_id = '${id}'`.** `SET` doesn't take bind parameters; interpolating would reopen Epoch 03's injection door at the most security-critical line in the codebase. `set_config()` is an ordinary function — parameterizable.
- **`SET LOCAL` semantics (the `true` flag) is mandatory under pooling.** A plain `SET` outlives the transaction: the connection returns to the pool still stamped with tenant A, and the next borrower — tenant B's request — inherits it. That bug is Acme-reads-Globex with extra steps. Transaction-local scope makes the stamp die at COMMIT/ROLLBACK, no cleanup code to forget. (This is also why a transaction-mode server-side pooler stays compatible: everything rides inside one transaction.)
- **Repositories didn't change.** They accept a `db`; this hands them one whose every query is policy-checked. Three epochs of "repositories take `db` as a parameter" was building exactly this moment.

Routes now read:

```ts
app.get("/tasks", { schema }, async () =>
  withTenantDb((db) => makeTaskRepository(db).list())
);
```

⚖️ *Cost check:* RLS adds a predicate evaluation per row — with `(workspace_id, …)` leading every index (Epoch 06 law), the plan is the same index scan the explicit `WHERE` produced; overhead in practice is small single-digit percent. We keep the explicit predicates in repositories too — belt (fast, self-documenting) and suspenders (unforgeable).

## 7.4 💥 Break it yourself — the leak that isn't

Re-introduce the villain from §7.1 in a scratch route: a query with **no workspace filter**, run through `withTenantDb`. Seed two workspaces, call it as Acme:

```
Result: only Acme's rows. The forgotten WHERE clause now costs correctness of
scope, not confidentiality. Globex's rows were never candidates — the policy
filtered them inside Postgres, before the wire.
```

Then try the write side: hand-craft an insert with `workspaceId: <globex-id>` while stamped as Acme → the `WITH CHECK` violation rejects it. Both directions sealed. And run the third experiment: call the repository *outside* `withTenantDb` (raw pool) → `getContext()` throws or `current_setting` yields nothing → zero rows. All three failure paths land safe.

## 7.5 The hostile test suite

Epoch 06's spec tests still pass; now make them adversarial and permanent. These are the most important tests in the codebase — treat them accordingly:

```ts
// test/tenant-isolation.test.ts
test("RLS: raw query with no tenant predicate stays scoped", async () => {
  await seedTask("globex", "globex secret");
  const rows = await withTenantAs("acme", (db) =>
    db.execute(sql`SELECT * FROM tasks`)        // deliberately unscoped, deliberately raw
  );
  assert.equal(rows.length, acmeTaskCount);
  assert.ok(rows.every((r) => r.workspace_id === ACME_ID));
});

test("RLS: cross-tenant insert is rejected", async () => {
  await assert.rejects(
    withTenantAs("acme", (db) =>
      db.insert(tasks).values({ workspaceId: GLOBEX_ID, ownerId: acmeUser, title: "smuggle" })
    ),
    /row-level security/
  );
});

test("every tenant-owned table has RLS enabled and forced", async () => {
  // meta-test: query pg_class for relrowsecurity/relforcerowsecurity on an
  // allowlist-of-exceptions basis — a NEW table without RLS fails CI by default.
  const unprotected = await findTenantTablesWithoutRls();
  assert.deepEqual(unprotected, []);
});
```

That third test is the deepest guardrail in the course: it turns "did the new feature's migration remember RLS?" from a review-time hope into a red build. 🛡️ **Deny-by-default applied to schema evolution** — the same shape as Epoch 04's auth hook, one level down the stack.

## 7.6 Tenant lifecycle: enter, live, leave

Isolation is the headline, but tenancy has a lifecycle, and each stage has a classic bug:

- **Provisioning** — workspace + owner membership + defaults are created in **one transaction**. A workspace without an owner (crash between inserts) is an unadministrable orphan; atomicity is the fix (Epoch 03, again).
- **Suspension** (non-payment, abuse) — a `status` column checked in the tenant plugin → `402`/`403` at the door. 🛡️ Suspension must *not* delete anything: suspended tenants usually come back, and billing disputes need the data intact.
- **Offboarding** — the contractual and legal (GDPR) right to leave: an export job (Epoch 09's queues will run it) plus deletion. 🛡️ **Two-phase deletion**: soft-delete + grace period (fat-finger insurance — "we deleted the wrong tenant" is a real incident category), then a hard purge that must also sweep **caches, search indexes, job queues, and logs' PII** — every derived copy of tenant data you've created. Write the inventory of those copies *now*; every later epoch that adds one (Redis in 08, queues in 09) must append to it. Backups age out on retention schedules; document that in the DPA rather than pretending to surgically edit backups.

## 7.7 Fairness: one tenant must not eat the platform

Shared infrastructure means shared fate — unless you meter it. The **noisy neighbor** problem: Globex's misconfigured integration hammers the API at 500 rps; Acme's latency triples. Nobody leaked anything, but Acme still churns. Isolation has a *performance* dimension:

```ts
// per-tenant rate limiting — the key line:
app.register(rateLimit, {
  max: (req) => planLimits[req.tenant.plan].rps,   // limits are a product feature, not just armor
  timeWindow: "1 second",
  keyGenerator: (req) => req.tenant.id,            // NOT req.ip — one tenant, one bucket
  redis,                                           // shared across instances (Epoch 08 sets this up)
});
```

Same idea extends beyond HTTP as the system grows: per-tenant caps on expensive queries, per-tenant job-queue quotas (Epoch 09), per-tenant storage quotas enforced at write time. The reflex to build: **every shared resource eventually needs a per-tenant meter** — usually the same week sales asks for usage-based pricing, so the meter pays for itself twice.

## 7.8 ⚖️ Decision log

| Decision | Alternatives | Why |
|---|---|---|
| Postgres RLS as the enforcement layer | Query-builder wrappers that auto-inject WHERE; ORM middleware; "be careful" | Wrappers can be bypassed (raw SQL, new code paths); RLS sits below *all* app code — the class of bug is removed, not discouraged |
| `SET LOCAL` via parameterized `set_config` in a per-request transaction | Plain `SET`; connection-per-tenant; interpolated SET | Pool-safe (dies at tx end), injection-safe, pooler-compatible |
| App connects as non-owner `trellis_app` | Single db user for everything | RLS doesn't bind owners/superusers; least privilege is free insurance besides |
| Keep explicit predicates AND RLS | RLS only | Belt and suspenders: explicit scoping documents intent and keeps plans obvious; RLS catches the day the belt breaks |
| Soft-delete → grace → hard purge (incl. derived stores) | Immediate hard delete | Wrong-tenant deletion is unrecoverable; GDPR purge must chase every copy, so maintain the copy inventory |

## 7.9 Checkpoint

1. Reconstruct §7.1's leak, then explain *mechanically* where RLS stops it — which policy clause, evaluated where, before what?
2. Why is plain `SET` (non-LOCAL) a cross-tenant incident under connection pooling? Walk the connection through the pool between two requests.
3. Why must the app's database role be neither superuser nor table owner? What silently happens to your policies otherwise?
4. Your new `attachments` table shipped without RLS. Which test catches it, and why is "allowlist of exceptions" the right default for that meta-test?
5. Name the three dimensions of isolation this epoch secured, and which epochs extend each (data → 07, performance → 08/09, lifecycle → 09/11).

---

*Next: the architecture is correct; now it must stay up. Timeouts, graceful shutdown, health checks, caching, backpressure — and load tests that replace adjectives with numbers. → [Epoch 08: Reliability & Performance](epoch-08-reliability-and-performance.md)*
