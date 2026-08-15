// The outbox guarantee, tested at the seam we own: the membership and its
// event are committed ATOMICALLY. (Queue delivery itself is BullMQ's suite's
// job; our job is that no committed intent can be lost before the queue.)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { makeTestApp, type TestApp } from "./helpers/test-app.ts";

let t: TestApp;
let ownerCookie: string;
const SLUG = "invite-ws";

async function register(email: string): Promise<string> {
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

before(async () => {
  t = await makeTestApp();
  ownerCookie = await register("invite-owner@example.com");
  await register("invitee@example.com");
  await t.app.inject({
    method: "POST", url: "/workspaces",
    cookies: { session: ownerCookie },
    payload: { slug: SLUG, name: "Invite test" },
  });
});
after(async () => { await t.cleanup(); });

test("inviting a user writes membership AND outbox event in one commit", async () => {
  const res = await t.app.inject({
    method: "POST", url: "/api/invites",
    headers: { host: `${SLUG}.localtest.me` },
    cookies: { session: ownerCookie },
    payload: { email: "invitee@example.com" },
  });
  assert.equal(res.statusCode, 201);

  const { rows: events } = await t.pool.query(
    "SELECT kind, payload FROM outbox WHERE kind = 'invite.created'"
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.email, "invitee@example.com");

  const { rows: members } = await t.pool.query("SELECT user_id, role FROM memberships");
  assert.equal(members.length, 2); // owner + invitee
});

test("inviting an unknown email creates NOTHING (atomicity)", async () => {
  const res = await t.app.inject({
    method: "POST", url: "/api/invites",
    headers: { host: `${SLUG}.localtest.me` },
    cookies: { session: ownerCookie },
    payload: { email: "ghost@example.com" },
  });
  assert.equal(res.statusCode, 404);

  const { rows } = await t.pool.query("SELECT count(*)::int AS n FROM outbox");
  assert.equal(rows[0].n, 1); // still just the one event from the previous test
});
