// Observability first: in production run  node --import ./src/otel.ts src/server.ts
// (importing here keeps the dev command simple; the flag form patches earlier).
import "./otel.ts";
// The only file that touches the network — and the only one that ends it.
import { buildApp } from "./app.ts";
import { config } from "./config.ts";
import { pool } from "./db/client.ts";
import { redis } from "./redis.ts";

const app = buildApp({ pool });

// Graceful shutdown: readiness off → drain → close resources → exit,
// with a hard deadline SHORTER than the platform's SIGKILL grace period.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.shutdownState.draining = true; // 1. readiness flips 503 → LB stops sending traffic
  app.log.info({ signal }, "shutdown: draining");
  const deadline = setTimeout(() => process.exit(1), 25_000); // 2. backstop < SIGKILL

  try {
    await app.close();   // 3. stop accepting; in-flight requests finish
    await pool.end();    // 4. THEN close the pool — in-flight requests needed it
    await redis?.quit();
    clearTimeout(deadline);
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "shutdown: forced");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// 🛡️ Crash on truly unknown errors: a process that limps past an unknown
// exception is in undefined state. Let it die; the supervisor restarts clean.
process.on("uncaughtException", (err) => {
  app.log.fatal({ err }, "uncaught exception — exiting");
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  app.log.fatal({ err }, "unhandled rejection — exiting");
  process.exit(1);
});

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
