# Epoch 04 — Identity

> **You arrive with:** an API where everyone is everyone.
> **You leave with:** registration and login done to modern standard — argon2id hashing, hashed opaque session tokens in httpOnly cookies, CSRF posture, login rate limiting — plus the authn/authz distinction that multitenancy will be built on.

---

## 4.1 The pain

Trellis is meant for *teams*. Teams have members; members own tasks; strangers own nothing. Every question multitenancy will ask in Epochs 06–07 — *which workspace is this request acting in?* — presupposes today's question: **who is this request?**

Two words, forever distinct:

- **Authentication (authn):** who are you? (Today.)
- **Authorization (authz):** what may you do? (Started today, completed in Epochs 06–07.)

## 4.2 Passwords: the part everyone gets wrong

Rules first, mechanism second:

1. **Never store a password.** Store a hash — a one-way transform. A breach of hashes should be an inconvenience, not a catastrophe.
2. **Never use a general-purpose hash** (MD5, SHA-256 — even salted). They're built to be *fast*, and fast is precisely wrong: a GPU does billions of SHA-256/s. Password hashing must be deliberately **slow and memory-hungry**.
3. **Use argon2id.** Winner of the Password Hashing Competition, OWASP's first recommendation. (bcrypt remains acceptable; argon2id's memory-hardness is specifically hostile to GPU cracking.)

```bash
npm install argon2
```

```js
// src/services/password.js
import argon2 from "argon2";

// OWASP-recommended baseline: 19 MiB memory, 2 iterations, parallelism 1
const OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (plain) => argon2.hash(plain, OPTS);
export const verifyPassword = (hash, plain) => argon2.verify(hash, plain);
```

Details that are load-bearing:

- The salt is generated and **embedded in the output string** (`$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`) along with the parameters. No separate salt column; and because params are stored *per hash*, you can raise costs later and rehash users transparently at their next successful login.
- `argon2.verify` is **constant-time** in the comparison. Ordinary `===` on secrets leaks length/prefix information through response timing. Law for the course: **secrets are compared with constant-time functions only** (`crypto.timingSafeEqual` for raw buffers).
- Hashing is CPU-heavy *by design* — the library runs it on libuv's thread pool, so the event loop survives (Epoch 00's lesson applied). But note: that thread pool has 4 threads by default; a flood of hashes queues behind it. One more reason for §4.6's rate limiting.

## 4.3 ⚖️ Sessions vs JWTs — the decision, argued honestly

Two mainstream ways to keep a user logged in:

| | **Opaque session tokens (server-side state)** | JWTs (stateless, signed claims) |
|---|---|---|
| What the client holds | Random 256-bit string, meaningless by itself | Signed blob containing claims (userId, exp, …) |
| Server lookup per request | Yes — one indexed SELECT (or Redis GET) | None — verify signature, read claims |
| **Revocation** (logout, ban, breach response) | **Instant** — delete the row | Hard — token valid until `exp`; denylist reintroduces the state you removed |
| Session inspection ("log out all my devices") | Trivial — it's a table | Not really possible |
| Where stateless shines | — | Service-to-service calls, multi-service SSO, tokens verified by parties without DB access |
| Classic failure modes | — | `alg:none` bypasses, weak secrets, tokens in localStorage (XSS-readable), un-revokable leaks |

**We choose opaque server-side sessions.** Trellis is one backend talking to its own database; the JWT's whole payoff — skipping a DB lookup — buys us nothing measurable while costing us instant revocation, which a multi-tenant B2B product *will* need ("employee left, kill their access **now**" is a sales-blocking security question). JWTs are a fine tool we decline for cause, not fashion; they reappear in Epoch 09 for signed webhooks and in service-to-service contexts.

## 4.4 The sessions table — with the subtlety that matters

```js
// migrations/...._users-and-sessions.js
export const up = (pgm) => {
  pgm.createTable("users", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    email: { type: "citext", notNull: true, unique: true }, // citext: case-insensitive
    password_hash: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("sessions", {
    token_hash: { type: "text", primaryKey: true },  // ← hash, never the token
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    expires_at: { type: "timestamptz", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("sessions", ["user_id"]);
  pgm.createIndex("sessions", ["expires_at"]);
};
```

🛡️ **We store a SHA-256 of the session token, not the token.** The session token is a *credential*. If your database (or a backup, or a read replica, or a log line) leaks, plaintext tokens let the attacker *become every logged-in user*. Hashes don't. Unlike passwords, tokens are 256 random bits — uncrackable by brute force — so fast SHA-256 is correct here; argon2's slowness is only needed against *low-entropy* human passwords. Two hash use-cases, two different tools, both now justified from first principles.

```js
// src/services/session.js
import { randomBytes, createHash } from "node:crypto";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export const newSessionToken = () => randomBytes(32).toString("base64url");
export const hashToken = (t) => createHash("sha256").update(t).digest("hex");
export const sessionExpiry = () => new Date(Date.now() + SESSION_TTL_MS);
```

(`randomBytes` = CSPRNG. `Math.random()` is predictable and has produced real, exploited session-token vulnerabilities. Non-negotiable.)

## 4.5 Login, logout, and the cookie that carries it all

```js
// src/routes/auth.js (core handlers; schemas as in Epoch 02)
app.post("/auth/register", { schema: registerSchema }, async (req, reply) => {
  const { email, password } = req.body;
  const password_hash = await hashPassword(password);
  try {
    const user = await users.create({ email, password_hash });
    return reply.code(201).send({ id: user.id, email: user.email });
  } catch (err) {
    if (err.code === "23505") { // unique_violation
      // 🛡️ same shape as success-ish paths; see enumeration note below
      return reply.code(409).send({ error: "email already registered" });
    }
    throw err;
  }
});

app.post("/auth/login", { schema: loginSchema }, async (req, reply) => {
  const user = await users.findByEmail(req.body.email);
  // 🛡️ Burn a hash verification even when the user doesn't exist,
  // so "unknown email" and "wrong password" take the same time.
  const hash = user?.password_hash ?? DUMMY_ARGON2_HASH;
  const ok = await verifyPassword(hash, req.body.password);
  if (!user || !ok) {
    return reply.code(401).send({ error: "invalid email or password" }); // one message for both
  }

  const token = newSessionToken();
  await sessions.create({ token_hash: hashToken(token), user_id: user.id, expires_at: sessionExpiry() });

  reply.setCookie("session", token, {
    httpOnly: true,                 // JS cannot read it → XSS can't exfiltrate it
    secure: config.env !== "development", // HTTPS-only outside dev
    sameSite: "lax",                // browser omits it on cross-site POSTs → CSRF baseline
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return { id: user.id, email: user.email };
});

app.post("/auth/logout", async (req, reply) => {
  if (req.cookies.session) await sessions.delete(hashToken(req.cookies.session));
  reply.clearCookie("session", { path: "/" });
  return { ok: true };
});
```

The security choices, unpacked:

- **Account enumeration.** "Invalid email or password" — never "no such user" — and the dummy-hash trick keeps *timing* from telling the two apart (a missing user would otherwise return in 2ms vs ~50ms for a real hash check). Enumeration feels minor until you realize attacker step 1 is always "build a list of valid emails."
- **`httpOnly`** is the reason cookies beat `localStorage` for credentials: any XSS can read localStorage; httpOnly cookies are invisible to page JavaScript.
- **`sameSite: "lax"`** is the modern CSRF baseline: cross-site `POST`s don't carry the cookie, so `evil.com` can't submit forms as your user. State-changing endpoints must be non-GET (Lax still sends cookies on top-level GET navigations) — which REST semantics already demand. Defense-in-depth (origin-header checks / explicit CSRF tokens) matters if you ever loosen to `None` for cross-site embedding.
- **`secure`** — a cookie sent over plain HTTP can be read by any network middlebox. Dev-only exemption, explicitly derived from config.

## 4.6 The authentication gate + login rate limiting

```js
// src/plugins/auth.js
export async function authPlugin(app) {
  app.decorateRequest("user", null);

  app.addHook("preHandler", async (req, reply) => {
    if (isPublic(req)) return; // /health, /auth/*, /public/*
    const token = req.cookies.session;
    if (!token) return reply.code(401).send({ error: "authentication required" });

    const session = await sessions.findValid(hashToken(token)); // WHERE token_hash=$1 AND expires_at > now()
    if (!session) {
      reply.clearCookie("session", { path: "/" });
      return reply.code(401).send({ error: "session expired" });
    }
    req.user = { id: session.user_id };
  });
}
```

🛡️ **Deny by default.** The hook runs on *every* route; public paths are the explicit allowlist. The inverted design — "remember to add `requireAuth` to each private route" — fails exactly once per forgotten route, silently, in the direction of exposure. Secure systems make the *safe* state the *default* state. (This plugin is also the socket where Epoch 06 will plug tenant resolution: first *who*, then *which workspace*.)

And because login is the internet's most-attacked endpoint:

```js
// on /auth/* routes — @fastify/rate-limit
app.register(rateLimit, {
  max: 10, timeWindow: "1 minute",
  keyGenerator: (req) => `${req.ip}:${req.body?.email ?? ""}`,
});
```

Credential stuffing (replaying billions of leaked email/password pairs) is a *when*, not an *if*. Per-IP+email limiting slows it by orders of magnitude without hurting real users. (Distributed limiting across instances → Redis, Epoch 08.)

## 4.7 Authorization: the shape of what's coming

With `req.user` populated, ownership becomes expressible:

```sql
-- ❌ two-step: SELECT owner, compare in JS, then act   → race-prone, verbose, leaky
-- ✅ one-step: authorization inside the query
UPDATE tasks SET done = $3 WHERE id = $1 AND owner_id = $2 RETURNING ...
```

Zero rows updated ⇒ not yours (or absent) ⇒ 404. 🛡️ Return **404, not 403**, for resources the caller can't see: a 403 on `/api/tasks/<guessed-id>` confirms the ID exists — an information leak. "Doesn't exist" and "not yours" should be indistinguishable from outside.

This `AND owner_id = $2` pattern — *the predicate travels inside the query* — is, scaled up, exactly how tenant isolation will work. Epoch 06 makes it systematic (`tenant_id` on every table, `AsyncLocalStorage` carrying the context), and Epoch 07 makes it *unforgettable* by pushing it into the database (RLS). Today's WHERE clause is the seed of the whole architecture.

## 4.8 💥 Break it yourself

1. Try to read the session cookie from browser devtools: `document.cookie` → empty. That's `httpOnly` doing its one job.
2. Log in from two browsers, then delete the sessions row from browser A. Refresh A: instantly logged out. *This* is the revocation JWTs can't give you — you just watched the trade-off table's decisive row happen.
3. Time a login for a nonexistent email with the dummy-hash line commented out vs in (`curl -w "%{time_total}"`). Watch the timing oracle appear and disappear.
4. `PATCH` another user's task id: confirm 404, and confirm the response is byte-identical to a truly nonexistent id.

## 4.9 ⚖️ Decision log

| Decision | Alternatives | Why |
|---|---|---|
| argon2id, OWASP params | bcrypt, scrypt, SHA-anything | Memory-hard → GPU-hostile; params embedded → upgradable; SHA-fast is disqualifying for passwords |
| Opaque sessions, hashed at rest | JWT access+refresh | Instant revocation & session inventory beat a saved SELECT for a single-backend SaaS; DB leak ≠ credential leak |
| Cookies (`httpOnly`+`lax`+`secure`) | Bearer token in localStorage | localStorage is XSS-readable; cookie flags give XSS- and CSRF-resistance in three words |
| Deny-by-default auth hook | Per-route guards | Forgetting a guard fails open; forgetting an allowlist entry fails closed. Choose the failure you can live with |
| 404 for unauthorized object access | 403 | Don't confirm resource existence to non-owners |

## 4.10 Checkpoint

1. Why is a *fast* hash wrong for passwords but *right* for session tokens? (Two different threat models — name them.)
2. Walk the full CSRF story: what does `sameSite: "lax"` block, what does it *not* block, and why must state changes never ride on GET?
3. An engineer proposes JWTs "so we can drop the session lookup." Using §4.3, name the two capabilities you'd be giving up and the question a B2B security review will ask.
4. Why does the login handler hash a dummy password for unknown emails?

---

*Next: the codebase is now big enough to fear changing. Types and tests turn fear into refactoring — and build the harness every later epoch's claims will be verified with. → [Epoch 05: TypeScript & Testing](epoch-05-typescript-and-testing.md)*
