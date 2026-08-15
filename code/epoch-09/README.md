# Snapshot — Epoch 09: Async Work

Companion code for [`epochs/epoch-09-async-work.md`](../../epochs/epoch-09-async-work.md).

```bash
cp .env.example .env
docker compose up -d
npm install && npm run migrate
npm run typecheck && npm test

npm run dev       # terminal 1: the API
npm run worker    # terminal 2: the worker tier (separate process, on purpose)

# invite flow: request records intent (membership + outbox, ONE commit);
# the relay moves it to BullMQ; the worker "sends" the email idempotently.
# Watch terminal 2 after:
curl -b jar.txt -X POST http://acme.localtest.me:3000/api/invites \
  -H "content-type: application/json" -d '{"email":"invitee@example.com"}'
```

What changed vs epoch-08: `diff -ru ../epoch-08 .`
— `outbox` + `processed_jobs` tables, `src/jobs/` (BullMQ queue, relay, worker with
tenant re-validation + context rebuild), the invite flow demonstrating the outbox
pattern end-to-end, and HMAC webhook signing with replay defense
(`src/services/webhook-signature.ts`).
