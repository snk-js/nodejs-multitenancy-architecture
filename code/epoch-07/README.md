# Snapshot — Epoch 07: Multitenancy II — Enforcement

Companion code for [`epochs/epoch-07-multitenancy-enforcement.md`](../../epochs/epoch-07-multitenancy-enforcement.md).

```bash
cp .env.example .env
docker compose up -d
npm install && npm run migrate     # migrations run as the OWNER role
npm run typecheck && npm test      # includes the hostile RLS suite (test/rls.test.ts)
npm run dev                        # the app connects as trellis_app — subject to RLS
```

What changed vs epoch-06: `diff -ru ../epoch-06 .`
— `migrations/1700000000005_row-level-security.js` enables + FORCEs RLS on tasks and
splits privileges (owner migrates, `trellis_app` serves), `src/db/tenant-db.ts` stamps a
per-request transaction with `set_config('app.tenant_id', $1, true)`, and `test/rls.test.ts`
proves: unscoped queries stay scoped, cross-tenant inserts are rejected, missing context
yields ZERO rows, and any new `workspace_id` table without RLS fails CI (meta-test).
