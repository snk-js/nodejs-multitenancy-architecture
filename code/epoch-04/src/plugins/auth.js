import fp from "fastify-plugin";
import { hashToken } from "../services/session.js";

// 🛡️ Deny by default: this hook runs on EVERY route; public paths are the
// explicit allowlist. Forgetting a guard fails open; forgetting an allowlist
// entry fails closed. Choose the failure you can live with.
const PUBLIC_PREFIXES = ["/auth/", "/public/"];
const PUBLIC_PATHS = new Set(["/", "/health"]);

function isPublic(req) {
  const path = req.url.split("?")[0];
  return PUBLIC_PATHS.has(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p));
}

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
    req.user = { id: session.user_id };
  });
});
