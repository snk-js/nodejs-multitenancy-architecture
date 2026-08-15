import fp from "fastify-plugin";
import type { FastifyRequest } from "fastify";
import { hashToken } from "../services/session.ts";
import { getContext } from "../context.ts";

const PUBLIC_PREFIXES = ["/auth/", "/public/"];
const PUBLIC_PATHS = new Set(["/", "/health/live", "/health/ready"]);

function isPublic(req: FastifyRequest): boolean {
  const path = req.url.split("?")[0]!;
  return PUBLIC_PATHS.has(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p));
}

// 🛡️ Deny by default: runs on EVERY route; public paths are the explicit allowlist.
export const authPlugin = fp(async (app) => {
  app.decorateRequest("user", null);

  app.addHook("preHandler", async (req, reply) => {
    if (isPublic(req)) return;

    const token = req.cookies.session;
    if (!token) {
      return reply.code(401).send({ error: "authentication required" });
    }

    const session = await app.sessionRepository.findValid(hashToken(token));
    if (!session) {
      reply.clearCookie("session", { path: "/" });
      return reply.code(401).send({ error: "session expired" });
    }
    req.user = { id: session.userId };
    getContext().userId = session.userId; // publish into AsyncLocalStorage
  });
});
