import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { makeTestApp } from "./helpers/test-app.ts";

let t: Awaited<ReturnType<typeof makeTestApp>>;
before(async () => { t = await makeTestApp(); });
after(async () => { await t.cleanup(); });

test("register → login → authed request → logout lifecycle", async () => {
  const reg = await t.app.inject({
    method: "POST", url: "/auth/register",
    payload: { email: "a@example.com", password: "correct-horse-battery" },
  });
  assert.equal(reg.statusCode, 201);

  const login = await t.app.inject({
    method: "POST", url: "/auth/login",
    payload: { email: "a@example.com", password: "correct-horse-battery" },
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.cookies.find((c) => c.name === "session");
  assert.ok(cookie, "login must set a session cookie");
  // 🛡️ security properties are testable — pin them:
  assert.ok(cookie.httpOnly, "session cookie must be httpOnly");
  assert.equal(cookie.sameSite?.toLowerCase(), "lax");

  const list = await t.app.inject({
    method: "GET", url: "/workspaces",
    cookies: { session: cookie.value },
  });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json(), []);

  const out = await t.app.inject({
    method: "POST", url: "/auth/logout",
    cookies: { session: cookie.value },
  });
  assert.equal(out.statusCode, 200);

  const afterLogout = await t.app.inject({
    method: "GET", url: "/workspaces",
    cookies: { session: cookie.value },
  });
  assert.equal(afterLogout.statusCode, 401); // 🛡️ instant revocation — the sessions-table payoff
});

test("wrong password and unknown email are indistinguishable", async () => {
  const a = await t.app.inject({
    method: "POST", url: "/auth/login",
    payload: { email: "a@example.com", password: "wrong-password" },
  });
  const b = await t.app.inject({
    method: "POST", url: "/auth/login",
    payload: { email: "ghost@example.com", password: "wrong-password" },
  });
  assert.equal(a.statusCode, 401);
  assert.equal(b.statusCode, 401);
  assert.deepEqual(a.json(), b.json()); // 🛡️ enumeration defense, enforced forever
});

test("unauthenticated API access is denied by default", async () => {
  const res = await t.app.inject({ method: "GET", url: "/api/tasks" });
  assert.equal(res.statusCode, 401);
});
