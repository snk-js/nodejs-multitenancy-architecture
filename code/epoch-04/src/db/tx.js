import { pool } from "./pool.js";

// All statements in a transaction MUST run on the same client —
// pool.query() grabs any free connection, so BEGIN on one connection and
// INSERT on another are unrelated conversations, and your "transaction"
// silently isn't one.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client); // fn gets THE SAME client
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release(); // ALWAYS back to the pool — a leaked client is a
  }                   // pooled connection gone forever; leak `max` of them
}                     // and every request hangs at connect()
