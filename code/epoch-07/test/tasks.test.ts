import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { makeTestApp, type TestApp } from "./helpers/test-app.ts";

let t: TestApp;
let cookie: string;
const SLUG = "task-crud-ws";

before(async () => {
  t = await makeTestApp();
  await t.app.inject({
    method: "POST", url: "/auth/register",
    payload: { email: "crud@example.com", password: "correct-horse-battery" },
  });
  const login = await t.app.inject({
    method: "POST", url: "/auth/login",
    payload: { email: "crud@example.com", password: "correct-horse-battery" },
  });
  cookie = login.cookies.find((c) => c.name === "session")!.value;
  await t.app.inject({
    method: "POST", url: "/workspaces",
    cookies: { session: cookie },
    payload: { slug: SLUG, name: "CRUD test" },
  });
});
after(async () => { await t.cleanup(); });

const inWorkspace = (opts: { method: "GET" | "POST" | "PATCH"; url: string; payload?: unknown }) =>
  t.app.inject({
    method: opts.method,
    url: opts.url,
    headers: { host: `${SLUG}.localtest.me` },
    cookies: { session: cookie },
    payload: opts.payload as never,
  });

test("task lifecycle inside a workspace", async () => {
  const created = await inWorkspace({
    method: "POST", url: "/api/tasks", payload: { title: "ship epoch six" },
  });
  assert.equal(created.statusCode, 201);
  const task = created.json() as { id: string; done: boolean };
  assert.equal(task.done, false);

  const list = await inWorkspace({ method: "GET", url: "/api/tasks" });
  assert.equal((list.json() as unknown[]).length, 1);

  const patched = await inWorkspace({
    method: "PATCH", url: `/api/tasks/${task.id}/done`, payload: { done: true },
  });
  assert.equal(patched.statusCode, 200);
  assert.equal((patched.json() as { done: boolean }).done, true);
});

test("API requests without a workspace subdomain are rejected", async () => {
  const res = await t.app.inject({
    method: "GET", url: "/api/tasks",
    cookies: { session: cookie }, // authenticated, but no tenant named
  });
  assert.equal(res.statusCode, 400);
});

test("unknown body fields are rejected, not stripped", async () => {
  const res = await inWorkspace({
    method: "POST", url: "/api/tasks", payload: { title: "x", role: "admin" },
  });
  assert.equal(res.statusCode, 400);
});
