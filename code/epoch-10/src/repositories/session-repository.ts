import { and, eq, gt, sql } from "drizzle-orm";
import { sessions } from "../db/schema.ts";
import type { Db } from "../db/client.ts";

export function makeSessionRepository(db: Db) {
  return {
    async create(input: { tokenHash: string; userId: string; expiresAt: Date }) {
      await db.insert(sessions).values(input);
    },

    async findValid(tokenHash: string) {
      const [row] = await db.select().from(sessions)
        .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, sql`now()`)));
      return row ?? null;
    },

    async delete(tokenHash: string) {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    },
  };
}
