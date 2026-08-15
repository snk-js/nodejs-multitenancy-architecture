# Epoch 05 — TypeScript & Testing

> **You arrive with:** ~1,500 lines of JavaScript you're starting to be afraid of.
> **You leave with:** strict TypeScript running natively on Node 24, Drizzle for inferred query types, a two-layer test suite (fast unit tests + real-database integration tests), and the safety harness every remaining epoch depends on.

---

## 5.1 The pain

Symptoms you have right now, whether you noticed or not:

- `users.create({ emial })` — a typo the runtime finds at 2 a.m. and a compiler finds at keystroke.
- Every repository returns `any`-shaped rows; renaming a column is a full-text-search-and-pray operation.
- Refactors are scary, so they don't happen, so entropy wins.
- The claim "login is secure" rests on you having manually curl'd it once, three days ago.

Types and tests attack the same disease — **unverified change** — from two sides: types prove *shape* properties on every keystroke; tests prove *behavior* properties on every run. Neither substitutes for the other.

## 5.2 TypeScript without a build step

Node 22.18+/24 runs TypeScript **natively by type-stripping**: types are erased at load time, no transpiler, no `dist/`, no source maps.

```bash
npm install -D typescript @types/node
```

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "target": "esnext",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,   // required for type stripping: type-only imports must say `import type`
    "erasableSyntaxOnly": true,     // forbids TS features needing transpilation (enums, namespaces, param props)
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "noEmit": true
  }
}
```

The division of labor: **Node runs the code** (ignoring types entirely); **`tsc --noEmit` checks the types** (in your editor live, and in CI as a gate). Rename `src/**/*.js → *.ts`, fix what lights up.

Two policies that determine whether TS helps or decorates:

- 🛡️ **`strict: true` is not negotiable, and `any` is a code-review event.** Un-strict TypeScript is documentation that lies. `unknown` + narrowing is the honest alternative at true boundaries.
- 🛡️ **Types must be *true at the boundaries*.** `JSON.parse`, `process.env`, DB rows — the compiler takes your word for external data. A wrong type assertion is worse than none. Boundaries get runtime validation (our route schemas already do this for HTTP; Drizzle does it for rows by *generating* types from the schema rather than trusting hand-written ones).

## 5.3 Drizzle: the ORM adopted with open eyes

We wrote raw SQL for two epochs on purpose; now the *typing* of hand-rolled rows is the pain, and Drizzle is the cure whose cost we can price. Drizzle is a thin, SQL-shaped layer: the schema is TypeScript, every query's return type is **inferred**, and what it emits is the SQL you'd have written.

```bash
npm install drizzle-orm && npm install -D drizzle-kit
```

```ts
// src/db/schema.ts
import { pgTable, uuid, text, boolean, timestamptz } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  done: boolean("done").notNull().default(false),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});
```

```ts
// src/repositories/task-repository.ts — same seam, now typed end-to-end
import { and, eq, desc } from "drizzle-orm";
import { tasks } from "../db/schema.ts";
import type { Db } from "../db/client.ts";

export function makeTaskRepository(db: Db) {
  return {
    listByOwner(ownerId: string) {
      return db.select().from(tasks).where(eq(tasks.ownerId, ownerId)).orderBy(desc(tasks.createdAt));
      // return type inferred: { id: string; ownerId: string; title: string; done: boolean; createdAt: Date }[]
    },
    async setDone(id: string, ownerId: string, done: boolean) {
      const [row] = await db.update(tasks).set({ done })
        .where(and(eq(tasks.id, id), eq(tasks.ownerId, ownerId)))  // Epoch 04's in-query authz, typed
        .returning();
      return row ?? null;
    },
  };
}
```

Rename a column in `schema.ts` → every stale usage in the codebase is a compile error. That is the feature we came for. Migrations: `drizzle-kit generate` diffs the schema and emits **SQL files you review and commit** — same git-versioned discipline as Epoch 03, better ergonomics. 🛡️ Never use "push"-style auto-sync against real data; generated diffs can contain destructive steps, which is precisely why they must pass through review.

⚖️ *Why not Prisma?* Also good. Drizzle wins here for being SQL-shaped (your Epoch-03 knowledge transfers 1:1, and `EXPLAIN` output matches the code you wrote), zero-runtime-engine, and friction-free with the raw-SQL escape hatch RLS will need in Epoch 07.

## 5.4 Testing: the two layers and what each is *for*

```
        /  E2E (a handful; Epoch 11's smoke tests)
       /――  Integration: real HTTP against real Postgres — "the wiring works"
      /――――  Unit: pure logic, no I/O, milliseconds — "the logic works"
```

We use **`node:test`**, the built-in runner — zero dependencies, TS-native, and fully sufficient. (Vitest is a fine alternative; nothing below changes conceptually.)

**Unit tests** cover pure logic — and here the discipline from earlier epochs pays out: password rules, session expiry math, and validation helpers are pure functions *because* we kept I/O in repositories:

```ts
// src/services/password.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "./password.ts";

test("verifies a correct password and rejects a wrong one", async () => {
  const hash = await hashPassword("hunter2!");
  assert.equal(await verifyPassword(hash, "hunter2!"), true);
  assert.equal(await verifyPassword(hash, "hunter3!"), false);
});

test("hashes are salted: same input, different output", async () => {
  assert.notEqual(await hashPassword("x"), await hashPassword("x"));
});
```

**Integration tests** are where backend confidence actually lives, and they follow one rule: 🛡️ **test against a real PostgreSQL, never a mock of the database.** A mocked repository test proves your code calls the mock the way you mocked it — circular comfort. Real bugs live in SQL syntax, constraint behavior, transaction semantics, and (soon) RLS policies: things only Postgres can adjudicate. Mock only what you don't own and can't run (third-party HTTP APIs — Epoch 09).

```ts
// test/helpers/test-app.ts
import { buildApp } from "../../src/app.ts";     // Epoch 02's split, cashing in
import { migrate } from "./migrate.ts";

export async function makeTestApp() {
  const schema = `test_${crypto.randomUUID().replaceAll("-", "")}`;
  const db = await makeDbForSchema(schema);       // isolated schema per test file
  await migrate(db);
  const app = buildApp({ db, logger: false });
  return {
    app,
    async cleanup() { await dropSchema(schema); await app.close(); },
  };
}
```

```ts
// test/auth.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { makeTestApp } from "./helpers/test-app.ts";

let t: Awaited<ReturnType<typeof makeTestApp>>;
before(async () => { t = await makeTestApp(); });
after(async () => { await t.cleanup(); });

test("register → login → authed request → logout lifecycle", async () => {
  await t.app.inject({ method: "POST", url: "/auth/register",
    payload: { email: "a@example.com", password: "correct-horse-battery" } });

  const login = await t.app.inject({ method: "POST", url: "/auth/login",
    payload: { email: "a@example.com", password: "correct-horse-battery" } });
  assert.equal(login.statusCode, 200);
  const cookie = login.cookies.find((c) => c.name === "session");
  assert.ok(cookie?.httpOnly, "session cookie must be httpOnly");   // security properties are testable!

  const me = await t.app.inject({ method: "GET", url: "/api/tasks",
    cookies: { session: cookie.value } });
  assert.equal(me.statusCode, 200);
});

test("wrong password and unknown email are indistinguishable", async () => {
  const a = await t.app.inject({ method: "POST", url: "/auth/login",
    payload: { email: "a@example.com", password: "wrong" } });
  const b = await t.app.inject({ method: "POST", url: "/auth/login",
    payload: { email: "ghost@example.com", password: "wrong" } });
  assert.equal(a.statusCode, 401);
  assert.equal(b.statusCode, 401);
  assert.deepEqual(a.json(), b.json());          // Epoch 04's enumeration defense, now enforced forever
});
```

Read those assertions again: **the security decisions of Epoch 04 are now regression-protected.** Someone "simplifying" the login handler next year will break a named test, not production. This is the real product of testing — decisions that *stay made*.

Mechanics worth noting: `app.inject()` simulates full HTTP (routing, hooks, schemas, serialization) with **no port**, so files run in parallel without collisions; schema-per-test-file gives each file a pristine database cheaply (Testcontainers is the heavier, stronger alternative; same idea). Determinism rules: no shared mutable fixtures, no sleeps, no ordering dependence — 🛡️ a flaky suite is worse than no suite, because it trains people to ignore red.

```json
// package.json
"scripts": {
  "test": "node --test --env-file=.env.test 'src/**/*.test.ts' 'test/**/*.test.ts'",
  "typecheck": "tsc --noEmit"
}
```

Both commands become CI gates in Epoch 11: **red = unmergeable.** A failing test you can merge past is a suggestion, not a test suite.

## 5.5 What NOT to test

Negative space matters as much:

- Don't test the framework (Fastify routes to handlers; that's their suite's job).
- Don't test type-guaranteed facts (that's `tsc`'s job — don't write runtime tests for compile-time truths).
- Don't chase 100% coverage. Coverage measures *execution*, not *verification* — you can execute everything and assert nothing. Target the code where wrongness is expensive: auth, money, and (from Epoch 06) **anything touching tenant boundaries**, which will get the strictest tests in the codebase.

## 5.6 ⚖️ Decision log

| Decision | Alternatives | Why |
|---|---|---|
| Native type-stripping, `tsc --noEmit` as checker | tsx/esbuild builds, ts-node | Zero build step, zero source-map debugging, the platform's own path |
| `strict` + boundary honesty | Loose TS, hand-typed rows | Untrue types are worse than no types; generate types from the schema instead of asserting them |
| Drizzle | Prisma, keep raw pg | Inferred row types with SQL-shaped semantics; trivial raw-SQL escape hatch for Epoch 07's RLS |
| `node:test` + `inject()` | Vitest/Jest + supertest over sockets | Platform-native, parallel-safe, no port juggling; the concepts transfer wholesale if you prefer Vitest |
| Real Postgres in integration tests | Mocked repositories | The DB is where the bugs are; mocks verify only themselves |

## 5.7 Checkpoint

1. Why is a hand-written `interface TaskRow` *more* dangerous than helpful if it can drift from the actual table? How does schema-inference dissolve the problem?
2. What class of bug can the integration suite catch that the unit suite structurally cannot? Give a concrete example from Epoch 03 or 04.
3. Why is mocking your own repository in an integration test "circular comfort"?
4. Which two Epoch-04 security properties did we pin with assertions, and what does that buy over code review alone?

---

*Next: the main event begins. One app, many companies, one database — the models, the resolution, and the context plumbing of multitenancy. → [Epoch 06: Multitenancy I — Models & Context](epoch-06-multitenancy-foundations.md)*
