# Snapshot — Epoch 11: Shipping

Companion code for [`epochs/epoch-11-shipping.md`](../../epochs/epoch-11-shipping.md).

```bash
cp .env.example .env
docker compose up -d
npm install && npm run migrate
npm run typecheck && npm test

docker build -t trellis .          # multi-stage, non-root, npm ci, no dev deps
docker run --rm -it trellis sh -c "whoami && ls"   # → node; no .env, no tests

# the CI pipeline (.github/workflows/ci.yml) runs typecheck + migrations +
# the full suite (incl. RLS crown jewels) + npm audit + the image build,
# against real Postgres/Redis service containers. Red blocks merge.
```

What changed vs epoch-10: `diff -ru ../epoch-10 .`
— `Dockerfile` (multi-stage, `USER node`, `npm ci`), `.dockerignore` (secrets never
enter layers), the CI gate, `@fastify/helmet` + explicit-allowlist CORS, and
`trustProxy` wired from config (only behind a proxy you control).

This snapshot IS the finished Trellis backend — Epoch 12 is the guided tour of it.
