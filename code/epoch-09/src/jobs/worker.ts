// The worker tier — a SEPARATE PROCESS from the API (npm run worker).
// It scales on queue depth, its crashes don't take the API down, and CPU-heavy
// work here can never block the API's event loop.
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { eq } from "drizzle-orm";
import { config } from "../config.ts";
import { pool, makeDb } from "../db/client.ts";
import { workspaces } from "../db/schema.ts";
import { runWithContext } from "../context.ts";
import { relayOutboxOnce } from "./outbox-relay.ts";
import { sendInviteEmail, type InvitePayload } from "./handlers/send-invite-email.ts";
import type { JobEnvelope } from "./queues.ts";

if (!config.redisUrl) {
  console.error("worker requires REDIS_URL");
  process.exit(1);
}

const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const db = makeDb(pool);

const worker = new Worker<JobEnvelope<InvitePayload>>("email", async (job) => {
  const { tenantId, requestId, data } = job.data;

  // 🛡️ Re-validate the tenant — it may have been suspended/deleted since
  // enqueue. The payload's claim is a starting point, not an authorization.
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, tenantId));
  if (!ws) {
    console.warn(`[worker] tenant ${tenantId} gone — dropping job ${job.id}`);
    return;
  }

  // Re-enter tenant context explicitly: ALS died at the process boundary.
  await runWithContext(
    { requestId: requestId ?? `job:${job.id}`, tenant: { id: ws.id, slug: ws.slug, role: "member" } },
    () => sendInviteEmail(db, data)
  );
}, { connection, concurrency: 10 });

worker.on("failed", (job, err) => {
  console.error(`[worker] job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
});

// The relay loop: committed outbox rows → queue. Every tick is idempotent.
const relayTimer = setInterval(() => {
  relayOutboxOnce(db).catch((err) => console.error("[relay] error", err));
}, 2_000);

// Epoch 08's graceful shutdown, worker flavor: stop claiming, finish current, exit.
async function shutdown() {
  clearInterval(relayTimer);
  await worker.close();
  await connection.quit();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

console.log("[worker] listening for jobs; relaying outbox every 2s");
