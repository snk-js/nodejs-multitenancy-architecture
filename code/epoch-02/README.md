# Snapshot — Epoch 02: The MVP

Companion code for [`epochs/epoch-02-the-mvp.md`](../../epochs/epoch-02-the-mvp.md).

```bash
npm install
npm run dev

# schema validation in action — four different 400s, none hand-written:
curl -X POST localhost:3000/api/tasks -H "content-type: application/json" -d '{"title":""}'
curl -X POST localhost:3000/api/tasks -H "content-type: application/json" -d '{"title":42}'
curl -X POST localhost:3000/api/tasks -H "content-type: application/json" -d '{}'
curl -X POST localhost:3000/api/tasks -H "content-type: application/json" -d '{"title":"x","hacker":true}'
```

What changed vs epoch-01: `diff -ru ../epoch-01 .`
