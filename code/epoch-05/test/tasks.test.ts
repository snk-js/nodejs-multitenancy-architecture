import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { makeTestApp } from "./helpers/test-app.ts";

let t: Awaited<ReturnType<typeof makeTestApp>>;

async function signup(email: string): Promise<string> {
  await t.app.inject({
    method: "POST", url: "/auth/register",
    payload: { email, password: "correct-horse-battery" },
  });
  const login = await t.app.inject({
    method: "POST", url: "/auth/login",
    payload: { email, password: "correct-horse-battery" },
  });
  return login.cookies.find((c) => c.name === "session")!.value;
}

before(async () => { t = await makeTestApp(); });
after(async () => { await t.cleanup(); });

test("task CRUD, scoped to its owner", async () => {
  const alice = await signup("alice@example.com");
  const bob = await signup("bob@example.com");

  const created = await t.app.inject({
    method: "POST", url: "/api/tasks",
    cookies: { session: alice },
    payload: { title: "alice's task" },
  });
  assert.equal(created.statusCode, 201);
  const task = created.json() as { id: string };

  // Bob sees an empty list — ownership is enforced inside the query
  const bobList = await t.app.inject({
    method: "GET", url: "/api/tasks", cookies: { session: bob },
  });
  assert.deepEqual(bobList.json(), []);

  // 🛡️ Bob mutating Alice's task by exact id → 404, indistinguishable
  // from a task that never existed (no existence leak).
  const bobPatch = await t.app.inject({
    method: "PATCH", url: `/api/tasks/${task.id}/done`,
    cookies: { session: bob },
    payload: { done: true },
  });
  assert.equal(bobPatch.statusCode, 404);

  const alicePatch = await t.app.inject({
    method: "PATCH", url: `/api/tasks/${task.id}/done`,
    cookies: { session: alice },
    payload: { done: true },
  });
  assert.equal(alicePatch.statusCode, 200);
  assert.equal((alicePatch.json() as { done: boolean }).done, true);
});

test("unknown body fields are rejected, not stripped", async () => {
  const alice = await signup("mass-assign@example.com");
  const res = await t.app.inject({
    method: "POST", url: "/api/tasks",
    cookies: { session: alice },
    payload: { title: "x", role: "admin" },
  });
  assert.equal(res.statusCode, 400); // 🛡️ mass assignment dies at the door
});
