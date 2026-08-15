// The spec Epoch 07 must keep passing: cross-tenant reads and writes are
// impossible. At this epoch the guarantee rests on repository convention;
// the next epoch moves it into the database itself (RLS).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { makeTestApp, type TestApp } from "./helpers/test-app.ts";

let t: TestApp;
before(async () => { t = await makeTestApp(); });
after(async () => { await t.cleanup(); });

interface Actor { cookie: string; slug: string }

async function makeTenant(email: string, slug: string): Promise<Actor> {
  await t.app.inject({
    method: "POST", url: "/auth/register",
    payload: { email, password: "correct-horse-battery" },
  });
  const login = await t.app.inject({
    method: "POST", url: "/auth/login",
    payload: { email, password: "correct-horse-battery" },
  });
  const cookie = login.cookies.find((c) => c.name === "session")!.value;
  const ws = await t.app.inject({
    method: "POST", url: "/workspaces",
    cookies: { session: cookie },
    payload: { slug, name: slug },
  });
  assert.equal(ws.statusCode, 201);
  return { cookie, slug };
}

const asTenant = (actor: Actor, opts: {
  method: "GET" | "POST" | "PATCH"; url: string; payload?: unknown;
}) =>
  t.app.inject({
    method: opts.method,
    url: opts.url,
    headers: { host: `${actor.slug}.localtest.me` }, // subdomain names the venue…
    cookies: { session: actor.cookie },              // …membership grants entry
    payload: opts.payload as never,
  });

test("a member of acme can never see globex tasks", async () => {
  const acme = await makeTenant("acme-owner@example.com", "acme");
  const globex = await makeTenant("globex-owner@example.com", "globex");

  await asTenant(globex, { method: "POST", url: "/api/tasks", payload: { title: "secret globex plan" } });

  const list = await asTenant(acme, { method: "GET", url: "/api/tasks" });
  assert.equal(list.statusCode, 200);
  const titles = (list.json() as { title: string }[]).map((t) => t.title);
  assert.equal(titles.some((x) => x.includes("globex")), false);
});

test("acme cannot mutate a globex task even with its exact id", async () => {
  const acme = await makeTenant("acme-2@example.com", "acme-two");
  const globex = await makeTenant("globex-2@example.com", "globex-two");

  const created = await asTenant(globex, {
    method: "POST", url: "/api/tasks", payload: { title: "globex task" },
  });
  const task = created.json() as { id: string };

  // 🛡️ a leaked UUID must not be a capability
  const res = await asTenant(acme, {
    method: "PATCH", url: `/api/tasks/${task.id}/done`, payload: { done: true },
  });
  assert.equal(res.statusCode, 404);

  const check = await asTenant(globex, { method: "GET", url: "/api/tasks" });
  const rows = check.json() as { id: string; done: boolean }[];
  assert.equal(rows.find((r) => r.id === task.id)?.done, false); // unchanged
});

test("a non-member resolving a real workspace subdomain gets 404, not 403", async () => {
  await makeTenant("real-ws@example.com", "realws");
  const outsider = await makeTenant("outsider@example.com", "outsider-ws");

  const res = await asTenant({ cookie: outsider.cookie, slug: "realws" }, {
    method: "GET", url: "/api/tasks",
  });
  assert.equal(res.statusCode, 404); // existence-hiding at tenant scale
});
