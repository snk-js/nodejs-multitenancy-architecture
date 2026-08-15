import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { config } from "../config.ts";
import { tryGetContext } from "../context.ts";

// BullMQ requires its own connection settings (maxRetriesPerRequest: null).
const connection = config.redisUrl
  ? new Redis(config.redisUrl, { maxRetriesPerRequest: null })
  : null;

export interface JobEnvelope<T> {
  tenantId: string;   // 🛡️ AsyncLocalStorage does NOT cross the queue: tenant
  requestId?: string; // identity travels IN THE PAYLOAD and is re-established
  data: T;            // (and re-validated) at the top of every job.
}

export const emailQueue = connection
  ? new Queue("email", { connection })
  : null;

export async function enqueueEmail<T>(name: string, tenantId: string, data: T): Promise<void> {
  if (!emailQueue) {
    console.warn("REDIS_URL not set — email job dropped (dev-only degradation)");
    return;
  }
  const envelope: JobEnvelope<T> = {
    tenantId,
    requestId: tryGetContext()?.requestId, // correlation survives the hop (Epoch 10)
    data,
  };
  await emailQueue.add(name, envelope, {
    attempts: 5,                                      // then → failed set (the DLQ)
    backoff: { type: "exponential", delay: 2_000 },   // Epoch 08's backoff, built in
    removeOnComplete: 1000,
    removeOnFail: false,                              // 🛡️ keep the DLQ inspectable
  });
}
