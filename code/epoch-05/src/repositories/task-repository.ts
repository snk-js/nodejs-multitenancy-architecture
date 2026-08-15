import { and, eq, desc } from "drizzle-orm";
import { tasks } from "../db/schema.ts";
import type { Db } from "../db/client.ts";

// Same seam as Epoch 03 — a factory taking `db` — now typed end-to-end.
// Return types are inferred from the schema; nothing here is hand-asserted.
export function makeTaskRepository(db: Db) {
  return {
    listByOwner(ownerId: string) {
      return db.select().from(tasks)
        .where(eq(tasks.ownerId, ownerId))
        .orderBy(desc(tasks.createdAt));
    },

    async create(input: { title: string; ownerId: string }) {
      const [row] = await db.insert(tasks).values(input).returning();
      return row!;
    },

    async setDone(id: string, ownerId: string, done: boolean) {
      const [row] = await db.update(tasks).set({ done })
        .where(and(eq(tasks.id, id), eq(tasks.ownerId, ownerId))) // authz inside the query
        .returning();
      return row ?? null;
    },
  };
}
