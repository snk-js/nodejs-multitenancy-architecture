import type { FastifyInstance } from "fastify";

// Workspace management is authenticated but NOT tenant-scoped: it happens on
// the apex domain, before any workspace is chosen.
export async function workspaceRoutes(app: FastifyInstance) {
  const repo = app.workspaceRepository;

  app.get("/workspaces", async (req) => repo.listForUser(req.user!.id));

  app.post<{ Body: { slug: string; name: string } }>("/workspaces", {
    schema: {
      body: {
        type: "object",
        required: ["slug", "name"],
        additionalProperties: false,
        properties: {
          slug: { type: "string", pattern: "^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$" },
          name: { type: "string", minLength: 1, maxLength: 100 },
        },
      },
    },
  }, async (req, reply) => {
    try {
      const ws = await repo.createWithOwner(req.body, req.user!.id);
      return reply.code(201).send({ id: ws.id, slug: ws.slug, name: ws.name });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "slug already taken" });
      }
      throw err;
    }
  });
}
