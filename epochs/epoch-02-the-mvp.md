# Epoch 02 — The MVP

> **You arrive with:** a working but hand-stitched server and a six-row checklist of what a framework must buy you.
> **You leave with:** Trellis on Fastify 5 — schema-validated, centrally error-handled, config-checked at boot, and structured so it can be tested without touching a network port.

---

## 2.1 ⚖️ Choosing the framework — with the checklist, not vibes

Epoch 01 produced our evaluation table: routing with params, body handling with limits, declarative validation, inescapable error handling, logging, static files. Candidates in the 2026 Node ecosystem:

| | Express 5 | **Fastify 5** | Hono | NestJS |
|---|---|---|---|---|
| Routing | Regex-based, mature | Radix tree (fast, O(path length)) | Radix tree, edge-portable | On top of Express/Fastify |
| Validation | BYO (zod/joi bolt-on) | **First-class JSON Schema**, compiled per-route | BYO (zod middleware) | class-validator decorators |
| Error funnel | Middleware convention, easy to escape | `setErrorHandler` catches sync+async uniformly | onError hook | Exception filters |
| Body limits | BYO | `bodyLimit` built-in | BYO | Inherited |
| Logging | BYO | **pino built in** (structured, fast) | BYO | Inherited |
| Speed (hello-world RPS, indicative) | ~1× | **~2–3×** | ~2–3× | ≈ underlying |
| Philosophy | Minimal, huge ecosystem | Batteries for servers, plugin encapsulation | Minimal, multi-runtime | Full DI framework, opinionated |

**We pick Fastify.** It natively covers five of our six rows (static files via one official plugin), its plugin model will map beautifully onto tenancy scoping later, and its built-in pino logger is exactly what Epoch 10 needs. Express would mean re-assembling those pieces ourselves from middleware; NestJS imposes a large DI/decorator worldview we'd rather learn as *concepts* than as framework magic; Hono is excellent but optimizes for edge portability we don't need.

> This table—not "Fastify is better"—is the takeaway. On a team already fluent in Express, or a project that's 90% CRUD glue, the other columns can win. Frameworks are trade-offs, not truths.

```bash
# terminal
npm install fastify @fastify/static
```

## 2.2 The structural move that matters most: app vs server

The single highest-leverage line of architecture in this epoch is splitting *building the app* from *running the app*:

```js
// src/app.js — builds and returns the app; starts nothing
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { taskRoutes } from "./routes/tasks.js";

export function buildApp(opts = {}) {
  const app = Fastify({
    logger: opts.logger ?? true,
    bodyLimit: 100 * 1024, // Epoch 01's hard-won 100 KiB cap, now one option
  });

  app.register(fastifyStatic, {
    root: path.resolve("./public"),
    prefix: "/public/",
  });
  // @fastify/static does the traversal check from Epoch 01 for us —
  // you know exactly what bug it's preventing.

  app.get("/health", async () => ({ status: "ok" }));
  app.register(taskRoutes, { prefix: "/api" });

  return app;
}
```

```js
// src/server.js — the only file that touches the network
import { buildApp } from "./app.js";
import { config } from "./config.js";

const app = buildApp();

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
```

Why this split is sacred: **`buildApp()` can be called inside a test**, exercised via `app.inject()` (Fastify's simulated HTTP, no socket, no port), and thrown away — hundreds of times, in parallel. Servers that only exist as a top-level script can only be tested by booting the world. Epoch 05 cashes this in; every serious codebase you'll meet has this seam somewhere.

(`host: "0.0.0.0"` — inside containers, `localhost` binds a loopback interface unreachable from outside the container. Another "works locally" landmine, defused early.)

## 2.3 Validated config, or: crash at boot, not at 2 a.m.

```js
// src/config.js
const required = (name) => {
  const v = process.env[name];
  if (v === undefined || v === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
};

export const config = Object.freeze({
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
});

if (Number.isNaN(config.port)) {
  throw new Error("PORT must be a number");
}
```

Trivial now — the *policy* is the point:

🛡️ **Fail fast, at startup, loudly.** A missing `DATABASE_URL` should kill the process at boot with a named error — not surface three hours later as a cryptic `ECONNREFUSED` inside a request. As config grows (Epoch 03 adds the database URL, Epoch 08 adds Redis), every value passes through this file: **one place to see everything the app needs from its environment.** `Object.freeze` because config that mutates at runtime is a debugging nightmare.

Node 24 reads `.env` files natively — `node --env-file=.env src/server.js` — no `dotenv` dependency. Add `.env` to `.gitignore` *now*; committed secrets are forever (Epoch 11 explains why history rewrites don't save you).

## 2.4 Routes with contracts: schema validation

Here is Epoch 01's inline `typeof` checking, grown up:

```js
// src/routes/tasks.js
import { randomUUID } from "node:crypto";

const tasks = new Map(); // still in-memory — its funeral is Epoch 03

const taskSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    title: { type: "string" },
    done: { type: "boolean" },
  },
};

export async function taskRoutes(app) {
  app.get("/tasks", {
    schema: {
      response: { 200: { type: "array", items: taskSchema } },
    },
  }, async () => [...tasks.values()]);

  app.post("/tasks", {
    schema: {
      body: {
        type: "object",
        required: ["title"],
        additionalProperties: false,
        properties: {
          title: { type: "string", minLength: 1, maxLength: 500 },
        },
      },
      response: { 201: taskSchema },
    },
  }, async (req, reply) => {
    const task = { id: randomUUID(), title: req.body.title.trim(), done: false };
    tasks.set(task.id, task);
    return reply.code(201).send(task);
  });
}
```

What the schema buys, mechanically:

- **Requests that don't match never reach your handler.** Fastify compiles the schema (via Ajv) to a specialized validation function and returns a structured `400` itself. Your handler body can *assume* `req.body.title` is a non-empty string ≤500 chars. Handler code stops being 40% defensive checks.
- **`additionalProperties: false`** rejects unknown fields. Without it, a client can send `{"title": "x", "done": true}` — or, once we have real models, `{"role": "admin"}` — and whether that smuggled field does damage depends on how carefully every downstream line treats the object. This failure mode is called **mass assignment**, it has an OWASP entry, and schema strictness kills it at the door.
- **Response schemas** are both a contract and a leak guard: fields not in the schema are *stripped from output*. When the task row later grows internal columns (`tenant_id`, soft-delete flags), they won't dribble into API responses by accident.
- The schemas are data — later they generate OpenAPI docs for free (`@fastify/swagger`), so docs can't drift from behavior.

## 2.5 One error funnel

```js
// in buildApp(), before returning app
app.setErrorHandler((err, req, reply) => {
  if (err.validation) {
    return reply.code(400).send({ error: "validation failed", details: err.validation });
  }
  req.log.error({ err }, "unhandled error");
  const status = err.statusCode ?? 500;
  reply.code(status).send({
    error: status >= 500 ? "internal server error" : err.message,
  });
});

app.setNotFoundHandler((req, reply) => {
  reply.code(404).send({ error: "not found" });
});
```

Two guardrails baked in:

🛡️ **5xx messages are generic.** Internal error messages contain paths, SQL fragments, library internals — reconnaissance gold. Log the real error with full detail (structured, via `req.log` — note it automatically carries a per-request `reqId`); tell the client only that something went wrong. 4xx messages, by contrast, *should* be specific: the client needs to know what to fix.

🛡️ **Async errors are caught too.** Because Fastify handlers are promises it owns, a `throw` anywhere inside `async` handler code lands here. Recall how fragile that guarantee was to hand-build in Epoch 01 — this funnel plus schemas is most of what we adopted a framework *for*.

## 2.6 The shape of the project

```
trellis/
├── public/            # static assets
├── src/
│   ├── app.js         # buildApp(): plugins, routes, error funnel
│   ├── server.js      # process entry: config + listen + exit codes
│   ├── config.js      # ALL environment access, validated, frozen
│   └── routes/
│       └── tasks.js   # HTTP layer for tasks
├── .env               # gitignored
└── package.json
```

Small, but each boundary is doing real work: *environment access is quarantined in `config.js`*, *network is quarantined in `server.js`*, *everything else is testable pure construction*. Routes will thin out further in Epoch 03 when a service/repository layer appears beneath them — the rule that emerges: **route files translate HTTP ↔ domain, and nothing else.**

## 2.7 💥 Break it yourself

1. `POST /api/tasks` with `{"title": ""}`, with `{"title": 42}`, with `{}`, and with `{"title":"x","hacker":true}` — read the four different 400s. You wrote none of that handling.
2. Send a 200 KiB body. Fastify answers `413` — Epoch 01's guardrail, now config.
3. Throw `new Error("boom: /home/deploy/src/secret.js")` inside a handler. Confirm the client sees only `internal server error` while the log line has the stack, the message, and a `reqId`.
4. In the response schema, remove `done` from `properties`, restart, and `GET /api/tasks`: the field vanishes from output. That's the leak guard working in miniature.

## 2.8 ⚖️ Decision log

| Decision | Alternatives | Why |
|---|---|---|
| Fastify 5 | Express 5, Hono, NestJS | Scored best against the Epoch-01 checklist: native validation, error funnel, logging, body limits; plugin encapsulation pays off at tenancy time |
| JSON Schema (Ajv) for validation | Zod at the edge | It's Fastify's native, compiled path and doubles as OpenAPI source. Zod re-enters in Epoch 05 for *internal* types where TS inference shines |
| `buildApp()`/`server.js` split | Single entry script | Testability without ports; the single most copied pattern in this course |
| Config module, frozen, boot-validated | Scattered `process.env` reads | One inventory of environmental needs; failures at boot instead of mid-request |

## 2.9 Checkpoint

1. What is mass assignment, and which single schema keyword shuts it down?
2. Why do response schemas make responses *safer*, not just documented?
3. Your teammate proposes reading `process.env.FEATURE_FLAG` directly inside a route handler. Give two concrete reasons to refuse, using this epoch's vocabulary.
4. Why can `buildApp()` be tested without a port, and why couldn't Epoch 01's server?

---

*Next: the `Map` dies. Restart the server, lose every task — time for real persistence, and everything it drags in: pools, migrations, transactions, injection. → [Epoch 03: Persistence](epoch-03-persistence.md)*
