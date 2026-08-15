// The hostile suite: adversarial proof that isolation is enforced by the
// DATABASE, not by developer discipline. These are the most important tests
// in the codebase.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { makeTestApp, type TestApp } from "./helpers/test-app.ts";
import { runWithContext } from "../src/context.ts";

let t: TestApp;
let acmeId: string;
let globexId: string;
let acmeUserId: string;

async function makeTenant(email: string, slug: string) {
  await t.app.inject({
    method: "POST", url: "/auth/register",
    payload: { email, password: "correct-horse-battery" },
  });
  const login = await t.app.inject({
    method: "POST", url: "/auth/login",
    payload: { email, password: "correct-horse-battery" },
  });
  const cookie = login.cookies.find((c) => c.name === "session")!.value;
  const userId = (login.json() as { id: string }).id;
  const ws = await t.app.inject({
    method: "POST", url: "/workspaces",
    cookies: { session: cookie },
    payload: { slug, name: slug },
  });
  return { cookie, userId, workspaceId: (ws.json() as { id: string }).id };
}

before(async () => {
  t = await makeTestApp();
  const acme = await makeTenant("rls-acme@example.com", "rls-acme");
  const globex = await makeTenant("rls-globex@example.com", "rls-globex");
  acmeId = acme.workspaceId;
  globexId = globex.workspaceId;
  acmeUserId = acme.userId;

  // seed one task per tenant, through the front door
  for (const [slug, cookie] of [["rls-acme", acme.cookie], ["rls-globex", globex.cookie]] as const) {
    await t.app.inject({
      method: "POST", url: "/api/tasks",
      headers: { host: `${slug}.localtest.me` },
      cookies: { session: cookie },
      payload: { title: `${slug} secret` },
    });
  }
});
after(async () => { await t.cleanup(); });

const asTenantDb = <T>(workspaceId: string, fn: () => Promise<T>): Promise<T> =>
  runWithContext(
    { requestId: "test", tenant: { id: workspaceId, slug: "x", role: "owner" } },
    fn
  );

test("RLS: a raw query with NO tenant predicate stays scoped", async () => {
  // The §7.1 villain: an unscoped SELECT — deliberately missing its WHERE.
  const rows = await asTenantDb(acmeId, () =>
    t.app.tenantDb(async (db) => {
      const result = await db.execute(sql`SELECT * FROM tasks`);
      return result.rows as { workspace_id: string }[];
    })
  );
  assert.ok(rows.length > 0, "acme sees its own rows");
  assert.ok(rows.every((r) => r.workspace_id === acmeId),
    "the forgotten WHERE clause cost scope, not confidentiality");
});

test("RLS: cross-tenant INSERT is rejected by WITH CHECK", async () => {
  await assert.rejects(
    asTenantDb(acmeId, () =>
      t.app.tenantDb(async (db) => {
        await db.execute(sql`
          INSERT INTO tasks (workspace_id, owner_id, title)
          VALUES (${globexId}::uuid, ${acmeUserId}::uuid, 'smuggled')
        `);
      })
    ),
    /row-level security/
  );
});

test("RLS: no tenant context at all → zero rows, not all rows", async () => {
  // Straight on the pool: app.tenant_id never set → current_setting(_, true)
  // is NULL → the policy matches NOTHING. The failure direction is SAFE.
  const { rows } = await t.pool.query("SELECT * FROM tasks");
  assert.equal(rows.length, 0);
});

test("meta: every table carrying workspace_id has RLS enabled and forced", async () => {
  // Deny-by-default applied to schema evolution: a NEW tenant-owned table
  // shipped without RLS fails CI here, by default, forever.
  const ALLOWLISTED_EXCEPTIONS = new Set([
    "memberships", // identity/authz table: read pre-tenant-resolution by design,
    "workspaces",  // always via user-scoped repository queries — see Epoch 07 §7.5
    "outbox",      // system table: WRITTEN inside tenant transactions, READ
                   // across tenants by the relay — see Epoch 09 §9.4
  ]);
  const { rows } = await t.pool.query(`
    SELECT c.relname AS table_name, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = current_schema()
      AND c.relkind = 'r'
      AND a.attname = 'workspace_id'
      AND NOT a.attisdropped
  `);
  const unprotected = rows
    .filter((r) => !ALLOWLISTED_EXCEPTIONS.has(r.table_name))
    .filter((r) => !(r.relrowsecurity && r.relforcerowsecurity))
    .map((r) => r.table_name);
  assert.deepEqual(unprotected, []);
});
