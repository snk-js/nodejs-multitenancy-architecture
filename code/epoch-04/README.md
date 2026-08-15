# Snapshot — Epoch 04: Identity

Companion code for [`epochs/epoch-04-identity.md`](../../epochs/epoch-04-identity.md).

```bash
cp .env.example .env
docker compose up -d
npm install
npm run migrate
npm run dev

# register → login (cookie jar) → authed request → logout
curl -X POST localhost:3000/auth/register -H "content-type: application/json" \
  -d '{"email":"a@example.com","password":"correct-horse-battery"}'
curl -c jar.txt -X POST localhost:3000/auth/login -H "content-type: application/json" \
  -d '{"email":"a@example.com","password":"correct-horse-battery"}'
curl -b jar.txt localhost:3000/api/tasks
curl -b jar.txt -X POST localhost:3000/api/tasks -H "content-type: application/json" -d '{"title":"mine"}'
curl localhost:3000/api/tasks   # no cookie → 401: deny by default
```

What changed vs epoch-03: `diff -ru ../epoch-03 .`
— argon2id password hashing (+ timing-oracle dummy hash), hashed opaque session
tokens in httpOnly/lax cookies, a deny-by-default auth hook, per-IP+email login
rate limiting, and ownership enforced *inside* queries (`AND owner_id = $2` → 404).
