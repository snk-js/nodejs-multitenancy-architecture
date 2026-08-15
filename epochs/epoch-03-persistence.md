# Epoch 03 — Persistence

> **You arrive with:** an app whose entire database is a `Map` that evaporates on restart.
> **You leave with:** PostgreSQL behind a repository layer, versioned migrations, transactions, a correctly-sized connection pool — and a working immunity to SQL injection.

---

## 3.1 The pain

Restart the Epoch 02 server. Every task is gone. Also unanswerable with a `Map`: two app instances sharing data, queries beyond "all of it", surviving a crash, concurrent updates that don't clobber each other. Persistence is not a feature; it's the floor.

## 3.2 ⚖️ Choosing the database

| | **PostgreSQL 17** | MySQL | MongoDB | SQLite |
|---|---|---|---|---|
| Model | Relational + JSONB | Relational | Documents | Relational, embedded |
| Transactions | Full ACID, best-in-class | Full ACID | Multi-doc, more caveats | Full ACID, single-writer |
| Our killer feature | **Row-Level Security** (Epoch 07's foundation) | — | — | — |
| Ops story | Everywhere; every cloud | Everywhere | Managed-first | No server at all |

**PostgreSQL.** The honest general-purpose default of the 2020s — and one feature makes it non-negotiable *for this course*: **Row-Level Security**, the mechanism that will let the *database itself* enforce tenant isolation in Epoch 07. We are choosing our multitenancy enforcement layer now, three epochs early. That's what architecture is: buying options before you need them.

```yaml
# compose.yaml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: trellis
      POSTGRES_PASSWORD: trellis
      POSTGRES_DB: trellis
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
volumes:
  pgdata:
```

```bash
# terminal
docker compose up -d
npm install pg
```

⚖️ **Driver vs ORM.** We start with `pg` (node-postgres) and **raw SQL**. ORMs (Drizzle, Prisma) are productive, but an engineer who meets an ORM before SQL can't tell when the ORM is lying — N+1 floods, phantom transactions, unindexable queries. We'll write SQL until the repetition hurts, then adopt Drizzle in Epoch 05 *for its TypeScript inference*, knowing exactly what it compiles to. SQL is the license; the ORM is the car.

## 3.3 Migrations: the database gets version control

Schema changes must be **ordered, repeatable, reviewable files in git** — not commands someone once typed into production. Same reasoning as version control for code; databases just took the industry 20 extra years to accept it.

```bash
npm install node-pg-migrate
```

```js
// migrations/1700000000000_create-tasks.js
export const up = (pgm) => {
  pgm.createTable("tasks", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    title: { type: "text", notNull: true },
    done: { type: "boolean", notNull: true, default: false },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
};

export const down = (pgm) => {
  pgm.dropTable("tasks");
};
```

```json
// package.json (scripts)
"migrate": "node-pg-migrate --migrations-dir migrations up",
"migrate:down": "node-pg-migrate --migrations-dir migrations down"
```

The tool records applied migrations in a `pgmigrations` table, so each runs exactly once per database. Rules that keep this system trustworthy:

- 🛡️ **Never edit an applied migration.** It already ran on some database; editing the file makes histories diverge. Fix forward with a new migration.
- `timestamptz`, never `timestamp` — the latter stores wall-clock time with no zone and is a standing invitation to off-by-timezone bugs.
- `down` migrations are for development convenience. Production rollback of a *deployed* schema change is a much subtler dance (expand/contract — Epoch 11).

## 3.4 The pool

```js
// src/db/pool.js
import pg from "pg";
import { config } from "../config.js";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  // idle client died (db restart, network blip) — log, don't crash
  console.error("idle pg client error", err);
});
```

(`config.js` gains `databaseUrl: required("DATABASE_URL")` — boot now fails loudly without it, exactly as designed in Epoch 02.)

Why pools exist: a Postgres connection is expensive (TCP + TLS + auth + a whole backend process on the server). Opening one per request would melt both sides. The pool keeps `max` warm connections; `pool.query()` borrows one and returns it.

🛡️ **Pool sizing is a system-wide budget, not a dial to crank.** Postgres has a global `max_connections` (default 100). Your effective ceiling is `instances × pool.max + humans + migrations + anything else`. Ten app instances at `max: 10` is *already* 100 — the next psql session gets refused. When Epoch 08 adds horizontal scaling, this arithmetic becomes a real incident class (fixed with sizing discipline or a server-side pooler like PgBouncer). Also: a query that can't get a connection within `connectionTimeoutMillis` fails fast with a clear error — infinitely-queued waiting just moves the outage somewhere harder to see.

## 3.5 The repository layer

Routes must not speak SQL. We introduce the seam that pays compound interest for the rest of the course:

```js
// src/repositories/task-repository.js
export function makeTaskRepository(db) {
  return {
    async list() {
      const { rows } = await db.query(
        "SELECT id, title, done, created_at FROM tasks ORDER BY created_at DESC"
      );
      return rows;
    },

    async create({ title }) {
      const { rows } = await db.query(
        "INSERT INTO tasks (title) VALUES ($1) RETURNING id, title, done, created_at",
        [title]
      );
      return rows[0];
    },

    async setDone(id, done) {
      const { rows } = await db.query(
        "UPDATE tasks SET done = $2 WHERE id = $1 RETURNING id, title, done, created_at",
        [id, done]
      );
      return rows[0] ?? null;
    },
  };
}
```

Notes on every choice:

- **`$1` placeholders, always.** See §3.6 — this is the entire SQL-injection defense.
- **A factory taking `db`, not an import of the pool.** The repository doesn't care if `db` is the pool, a transaction client, or a test double — same interface. This dependency-injection-by-argument is what lets Epoch 05 test repositories against a throwaway database and lets Epoch 07 hand them a *tenant-scoped* client **without changing a line in here**. The cheapest DI there is: a function parameter.
- **Explicit column lists, no `SELECT *`.** When columns like `tenant_id` appear, `*` becomes a slow leak into every layer above.
- **`?? null` on single-row lookups.** "Not found" is a domain outcome, not an exception. The route layer decides it's a 404.

The route slims down to translation, as promised in Epoch 02:

```js
// src/routes/tasks.js (now)
export async function taskRoutes(app) {
  const repo = app.taskRepository; // decorated in app.js: app.decorate("taskRepository", makeTaskRepository(pool))

  app.get("/tasks", { schema: listSchema }, async () => repo.list());

  app.post("/tasks", { schema: createSchema }, async (req, reply) => {
    const task = await repo.create({ title: req.body.title.trim() });
    return reply.code(201).send(task);
  });

  app.patch("/tasks/:id/done", { schema: doneSchema }, async (req, reply) => {
    const task = await repo.setDone(req.params.id, req.body.done);
    if (!task) return reply.code(404).send({ error: "task not found" });
    return task;
  });
}
```

## 3.6 💥 SQL injection, demonstrated properly

The bug, in the form it's usually written:

```js
// ❌ NEVER — string interpolation into SQL
const { rows } = await db.query(
  `SELECT * FROM tasks WHERE title = '${searchTerm}'`
);
```

Feed it `searchTerm = "'; DROP TABLE tasks; --"` and the database receives two statements and a comment. Injection has been the #1 or #2 web vulnerability class for **twenty-five years** — not because the fix is hard, but because string interpolation is *right there* and works in every demo.

The fix is structural, not sanitization:

```js
// ✅ parameterized — query text and data travel separately
await db.query("SELECT * FROM tasks WHERE title = $1", [searchTerm]);
```

With placeholders, the SQL text and the values go to Postgres **in separate protocol messages**. The value is never parsed as SQL — there is nothing to escape because it is never in the language. This is why "sanitize your inputs" is the wrong lesson: you can't reliably escape your way out of a parser; you keep data out of the parser entirely.

💥 Actually run the attack against the ❌ version in a scratch file (against your Docker db!), watch the table drop, then feel the ✅ version shrug it off. One minute; lifetime immunity.

🛡️ Corollary: **identifiers (table/column names) can't be parameterized.** If you ever build dynamic `ORDER BY ${sortField}`, the *only* safe pattern is an allowlist lookup (`const col = SORTABLE[sortField] ?? "created_at"`), never interpolation of user input.

## 3.7 Transactions: all or nothing

Money-transfer is the classic; ours is simpler but identical in shape — creating a task while writing an audit event (this pairing returns as *the outbox pattern* in Epoch 09):

```js
// src/db/tx.js
import { pool } from "./pool.js";

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);   // fn gets THE SAME client
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();                  // ALWAYS back to the pool
  }
}
```

```js
// usage — repositories accept any `db`, so a tx client slots right in
await withTransaction(async (tx) => {
  const task = await makeTaskRepository(tx).create({ title });
  await tx.query(
    "INSERT INTO audit_events (kind, payload) VALUES ($1, $2)",
    ["task.created", JSON.stringify({ taskId: task.id })]
  );
  return task;
});
```

The same-client rule and the leak trap, drawn:

```mermaid
sequenceDiagram
    participant H as Handler
    participant P as Pool (max: 10)
    participant C as Client #7 (one TCP conn)
    participant PG as Postgres

    H->>P: pool.connect()
    P->>H: client #7 (borrowed)
    H->>C: BEGIN
    C->>PG: BEGIN
    H->>C: INSERT tasks … (same client!)
    H->>C: INSERT audit_events … (same client!)
    alt fn() succeeds
        H->>C: COMMIT
    else fn() throws
        H->>C: ROLLBACK
        Note over H: error re-thrown to caller
    end
    H->>P: client.release() — in finally, ALWAYS
    Note over P: forget release() → connection leaked forever;<br/>leak 10 of them → every request hangs at connect()<br/>and "the database looks down" while it's fine
```

Three traps this helper permanently defuses:

- 🛡️ **All statements must run on the same client.** `pool.query()` grabs *any* free connection — `BEGIN` on one connection and `INSERT` on another are unrelated conversations, and your "transaction" silently isn't one. This is among the most common serious pg mistakes in the wild.
- 🛡️ **`release()` in `finally`.** A client checked out and never returned is a leaked connection; leak `max` of them and every request hangs at `connect()` until `connectionTimeoutMillis`. Pool exhaustion via leak looks exactly like "the database is down" — except the database is fine.
- 🛡️ **Rollback on any throw.** Half-applied writes are worse than failed writes; they're failures that lie.

## 3.8 First contact with indexes

```js
// migrations/...._index-tasks-created-at.js
export const up = (pgm) => {
  pgm.createIndex("tasks", ["created_at"]);
};
```

Our `list()` orders by `created_at`. Without an index, Postgres reads and sorts the whole table — invisible at 100 rows, a database-killer at 10 million. The tool for seeing this is `EXPLAIN ANALYZE`:

```sql
EXPLAIN ANALYZE SELECT id, title, done, created_at FROM tasks ORDER BY created_at DESC LIMIT 50;
-- Before: Seq Scan + Sort.  After: Index Scan Backward. 
```

Make reading query plans a reflex now, while they're two lines long. Rule of thumb that carries the whole course: **columns in `WHERE`/`ORDER BY`/`JOIN` of hot queries get indexes; every index taxes writes; measure, don't guess.** In Epoch 06, "every hot index starts with `tenant_id`" becomes a law of the schema.

## 3.9 ⚖️ Decision log

| Decision | Alternatives | Why |
|---|---|---|
| PostgreSQL 17 | MySQL, Mongo, SQLite | ACID + ubiquity + JSONB, and RLS is our Epoch-07 enforcement plan |
| Raw SQL via `pg` (for now) | Prisma/Drizzle now | Learn the layer the ORM abstracts first; Drizzle arrives in Epoch 05 with TS |
| Repository factories taking `db` | Repos importing the pool; SQL in routes | The seam that enables tests (05), transactions (§3.7), and tenant scoping (07) unchanged |
| `node-pg-migrate` | Hand-run SQL, ORM auto-sync | Ordered, reviewable, once-only history; auto-sync tools hide destructive diffs |

## 3.10 Checkpoint

1. Why does parameterization defeat injection where escaping/sanitizing can't? Where do the values travel, relative to the SQL text?
2. Your transaction helper takes `fn(client)`. Explain precisely why `pool.query()` inside a transaction is broken, and what symptom a forgotten `release()` produces under load.
3. `max: 10`, six app instances, Postgres `max_connections = 100`, plus dashboards and cron. Do the arithmetic — what breaks first and how does it manifest?
4. Why are repositories *factories that accept `db`* instead of modules that import the pool? Name the two future epochs that depend on this.

---

*Next: anyone can read and write every task. Time for identity — password hashing, sessions vs tokens, cookies that survive scrutiny, and who's allowed to do what. → [Epoch 04: Identity](epoch-04-identity.md)*
