# Snapshot — Epoch 01: Routing by Hand & the Limits of DIY

Companion code for [`epochs/epoch-01-routing-by-hand.md`](../../epochs/epoch-01-routing-by-hand.md).

```bash
npm run dev

curl http://localhost:3000/health
curl -X POST http://localhost:3000/api/tasks \
  -H "content-type: application/json" -d '{"title":"first task"}'
curl http://localhost:3000/api/tasks

# 💥 the path-traversal probe (blocked — try commenting out the guard):
curl --path-as-is "http://localhost:3000/public/../server.js"
```

No dependencies. Requires Node.js ≥ 22.
Data lives in a `Map` — restart the process and it's gone. That pain is Epoch 03's motivation.
