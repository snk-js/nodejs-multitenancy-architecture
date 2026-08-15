# Snapshot — Epoch 03: Persistence

Companion code for [`epochs/epoch-03-persistence.md`](../../epochs/epoch-03-persistence.md).

```bash
cp .env.example .env
docker compose up -d          # PostgreSQL 17
npm install
npm run migrate               # versioned, once-only schema history
npm run dev

curl -X POST localhost:3000/api/tasks -H "content-type: application/json" -d '{"title":"survives restarts now"}'
# restart the server — the task is still there. The Map is dead.
```

What changed vs epoch-02: `diff -ru ../epoch-02 .`
— the `Map` became PostgreSQL behind a repository factory, `migrations/` appeared,
and `withTransaction` (src/db/tx.js) demonstrates same-client transaction discipline.
