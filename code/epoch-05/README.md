# Snapshot — Epoch 05: TypeScript & Testing

Companion code for [`epochs/epoch-05-typescript-and-testing.md`](../../epochs/epoch-05-typescript-and-testing.md).

```bash
cp .env.example .env
docker compose up -d
npm install
npm run migrate
npm run typecheck     # tsc checks; Node RUNS the .ts files natively (type stripping)
npm test              # unit + integration against a real Postgres, ephemeral schema per file
npm run dev
```

Requires Node.js ≥ 22.18 (native TypeScript type-stripping).

What changed vs epoch-04: `diff -ru ../epoch-04 .`
— everything is `.ts` under `strict`, Drizzle infers row types from `src/db/schema.ts`
(rename a column → compile errors at every stale usage), and the test suite pins the
security decisions of Epoch 04 as executable assertions (`test/auth.test.ts`).

Note: migrations stay on `node-pg-migrate` for continuity with epoch-03/04 diffs.
The course text discusses `drizzle-kit generate` as the schema-diffing alternative —
either way, migrations remain ordered, reviewed SQL-equivalent files in git.
