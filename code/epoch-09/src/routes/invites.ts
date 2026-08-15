import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { memberships, outbox, users } from "../db/schema.ts";
import { requireRole } from "../plugins/authorize.ts";

// POST /api/invites — the flow that motivated the whole epoch:
// the request RECORDS INTENT (membership + outbox event, one transaction);
// the worker EXECUTES it (the email) later, with retries, idempotently.
export async function inviteRoutes(app: FastifyInstance) {
  app.post<{ Body: { email: string } }>("/invites", {
    schema: {
      body: {
        type: "object",
        required: ["email"],
        additionalProperties: false,
        properties: { email: { type: "string", format: "email", maxLength: 254 } },
      },
    },
    preHandler: requireRole("admin"),
  }, async (req, reply) => {
    const invited = await app.tenantDb(async (db) => {
      // (A production invite flow also handles not-yet-registered emails with
      // an invitation token; we keep the existing-user path to stay focused.)
      const [user] = await db.select().from(users).where(eq(users.email, req.body.email));
      if (!user) return null;

      // ONE atomic transaction: the business write AND the event, same commit.
      // withTenantDb already runs us inside a transaction — both inserts
      // commit together or roll back together.
      await db.insert(memberships)
        .values({ workspaceId: req.tenant!.id, userId: user.id, role: "member" })
        .onConflictDoNothing();
      await db.insert(outbox).values({
        workspaceId: req.tenant!.id,
        kind: "invite.created",
        payload: {
          membershipUserId: user.id,
          email: user.email,
          workspaceSlug: req.tenant!.slug,
        },
      });
      return user;
    });

    if (!invited) return reply.code(404).send({ error: "no such user" });
    return reply.code(201).send({ invited: invited.email });
  });
}
