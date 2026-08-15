import pg from "pg";
import { config } from "../config.js";

// Pool sizing is a system-wide budget: instances × max + humans + migrations
// must stay under Postgres max_connections (default 100).
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  // an idle client died (db restart, network blip) — log, don't crash
  console.error("idle pg client error", err);
});
