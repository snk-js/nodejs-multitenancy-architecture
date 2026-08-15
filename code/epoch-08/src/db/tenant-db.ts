import type pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.ts";
import { getTenant } from "../context.ts";
import type { Db } from "./client.ts";

// One primitive delivers the whole enforcement model: a per-request
// transaction stamped with the tenant id, inside which every query is
// policy-checked by Postgres itself. Repositories didn't change — they accept
// a `db`; this hands them one whose every query is RLS-scoped.
export function makeTenantDb(pool: pg.Pool) {
  return async function withTenantDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    const tenant = getTenant(); // throws if absent — loud, never silently unscoped
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // 🛡️ Parameterized set_config, never `SET LOCAL app.tenant_id = '${id}'`:
      // SET takes no bind parameters; interpolation would reopen the injection
      // door at the most security-critical line in the codebase.
      // The `true` flag = SET LOCAL semantics: the stamp DIES at COMMIT/ROLLBACK,
      // so a pooled connection can never leak tenant A's setting to tenant B.
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.id]);
      const result = await fn(drizzle(client, { schema }));
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  };
}

export type TenantDb = ReturnType<typeof makeTenantDb>;
