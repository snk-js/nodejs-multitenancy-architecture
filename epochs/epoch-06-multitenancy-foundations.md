# Epoch 06 — Multitenancy I: Models & Context

> **You arrive with:** a single-tenant app where users own tasks.
> **You leave with:** workspaces (tenants), memberships with roles, a reasoned choice among the three isolation models, tenant resolution, and an `AsyncLocalStorage`-based tenant context that flows through every layer without being hand-passed.

---

## 6.1 What multitenancy actually is

Trellis is going to be sold to *companies*. Acme Corp and Globex will both use the same deployed application and — in our chosen model — the same database. Each company is a **tenant**: an isolation boundary for data, configuration, and (later) performance and billing.

The stakes are asymmetric and brutal. Most bugs cost you a retry; **a cross-tenant data leak costs you the company**. Acme seeing one Globex task title in a list response is a security-incident disclosure, a churned customer, and a sales objection forever. Multitenancy is therefore not a feature — it is a *property of the whole system*, and the next two epochs build it in layers:

- **This epoch:** correctness by *convention* — schema, resolution, context, scoped queries.
- **Epoch 07:** correctness by *construction* — the database refuses cross-tenant rows even when application code is buggy.

## 6.2 ⚖️ The three isolation models

The decision every multi-tenant system must make first: *how much do tenants share?*

| | **Shared schema** (tenant_id column) | Schema-per-tenant | Database-per-tenant |
|---|---|---|---|
| Isolation strength | Logical (rows interleaved) | Medium (namespace per tenant) | Strong (physical) |
| Cost per tenant | ~zero → self-serve free tier viable | Low-ish, grows with count | High (connections, storage, ops) |
| Onboard a tenant | `INSERT` one row | `CREATE SCHEMA` + run migrations | Provision a database |
| Migrations | Run **once** | Run × N tenants (partial-failure hell at N=5,000) | Run × N databases |
| Noisy neighbor | Shared everything → needs app-level fairness (Ep. 08) | Shared server | Isolated |
| Per-tenant backup/restore/region | Hard (row-level surgery) | Moderate | Trivial — also: compliance/residency ✓ |
| Cross-tenant analytics (your own product metrics) | One query | Painful UNION | ETL project |
| Fits | **B2B SaaS with self-serve, many small–mid tenants** | Dozens–hundreds of mid tenants | Few, large, regulated tenants |

**We choose shared schema + `tenant_id`**, the dominant SaaS pattern, because Trellis wants self-serve signup (tenant creation must cost an INSERT, not an ops runbook) and thousands of small tenants (5,000 schemas × every migration is an operational horror story you only need to live once). Its weakness — isolation resting on a `WHERE` clause — is exactly what Epoch 07's RLS eliminates.

🛡️ **Design note:** the models aren't forever-exclusive. Mature platforms run **hybrid**: shared schema for the long tail, with a lane to promote a whale/regulated tenant to a dedicated database. Keeping *all* tenant access behind the repository seam (Epoch 03's foresight) is what keeps that door open — a promoted tenant is "the same repositories pointed at a different pool," not a rewrite. The capstone's scaling roadmap builds on this.

## 6.3 The schema: workspaces, memberships, and the tenant column

```ts
// src/db/schema.ts (additions)
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),        // "acme" → acme.trellis.app
  name: text("name").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const memberships = pgTable("memberships", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  role: text("role", { enum: ["owner", "admin", "member"] }).notNull().default("member"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })]);

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id), // ← THE column
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  done: boolean("done").notNull().default(false),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (t) => [
  index("tasks_ws_created_idx").on(t.workspaceId, t.createdAt),   // tenant column FIRST
]);
```

Three laws are being legislated here:

1. **Users and tenants are many-to-many.** A user is a *person* (global identity, one login); a membership is *a person's seat in a workspace, with a role*. Modeling users as belonging to one tenant feels simpler and is wrong: consultants, agencies, and your own support staff exist in several. Authorization from here on is a property of the **membership**, not the user.
2. **Every tenant-owned table carries `workspace_id NOT NULL`.** No exceptions, no "we can derive it through a join." Deriving tenancy transitively (task → project → workspace) makes every isolation check a join and every future RLS policy a subquery; denormalizing the tenant key onto each row is the standard, deliberate trade.
3. **Every hot index leads with the tenant column.** All real queries are per-tenant (`WHERE workspace_id = $1 AND …`), so `(workspace_id, created_at)` lets Postgres jump straight to one tenant's slice. An index on bare `created_at` would interleave all tenants' rows and serve nobody. This one habit is most of "multi-tenant query performance."

## 6.4 Tenant resolution: which workspace is this request for?

⚖️ Where does the tenant come from, per request?

| Strategy | Example | Pros / Cons |
|---|---|---|
| **Subdomain** | `acme.trellis.app` | Clean separation, cookie scoping, feels enterprise; needs wildcard DNS/TLS |
| Path prefix | `trellis.app/acme/...` | Trivial locally; every route regains a segment, links are clumsier |
| Header | `X-Workspace-Id: …` | Fine for APIs/machines; invisible in browsers |
| Token claim only | session says workspace | Implicit — but *something* must still pick the active workspace |

**We resolve by subdomain, verified by membership.** The subdomain is a *claim*; the session tells us *who*; the memberships table adjudicates:

```ts
// src/plugins/tenant.ts
export async function tenantPlugin(app: FastifyInstance) {
  app.decorateRequest("tenant", null);

  app.addHook("preHandler", async (req, reply) => {
    if (isPublic(req)) return;                       // runs AFTER authPlugin: user is set

    const slug = extractSubdomain(req.headers.host); // "acme.trellis.app" → "acme"
    if (!slug) return reply.code(400).send({ error: "workspace not specified" });

    const found = await app.workspaceRepo.findBySlugWithMembership(slug, req.user.id);
    // one query: workspace JOIN membership WHERE slug=$1 AND user_id=$2
    if (!found) return reply.code(404).send({ error: "workspace not found" });
    //            🛡️ 404 for both "no such workspace" and "not a member" — Epoch 04's
    //            existence-hiding rule applied at tenant scale.

    req.tenant = { id: found.workspace.id, slug, role: found.membership.role };
  });
}
```

🛡️ **Trust nothing client-controlled as authorization.** The `Host` header names the *venue*; the membership row grants *entry*. Skipping the membership check — "the workspace id is right there in the URL/header" — is how the classic cross-tenant vulnerability class (an IDOR at tenant scale) ships. And never accept a raw workspace-id header from browsers as the authz input: headers are attacker-controlled; database rows are not.

(Local dev: `*.localtest.me` and friends resolve to `127.0.0.1`, so `acme.localtest.me:3000` works with zero DNS setup.)

## 6.5 Tenant context without hand-passing: `AsyncLocalStorage`

The naive path is threading `tenantId` as a parameter through every function forever — noisy, and one forgotten hop silently drops the context. Node's answer is **`AsyncLocalStorage`**: request-scoped implicit state that flows across `await`s (the equivalent of thread-locals, but for async).

```ts
// src/context.ts
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  requestId: string;
  userId: string;
  tenant: { id: string; slug: string; role: "owner" | "admin" | "member" };
}

const als = new AsyncLocalStorage<RequestContext>();

export const runWithContext = <T>(ctx: RequestContext, fn: () => T) => als.run(ctx, fn);

export function getContext(): RequestContext {
  const ctx = als.getStore();
  if (!ctx) throw new Error("no request context — code path outside runWithContext");
  return ctx; // 🛡️ throwing beats returning undefined: a missing tenant context must
              // never quietly become an unscoped query.
}
```

Wired in once, around each request (Fastify's `onRequest`+ALS integration, or simply invoking the route pipeline inside `als.run`). Now *any* layer — service, repository, logger — can ask "what tenant am I acting for?" without the question appearing in every signature. Two disciplines keep ALS from becoming a global-variable slum:

- It carries **ambient request facts** only (ids, tenant, role) — never business data, never mutable workflow state.
- Reads go through `getContext()` so the failure mode is loud. (Epoch 10 will piggyback on the same context to stamp `tenantId` on every log line and trace span — one plumbing job, three payoffs.)

## 6.6 Scoped repositories: the convention layer

```ts
// src/repositories/task-repository.ts (tenant-aware)
export function makeTaskRepository(db: Db) {
  return {
    list() {
      const { tenant } = getContext();
      return db.select().from(tasks)
        .where(eq(tasks.workspaceId, tenant.id))
        .orderBy(desc(tasks.createdAt));
    },
    async create(input: { title: string }) {
      const { tenant, userId } = getContext();
      const [row] = await db.insert(tasks)
        .values({ workspaceId: tenant.id, ownerId: userId, title: input.title })
        .returning();
      return row;
    },
    async setDone(id: string, done: boolean) {
      const { tenant } = getContext();
      const [row] = await db.update(tasks).set({ done })
        .where(and(eq(tasks.id, id), eq(tasks.workspaceId, tenant.id)))  // id alone is NEVER enough
        .returning();
      return row ?? null;
    },
  };
}
```

The load-bearing rule, stated once and never violated again: 🛡️ **a primary key is not an authorization.** `WHERE id = $1` finds the row for *any* tenant; UUIDs travel in URLs, logs, browser history, and support tickets, and unguessability is not isolation. Every read, update, and delete on tenant-owned data carries the tenant predicate — the Epoch 04 ownership pattern, promoted to a schema-wide invariant.

Role checks (authorization *within* the tenant) live in one place, not sprinkled as inline ifs:

```ts
// src/plugins/authorize.ts
const ORDER = { member: 0, admin: 1, owner: 2 } as const;
export const requireRole = (min: keyof typeof ORDER) =>
  async (req: FastifyRequest, reply: FastifyReply) => {
    if (ORDER[req.tenant.role] < ORDER[min]) {
      return reply.code(403).send({ error: "insufficient role" });
      // 403 (not 404) is correct here: membership is already established;
      // we're not hiding existence anymore, we're refusing an action.
    }
  };

// usage: app.delete("/tasks/:id", { preHandler: requireRole("admin") }, ...)
```

## 6.7 The honest limitation of this epoch

Isolation currently holds **if and only if every repository method remembers its tenant predicate**. One future teammate writing one ad-hoc query without `workspaceId` — a search feature, an export endpoint, a debug route — and Acme reads Globex. Convention scales poorly with team size and deadline pressure; the whole point of the next epoch is to take this class of bug away from humans: the database itself will refuse to return cross-tenant rows, and the tenant tests will prove it.

Write this epoch's cross-tenant test anyway — it's the spec the next epoch must keep passing:

```ts
test("a member of acme can never see globex tasks", async () => {
  await asTenant("globex", (api) => api.createTask("secret globex plan"));
  const list = await asTenant("acme", (api) => api.listTasks());
  assert.equal(list.some((t) => t.title.includes("globex")), false);
});

test("acme cannot mutate a globex task even with its exact id", async () => {
  const globexTask = await asTenant("globex", (api) => api.createTask("x"));
  const res = await asTenant("acme", (api) => api.setDone(globexTask.id, true));
  assert.equal(res.statusCode, 404);   // and the row is unchanged
});
```

## 6.8 ⚖️ Decision log

| Decision | Alternatives | Why |
|---|---|---|
| Shared schema + `tenant_id` | Schema-per-tenant, db-per-tenant | Self-serve economics + single-run migrations; isolation gap to be closed by RLS (Ep. 07); hybrid promotion path kept open |
| Users ↔ workspaces via memberships | User belongs to one tenant | People span companies; roles are per-seat, not per-person |
| Denormalized `workspace_id` on every table | Derive via joins | Direct predicates & simple RLS policies beat join-time tenancy every time |
| Subdomain + membership verification | Path, header, token-only | Clean UX and cookie scoping; the DB, not the client, is the authority |
| `AsyncLocalStorage` context | Explicit param threading, DI container scopes | Ambient request facts across awaits, loud on absence; params for business data still explicit |

## 6.9 Checkpoint

1. Your CEO signs a 10,000-seat bank that demands EU data residency and per-tenant restore. Which isolation model does *that tenant* need, and what past decision lets you offer it without rewriting the app?
2. Why must `workspace_id` appear even on tables reachable through a parent (task → project → workspace)? Give the query-shape and the RLS-shape reasons.
3. Why is the membership JOIN the authorization, rather than the subdomain, a header, or an unguessable UUID?
4. State the failure mode of tenancy-by-convention in one sentence, and the next epoch's answer to it in one more.

---

*Next: we stop trusting ourselves. PostgreSQL Row-Level Security makes cross-tenant reads impossible even for buggy code — defense in depth, tested with hostile tests. → [Epoch 07: Multitenancy II — Enforcement](epoch-07-multitenancy-enforcement.md)*
