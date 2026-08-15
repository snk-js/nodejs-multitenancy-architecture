// Ephemeral-schema test isolation: each test file gets a pristine, fully
// migrated Postgres schema, torn down afterward. Real database, no mocks —
// the DB is where the bugs are.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { runner } from "node-pg-migrate";
import { buildApp } from "../../src/app.ts";
import { makeDb } from "../../src/db/client.ts";

const DATABASE_URL = process.env.DATABASE_URL!;

export async function makeTestApp() {
  const schema = `test_${randomUUID().replaceAll("-", "")}`;

  await runner({
    databaseUrl: DATABASE_URL,
    dir: "migrations",
    direction: "up",
    schema,
    createSchema: true,
    migrationsTable: "pgmigrations",
    log: () => {},
  });

  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: 5,
    // every connection in this pool lives inside the test schema
    options: `-csearch_path=${schema}`,
  });

  const app = buildApp({ db: makeDb(pool), logger: false });
  await app.ready();

  return {
    app,
    async cleanup() {
      await app.close();
      await pool.end();
      const admin = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
}
