# Snapshot — Epoch 06: Multitenancy I — Models & Context

Companion code for [`epochs/epoch-06-multitenancy-foundations.md`](../../epochs/epoch-06-multitenancy-foundations.md).

```bash
cp .env.example .env
docker compose up -d
npm install && npm run migrate
npm run typecheck && npm test
npm run dev

# tenants resolve by subdomain — *.localtest.me resolves to 127.0.0.1 with zero setup:
curl -c jar.txt -X POST localhost:3000/auth/register -H "content-type: application/json" \
  -d '{"email":"a@example.com","password":"correct-horse-battery"}'
curl -c jar.txt -X POST localhost:3000/auth/login -H "content-type: application/json" \
  -d '{"email":"a@example.com","password":"correct-horse-battery"}'
curl -b jar.txt -X POST localhost:3000/workspaces -H "content-type: application/json" \
  -d '{"slug":"acme","name":"Acme Corp"}'
curl -b jar.txt http://acme.localtest.me:3000/api/tasks
```

What changed vs epoch-05: `diff -ru ../epoch-05 .`
— workspaces + memberships (users↔tenants are many-to-many; roles live on the seat),
`tenant_id` on every tenant-owned table with tenant-leading indexes, subdomain→membership
tenant resolution, `AsyncLocalStorage` request context, and `test/tenant-isolation.test.ts`:
the spec Epoch 07's RLS must keep passing.
