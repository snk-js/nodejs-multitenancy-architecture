import { processedJobs } from "../../db/schema.ts";
import type { Db } from "../../db/client.ts";

export interface InvitePayload {
  membershipUserId: string;
  email: string;
  workspaceSlug: string;
}

// 🛡️ Every job handler must be safe to run twice (at-least-once delivery is a
// law, not a bug). Pattern: record the effect's unique key transactionally,
// act only if the record is new.
export async function sendInviteEmail(db: Db, payload: InvitePayload): Promise<void> {
  const key = `invite-email:${payload.workspaceSlug}:${payload.membershipUserId}`;

  const inserted = await db.insert(processedJobs)
    .values({ key })
    .onConflictDoNothing()
    .returning({ key: processedJobs.key });

  if (inserted.length === 0) {
    console.log(`[email] duplicate delivery suppressed (${key})`);
    return; // this exact effect already happened — ack and move on
  }

  // A real system calls its email provider here (with a timeout, per Epoch 08).
  console.log(
    `[email] to=${payload.email} :: you've been invited to workspace "${payload.workspaceSlug}"`
  );
}
