import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "../db/schema.ts";

const ORDER: Record<Role, number> = { member: 0, admin: 1, owner: 2 };

// Role checks live in ONE place, not sprinkled as inline ifs.
// 403 (not 404) is correct here: membership is already established; we're not
// hiding existence anymore, we're refusing an action.
export const requireRole = (min: Role) =>
  async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.tenant || ORDER[req.tenant.role] < ORDER[min]) {
      return reply.code(403).send({ error: "insufficient role" });
    }
  };
