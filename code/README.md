# `code/` — Runnable Snapshots per Epoch

One self-contained project per epoch. Each snapshot is the previous one **plus that
epoch's changes**, so the evolution itself is diffable:

```bash
diff -ru code/epoch-03 code/epoch-04     # watch identity arrive
diff -ru code/epoch-06 code/epoch-07     # watch RLS take over enforcement
```

| Snapshot | State of Trellis | Verified how |
|---|---|---|
| `epoch-00` | Raw `node:http`, one HTML response | runs with zero deps |
| `epoch-01` | Hand-rolled router, static files, JSON bodies, traversal guard | runs with zero deps |
| `epoch-02` | Fastify 5, schemas (reject-unknown-fields), error funnel, config | runs; `app.inject` |
| `epoch-03` | PostgreSQL, migrations, repository factories, transactions | needs Docker |
| `epoch-04` | argon2 + hashed sessions + cookies + deny-by-default gate | needs Docker |
| `epoch-05` | Strict TS (native type-stripping), Drizzle, unit+integration tests | `tsc` clean; unit tests pass |
| `epoch-06` | Workspaces, memberships, subdomain resolution, ALS context | `tsc` clean |
| `epoch-07` | Row-Level Security, split db roles, hostile isolation suite | `tsc` clean |
| `epoch-08` | Timeouts, graceful drain, live/ready, cache, per-tenant limits | `tsc` clean |
| `epoch-09` | BullMQ workers, outbox, idempotency, signed webhooks | `tsc` clean; unit tests pass |
| `epoch-10` | pino + ALS mixin + redaction, OpenTelemetry bootstrap | `tsc` clean |
| `epoch-11` | Dockerfile, CI gate, helmet/CORS, trustProxy — **the final system** | `tsc` clean |
| `epoch-12` | No new code: the capstone tour of epoch-11 | — |

## Requirements

- **Node.js ≥ 22.18** (native TypeScript type-stripping from epoch-05 onward; Node 24 recommended)
- **Docker** from epoch-03 onward (`docker compose up -d` inside the snapshot)

## Per-snapshot workflow

```bash
cd code/epoch-07
cp .env.example .env
docker compose up -d
npm install
npm run migrate
npm run typecheck && npm test   # from epoch-05 onward
npm run dev
```

Each snapshot's own `README.md` lists epoch-specific commands (the worker process in
epoch-09, the OTLP backend in epoch-10, the image build in epoch-11) and the curl
sequences from the epoch's 💥 break-it-yourself sections.
