import fp from "fastify-plugin";
import type { FastifyRequest } from "fastify";
import { getContext } from "../context.ts";

// Paths that are authenticated but NOT tenant-scoped: workspace management
// happens on the apex domain, before any workspace is chosen.
const NON_TENANT_PREFIXES = ["/auth/", "/public/", "/workspaces"];
const NON_TENANT_PATHS = new Set(["/", "/health"]);

function needsTenant(req: FastifyRequest): boolean {
  const path = req.url.split("?")[0]!;
  return !NON_TENANT_PATHS.has(path) && !NON_TENANT_PREFIXES.some((p) => path.startsWith(p));
}

/** "acme.trellis.app:3000" → "acme"; "localhost:3000" → null */
export function extractSubdomain(host: string | undefined): string | null {
  if (!host) return null;
  const hostname = host.split(":")[0]!;
  const labels = hostname.split(".");
  return labels.length >= 3 ? labels[0]! : null;
}

// Runs AFTER authPlugin (registration order): req.user is set.
export const tenantPlugin = fp(async (app) => {
  app.decorateRequest("tenant", null);

  app.addHook("preHandler", async (req, reply) => {
    if (!needsTenant(req) || !req.user) return;

    const slug = extractSubdomain(req.headers.host);
    if (!slug) {
      return reply.code(400).send({ error: "workspace not specified" });
    }

    // 🛡️ The subdomain is a CLAIM; the membership row is the authorization.
    const found = await app.workspaceRepository.findBySlugWithMembership(slug, req.user.id);
    if (!found) {
      // 404 for both "no such workspace" and "not a member" — existence-hiding
      // at tenant scale.
      return reply.code(404).send({ error: "workspace not found" });
    }

    req.tenant = { id: found.workspace.id, slug, role: found.membership.role };
    getContext().tenant = req.tenant; // publish into AsyncLocalStorage
  });
});
