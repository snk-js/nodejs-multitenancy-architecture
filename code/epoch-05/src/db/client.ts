import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "../config.ts";
import * as schema from "./schema.ts";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  console.error("idle pg client error", err);
});

export type Db = NodePgDatabase<typeof schema>;

export const makeDb = (p: pg.Pool): Db => drizzle(p, { schema });
export const db: Db = makeDb(pool);
