import { eq } from "drizzle-orm";
import { users } from "../db/schema.ts";
import type { Db } from "../db/client.ts";

export function makeUserRepository(db: Db) {
  return {
    async create(input: { email: string; passwordHash: string }) {
      const [row] = await db.insert(users).values(input)
        .returning({ id: users.id, email: users.email, createdAt: users.createdAt });
      return row!;
    },

    async findByEmail(email: string) {
      const [row] = await db.select().from(users).where(eq(users.email, email));
      return row ?? null;
    },
  };
}
