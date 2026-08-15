# The Evolution of a Backend

**A course in 13 epochs: from a single `server.js` to a production-ready, multi-tenant Node.js architecture — with the *why* behind every step.**

---

## The premise

Most architecture guides show you the finished cathedral. You see the folder structure, the layers, the patterns — but not the ten thousand small failures that made each of them necessary. So the patterns feel arbitrary, and you cargo-cult them.

This course does the opposite. We build **one product** — *Trellis*, a multi-tenant task-tracking SaaS — and we build it the way real systems are actually built: starting embarrassingly simple, and evolving only when the current design **hurts**. Every epoch begins with the pain the previous epoch created, introduces exactly the concepts needed to fix it, and ends with guardrails and edge cases you'd otherwise learn in production at 3 a.m.

By the final epoch you will have, purely by reading and building along, a complete mental model of a performant, testable, observable, multi-tenant backend — and, more importantly, you'll know *why every piece exists* and what breaks without it.

## The rules of the course

1. **Nothing appears before its pain does.** No framework before hand-rolled routing hurts. No ORM before raw SQL hurts. No queue before slow requests hurt.
2. **The final quality bar is never compromised.** Simplicity early ≠ sloppiness. Each epoch's code is the *correct* code for that epoch's constraints.
3. **Every decision shows its alternatives.** When we pick Fastify, Postgres RLS, or opaque session tokens, you'll see what we rejected and the trade-off table that decided it.
4. **Edge cases are first-class content.** Path traversal, connection-pool exhaustion, cross-tenant leaks, thundering herds, poison messages — each epoch has a "what goes wrong" section.
5. **Latest stable everything.** Node.js 24 (LTS), ESM modules, Fastify 5, TypeScript (native type-stripping), PostgreSQL 17, Drizzle, Redis 7, BullMQ, OpenTelemetry.

## The map

| Epoch | Title | You arrive with… | You leave with… |
|---|---|---|---|
| 00 | [The Primordial Server](epochs/epoch-00-the-primordial-server.md) | Nothing | A raw `node:http` server serving HTML; a real mental model of request/response, streams, and the event loop |
| 01 | [Routing by Hand & the Limits of DIY](epochs/epoch-01-routing-by-hand.md) | One endpoint | A hand-rolled router, static files, JSON bodies — and a scar-tissue list of why frameworks exist |
| 02 | [The MVP](epochs/epoch-02-the-mvp.md) | A pile of `if` statements | Fastify 5, schema validation, central error handling, validated config, a testable app factory |
| 03 | [Persistence](epochs/epoch-03-persistence.md) | Data in a `Map` | PostgreSQL, migrations, a repository layer, transactions, pooling — and SQL-injection immunity |
| 04 | [Identity](epochs/epoch-04-identity.md) | Anonymous requests | Real authn/authz: argon2, sessions vs JWTs (and why we chose what we chose), cookies, CSRF, RBAC |
| 05 | [TypeScript & Testing](epochs/epoch-05-typescript-and-testing.md) | "It works on my machine" | Strict TS, unit + integration tests, ephemeral test databases, code that's safe to change |
| 06 | [Multitenancy I: Models & Context](epochs/epoch-06-multitenancy-foundations.md) | A single-tenant app | The three isolation models and their trade-offs; tenant resolution; `AsyncLocalStorage` tenant context |
| 07 | [Multitenancy II: Enforcement](epochs/epoch-07-multitenancy-enforcement.md) | Tenancy by convention | Tenancy by *construction*: Postgres Row-Level Security, defense in depth, cross-tenant leak tests |
| 08 | [Reliability & Performance](epochs/epoch-08-reliability-and-performance.md) | A server that works when everything works | Timeouts, graceful shutdown, health checks, caching, rate limits, backpressure, load-test numbers |
| 09 | [Async Work](epochs/epoch-09-async-work.md) | Slow requests doing too much | BullMQ workers, the outbox pattern, idempotency, webhooks, dead-letter queues |
| 10 | [Observability](epochs/epoch-10-observability.md) | `console.log` archaeology | Structured logs with request+tenant correlation, OpenTelemetry traces, RED metrics, SLOs |
| 11 | [Shipping](epochs/epoch-11-shipping.md) | Code on a laptop | Multi-stage Docker, CI gates, expand/contract migrations, zero-downtime deploys, security hardening |
| 12 | [The Capstone Architecture](epochs/epoch-12-capstone.md) | All the pieces | The complete blueprint: final tree, request lifecycle, the full decision log, and the 10× scaling roadmap |

## Beyond the epochs

- **[`code/`](code/README.md)** — a runnable snapshot of Trellis per epoch. Each directory is the previous one plus that epoch's changes, so the evolution itself is diffable: `diff -ru code/epoch-06 code/epoch-07` shows RLS arriving, line by line.
- **[`deep-dives/`](deep-dives/README.md)** — research-backed extensions: advanced auth architectures (OAuth 2.1, BFF, enterprise SSO/SCIM, passkeys), the backend's job in a microfrontend world (assets, version skew, federation vs zones), and what modern Next.js solves for multitenancy & microfrontends.

## How to use this course

- **Read in order.** Epochs deliberately depend on the pain of previous ones. Skipping ahead gives you answers without questions.
- **Build along.** Every epoch contains complete, runnable code. Type it, run it, break it. The "Break it yourself" prompts are not optional decoration — inducing the failure is how the guardrail sticks.
- **Use the checkpoints.** Each epoch ends with questions. If you can't answer them, the next epoch will feel arbitrary — reread before moving on.
- **Argue with the decisions.** Every major choice includes its rejected alternatives. If you'd choose differently, good — you now know the axis you're trading on.

## Prerequisites

- Comfortable JavaScript (functions, promises, `async/await`).
- A terminal, `git`, and `curl`.
- **Node.js 24 LTS** (`node --version` → `v24.x`).
- **Docker** (from Epoch 03 onward, for PostgreSQL and Redis).
- No prior backend experience required — that's what Epoch 00 is for.

## Conventions

- ESM everywhere (`"type": "module"`), `node:` prefixes on core imports.
- Code blocks show the **file path** in the first comment line.
- `# terminal` blocks are commands you run; output shown when it matters.
- 💥 marks a failure you should reproduce. 🛡️ marks a guardrail. ⚖️ marks a decision with a trade-off table.

---

*Start here → [Epoch 00: The Primordial Server](epochs/epoch-00-the-primordial-server.md)*
