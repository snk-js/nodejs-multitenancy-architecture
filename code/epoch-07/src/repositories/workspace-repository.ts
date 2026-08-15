import { and, eq } from "drizzle-orm";
import { workspaces, memberships } from "../db/schema.ts";
import type { Db } from "../db/client.ts";

export function makeWorkspaceRepository(db: Db) {
  return {
    // Provisioning is ONE transaction: a workspace without an owner (crash
    // between inserts) would be an unadministrable orphan.
    async createWithOwner(input: { slug: string; name: string }, ownerUserId: string) {
      return db.transaction(async (tx) => {
        const [ws] = await tx.insert(workspaces).values(input).returning();
        await tx.insert(memberships).values({
          workspaceId: ws!.id,
          userId: ownerUserId,
          role: "owner",
        });
        return ws!;
      });
    },

    // One query: the subdomain is a claim; this JOIN is the authorization.
    async findBySlugWithMembership(slug: string, userId: string) {
      const [row] = await db
        .select({ workspace: workspaces, membership: memberships })
        .from(workspaces)
        .innerJoin(memberships, eq(memberships.workspaceId, workspaces.id))
        .where(and(eq(workspaces.slug, slug), eq(memberships.userId, userId)));
      return row ?? null;
    },

    async listForUser(userId: string) {
      return db
        .select({
          id: workspaces.id,
          slug: workspaces.slug,
          name: workspaces.name,
          role: memberships.role,
        })
        .from(workspaces)
        .innerJoin(memberships, eq(memberships.workspaceId, workspaces.id))
        .where(eq(memberships.userId, userId));
    },
  };
}
