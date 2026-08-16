# `local-lab/` — The Whole Architecture on One Laptop

Runnable companion to [deep-dive 06](../deep-dives/06-running-it-all-locally.md). It boots the finished system ([`code/epoch-11`](../code/epoch-11)) as a small production: **two API replicas** behind a proxy, a worker process, Postgres reached *through a fault injector*, Redis, tracing, and a fake inbox — then gives you a Makefile of experiments that induce each failure mode from the course on demand.

```bash
cd local-lab
make up      # build + migrate + start everything
make seed    # ~1M tasks, skewed: whale / mid / minnow
make smoke   # prove it's alive
make experiments   # the lab manual
```

| Surface | URL |
|---|---|
| App (tenant subdomains) | `http://acme.localtest.me:8080`, `http://globex.localtest.me:8080` |
| Traces (Jaeger) | http://localhost:16686 |
| Fake inbox (Mailpit) | http://localhost:8025 |
| Fault injection (Toxiproxy API) | http://localhost:8474 |

`*.localtest.me` resolves to `127.0.0.1` with **zero DNS setup**, so tenant resolution runs the real Epoch 06 subdomain path locally.

## Why it's built this way

- **Two API replicas, always.** A single instance hides every distributed bug — unshared rate-limit counters, cache races, connection-count arithmetic. Two replicas plus one proxy is the cheapest production simulator that exists.
- **Postgres behind Toxiproxy.** Free when idle; one `curl` away from a 500ms database or 30% connection loss. Failure becomes something you *schedule*, not something that happens to you.
- **Migrations run as the owner, the app runs as `trellis_app`.** Epoch 07's privilege split is real here — which is what makes RLS actually enforce rather than decorate.
- **Tracing on from the first boot.** Everything Epoch 10 and deep-dive 04 describe is invisible until you can click a waterfall.

## Seed data shape

Deliberately skewed, because uniform data teaches nothing:

| Tenant | Tasks | Role in the lab |
|---|---|---|
| `acme` | ~900,000 | the whale — index behaviour, noisy neighbour, query plans |
| `globex` | ~95,000 | the mid-market tenant |
| `initech` | ~500 | the minnow — what "it's fast on my machine" looks like |

Plus a consultant user who is a **member of two workspaces** — because users are *people*, not tenants (Epoch 06). Every seeded user's password is `correct-horse-battery`.

The seed itself is the first lesson: `tasks` has `FORCE ROW LEVEL SECURITY`, so even the table owner must stamp `app.tenant_id` before inserting — and the script ends by proving that an unstamped `SELECT count(*)` returns **0**, not everything.

## Experiment catalogue

Each target maps to an epoch and takes minutes:

```
make rls-check        Epoch 07  an UNSCOPED query stays scoped anyway
make explain          Epoch 03  index scan vs seq scan + sort on ~1M rows
make pool-exhaustion  Epoch 03  slow queries pin the pool; healthy endpoints starve
make noisy-neighbor   Epoch 07  one tenant degrades another — then the limiter fixes it
make chaos-latency    Epoch 08  +500ms on every database call
make chaos-drop       Epoch 08  30% of database connections die
make chaos-clear                remove all injected faults
make db-down / db-up  Epoch 08  liveness stays 200, readiness goes 503, recovery needs no restart
make drain-drill      Epoch 08  SIGTERM mid-traffic must drop zero requests
```

The governing idea: **shrink the limits instead of growing the load.** A pool of 2 and a 10-second query teach you what 10,000 concurrent users would — on a laptop, in ten seconds, with a debugger attached.

## Requirements & status

- Docker + Docker Compose v2, `curl`, `make`. (`make noisy-neighbor` uses `npx autocannon`.)
- Builds from `../code/epoch-11`, so it inherits that snapshot's Node 24 image.

> **Verification status:** the compose/Toxiproxy/Caddy configs and the Makefile targets are validated (YAML/JSON parse, targets resolve, referenced npm scripts and runtime dependencies confirmed present in the epoch-11 image), but the lab has **not** been executed end-to-end in the authoring environment — no Docker daemon was available there. Expect to fix small things on first run; open an issue (or fix inline) if a target misbehaves.
