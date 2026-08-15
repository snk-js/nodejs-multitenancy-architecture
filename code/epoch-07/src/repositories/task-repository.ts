import { and, eq, desc } from "drizzle-orm";
import { tasks } from "../db/schema.ts";
import { getContext, getTenant } from "../context.ts";
import type { Db } from "../db/client.ts";

// Tenant-scoped by construction-of-convention: every read, update, and delete
// on tenant-owned data carries the tenant predicate. A primary key is NOT an
// authorization — UUIDs travel in URLs, logs, and support tickets.
// (Epoch 07 adds the layer that makes forgetting this survivable: RLS.)
export function makeTaskRepository(db: Db) {
  return {
    list() {
      const tenant = getTenant();
      return db.select().from(tasks)
        .where(eq(tasks.workspaceId, tenant.id))
        .orderBy(desc(tasks.createdAt));
    },

    async create(input: { title: string }) {
      const tenant = getTenant();
      const { userId } = getContext();
      const [row] = await db.insert(tasks)
        .values({ workspaceId: tenant.id, ownerId: userId!, title: input.title })
        .returning();
      return row!;
    },

    async setDone(id: string, done: boolean) {
      const tenant = getTenant();
      const [row] = await db.update(tasks).set({ done })
        .where(and(eq(tasks.id, id), eq(tasks.workspaceId, tenant.id))) // id alone is NEVER enough
        .returning();
      return row ?? null;
    },
  };
}
