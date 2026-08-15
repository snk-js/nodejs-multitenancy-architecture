# Epoch 11 — Shipping

> **You arrive with:** a production-grade architecture that has never actually been to production.
> **You leave with:** reproducible container builds, a CI pipeline where red means unmergeable, zero-downtime deploys, the expand/contract migration discipline, hardened HTTP and secrets posture, and backups you have *proven* restore.

---

## 11.1 The pain

"Works on my machine" is a statement about exactly one machine. Production needs: the same artifact running identically everywhere, changes that can ship many times a day without dropped requests (Epoch 08 built the drain; deployment must exploit it), schema changes that don't require downtime, and the paranoid basics — because Trellis now holds *other companies'* data, and Epochs 04–07's application-level security can all be undone by an exposed `.env` file or an unpatched dependency.

## 11.2 The container: one artifact, every environment

```dockerfile
# Dockerfile
# ---- build stage: dev deps allowed here, never shipped ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci                       # ci, not install: exact lockfile or fail loudly
COPY . .
RUN npm run typecheck && npm test

# ---- runtime stage: only what serving needs ----
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/src ./src
COPY --from=build /app/public ./public
COPY --from=build /app/migrations ./migrations

# 🛡️ never run as root: a container escape or RCE lands as an unprivileged user
USER node
EXPOSE 3000
CMD ["node", "--env-file=/dev/null", "src/server.js"]
```

The decisions inside:

- **Multi-stage**: dev dependencies (typescript, autocannon, test tooling) are attack surface and megabytes; the runtime image carries neither. What ships is the minimum that serves.
- **`npm ci`** installs *exactly* the lockfile or fails — the difference between "reproducible build" and "whatever the registry felt like today." The lockfile is a security document: it pins the entire dependency tree you audited.
- **`USER node`** — root-in-container is not the apocalypse, but it converts "attacker got RCE" into "attacker got RCE *as root*," and the fix is one line. Cheap insurance is bought automatically.
- The same image runs in staging and production; only environment differs (Epoch 02's config quarantine is what makes that clean). 🛡️ **Never bake secrets into images** — layers are effectively public to anyone who can pull; secrets arrive at runtime from the platform's secret store, and `.dockerignore` excludes `.env` (and `.git`) from the build context, mirroring `.gitignore`'s lesson: what enters an artifact's history is very hard to un-enter.

## 11.3 CI: the gates become law

Everything the course built as a command now runs on every push, and **red blocks merge** — a failing check you can override is a suggestion wearing a uniform:

```yaml
# .github/workflows/ci.yml (shape, not incantation)
jobs:
  verify:
    services:
      postgres: { image: postgres:17-alpine, ... }   # integration tests get a REAL db in CI too
      redis:    { image: redis:7-alpine, ... }
    steps:
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck          # Epoch 05's contract
      - run: npm run migrate && npm test  # incl. tenant-isolation suite — the crown jewels
      - run: npm audit --omit=dev --audit-level=high
      - run: docker build .             # the artifact builds, with tests inside it too
```

Notes with teeth:

- **The hostile tenant tests (Epoch 07) run here.** Cross-tenant isolation is now re-proven on *every commit forever*. This is what "tested architecture" means: properties, not promises. The RLS meta-test makes even *new tables* unable to merge unprotected.
- **`npm audit` as a gate**, because your app is mostly other people's code: the dependency tree is hundreds of packages, and known-CVE compromise of popular packages is a routine event, not a hypothetical. High-severity findings block; automated update PRs (Renovate/Dependabot) keep the tree current *through* the same test gauntlet — automation proposes, CI disposes.
- Speed is a feature of CI: a 40-minute pipeline gets bypassed culturally long before it gets bypassed technically. Parallelize (lint/typecheck/tests fan out), cache `node_modules` by lockfile hash, keep the whole thing under ~10 minutes.

## 11.4 Zero-downtime deploys — and the migration discipline that makes them real

Rolling deploys are mechanically simple with what Epoch 08 built: start new instances → readiness gates them in → drain old ones (SIGTERM → readiness off → in-flight completes) → done. No dropped requests, by construction.

The hard part deploys hide is the **database**, because during every rolling deploy, 🛡️ **old code and new code run against the same schema simultaneously.** `DROP COLUMN` in the same release that stops using the column ⇒ the still-running old instances crash on their next `SELECT`. The discipline is **expand/contract** — every schema change split into phases that are each compatible with both neighboring code versions:

```
Rename tasks.title → tasks.summary, with zero downtime:

  1. EXPAND    migration: ADD COLUMN summary; backfill; trigger keeps both in sync
  2. TRANSITION deploy: code writes both, reads summary       (old code still fine)
  3. CONTRACT  (next release) migration: DROP COLUMN title    (nothing reads it anymore)
```

Rules that fall out: migrations deploy *before* the code that needs them; every migration must be compatible with the *currently running* code; big-table backfills run in batches (a single `UPDATE` on 50M rows takes locks and replication lag you don't want to meet); and "rollback" for schema is *roll forward through the phases*, which is why `down` migrations stopped being the plan back in Epoch 03. Expand/contract feels bureaucratic exactly once — the first time you watch a rename ship with zero 500s.

Deployment strategy footnote: rolling is our default; blue/green (two full stacks, instant switch) and canary (1% → 10% → 100%, watching Epoch 10's SLO dashboards — this is *why* deploy markers belong on dashboards) are refinements of the same drain-and-gate machinery, not different worlds.

## 11.5 The hardening pass

A sweep of cheap, high-value armor — each item one line-ish, each guarding a named failure:

```ts
// @fastify/helmet — security headers
app.register(helmet, {
  contentSecurityPolicy: { /* default-src 'self' … */ },  // CSP: XSS blast-radius limiter
  hsts: { maxAge: 63072000 },                             // browsers refuse plain HTTP henceforth
});
// @fastify/cors — explicit allowlist, never "*" with credentials
app.register(cors, { origin: config.allowedOrigins, credentials: true });
```

- **TLS terminates at the load balancer/proxy**; internal hop is your infrastructure decision, but `trustProxy: true` must be set so `req.ip` and protocol detection read the `X-Forwarded-*` headers — otherwise Epoch 04's rate limiter is limiting your load balancer's IP. (Set it *only* when actually behind a proxy you control — trusting forged forwarded-headers from the open internet inverts the guardrail.)
- **Secrets management**: secrets live in the platform's secret store (cloud secret manager, k8s secrets), injected as env vars at runtime; `config.ts` remains the single doorway (Epoch 02 keeps paying). Rotation must be *possible* boringly — the session-token and webhook-secret designs (hashed at rest, per-endpoint secrets) were built for this. 🛡️ If a secret ever lands in git history: **rotate it immediately; do not "remove" it.** Forks, clones, reflogs, and scrapers already have it — history rewriting is cosmetics, rotation is the fix.
- **Backups: schedule ≠ have.** Automated Postgres backups + WAL archiving (point-in-time recovery), *and a periodically rehearsed restore* — an untested backup is a hope, not a plan, and the industry's backup-that-didn't-restore stories are legion. Know your RPO (data loss tolerance → backup frequency) and RTO (downtime tolerance → restore drill speed) as *numbers*; per-tenant restore requests ("we deleted everything, help") are a support reality in B2B — Epoch 07's soft-delete grace period is the first line; PITR-to-a-scratch-instance-then-extract is the second.

## 11.6 💥 Break it yourself

1. Build the image, then `docker run --rm -it <img> sh` and try `whoami` (→ `node`), `apk add anything` (→ denied). Try to find dev dependencies or `.env` in the image (→ absent). The artifact is boring; boring is the goal.
2. Ship a deliberate schema violation: write a migration that drops a column current code still reads, run the CI suite — the integration tests catch it *before* the rolling-deploy crash it would have caused. Then do the same change via expand/contract and watch it pass at every phase.
3. Deploy-drill locally: run two instances behind any proxy, loop `curl` at it, kill one instance. Zero failed requests = Epoch 08's drain + this epoch's gating, working together.
4. `npm audit` the project, read one real advisory end-to-end, and trace whether the vulnerable path is actually reachable in Trellis. (Learning to *triage* advisories beats both ignoring and panicking.)

## 11.7 ⚖️ Decision log

| Decision | Alternatives | Why |
|---|---|---|
| Multi-stage Alpine image, non-root, `npm ci` | Fat single-stage image, root, `npm install` | Minimal surface, reproducible tree, contained blast radius — each for one line of Dockerfile |
| Red-blocks-merge CI incl. isolation suite + audit | Advisory CI, manual security review | Properties enforced by machinery outlive teams; the crown-jewel tests must be un-skippable |
| Expand/contract migrations | Big-bang schema changes, downtime windows | Old+new code share the schema mid-deploy; compatibility per phase is the only honest contract |
| Rolling deploys on drain+readiness | Blue/green, canary from day one | Simplest thing that exploits the machinery we built; refinements slot in when scale demands |
| Rotate leaked secrets, never rewrite history | `git filter-repo` and hope | Copies you don't control already exist; only rotation changes the facts |

## 11.8 Checkpoint

1. Walk a rename through expand/contract, stating *for each phase* which code versions are live against which schema — and identify where the naive rename crashes.
2. Why is the lockfile a security artifact, and what specifically does `npm ci` guarantee that `npm install` doesn't?
3. Your `trustProxy` is unset behind a load balancer. Which two earlier-epoch mechanisms silently stop working, and how would Epoch 10's dashboards betray the symptom?
4. Argue "an untested backup is not a backup" with RPO/RTO vocabulary, and name the two-layer answer to a tenant's "we deleted everything" ticket.

---

*Next: the last epoch — the whole architecture on one page, the complete decision log, the request lifecycle end-to-end, and the honest map of what changes at 10× scale. → [Epoch 12: The Capstone Architecture](epoch-12-capstone.md)*
