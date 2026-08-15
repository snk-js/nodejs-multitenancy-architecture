import { isNull, asc, eq } from "drizzle-orm";
import { outbox } from "../db/schema.ts";
import type { Db } from "../db/client.ts";
import { enqueueEmail } from "./queues.ts";

// The relay: polls the outbox and moves committed events onto the real queue.
// It may publish TWICE (crash between publish and mark) — consumers are
// idempotent precisely so that at-least-once equals exactly-once-in-effect.
export async function relayOutboxOnce(db: Db): Promise<number> {
  const rows = await db.select().from(outbox)
    .where(isNull(outbox.publishedAt))
    .orderBy(asc(outbox.id))
    .limit(50);

  for (const row of rows) {
    if (row.kind === "invite.created") {
      await enqueueEmail("invite", row.workspaceId, row.payload);
    }
    await db.update(outbox)
      .set({ publishedAt: new Date() })
      .where(eq(outbox.id, row.id));
  }
  return rows.length;
}
