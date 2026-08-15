import type { FastifyInstance } from "fastify";
import { makeTaskRepository } from "../repositories/task-repository.ts";
import { requireRole } from "../plugins/authorize.ts";

const taskSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    title: { type: "string" },
    done: { type: "boolean" },
    createdAt: { type: "string" },
  },
} as const;

// 🛡️ Noisy-neighbor fairness: one bucket per TENANT (not per IP) — Globex's
// runaway integration must not queue ahead of Acme's requests. With Redis
// configured, the counter is shared across every instance.
const perTenantRateLimit = {
  rateLimit: {
    max: 100,
    timeWindow: "1 second",
    keyGenerator: (req: { ip: string; tenant?: { id: string } | null }) =>
      req.tenant?.id ?? req.ip,
  },
};

// Every handler runs its data access inside withTenantDb: a transaction
// stamped with the tenant id, policy-checked by Postgres (Epoch 07).
// The explicit predicates inside the repository remain — belt AND suspenders.
export async function taskRoutes(app: FastifyInstance) {
  app.get("/tasks", {
    schema: { response: { 200: { type: "array", items: taskSchema } } },
    config: perTenantRateLimit,
  }, async () => app.tenantDb((db) => makeTaskRepository(db).list()));

  app.post<{ Body: { title: string } }>("/tasks", {
    schema: {
      body: {
        type: "object",
        required: ["title"],
        additionalProperties: false,
        properties: {
          title: { type: "string", minLength: 1, maxLength: 500 },
        },
      },
      response: { 201: taskSchema },
    },
    config: perTenantRateLimit,
  }, async (req, reply) => {
    const task = await app.tenantDb((db) =>
      makeTaskRepository(db).create({ title: req.body.title.trim() })
    );
    return reply.code(201).send(task);
  });

  app.patch<{ Params: { id: string }; Body: { done: boolean } }>("/tasks/:id/done", {
    schema: {
      params: {
        type: "object",
        properties: { id: { type: "string", format: "uuid" } },
      },
      body: {
        type: "object",
        required: ["done"],
        additionalProperties: false,
        properties: { done: { type: "boolean" } },
      },
      response: { 200: taskSchema },
    },
    preHandler: requireRole("member"),
  }, async (req, reply) => {
    const task = await app.tenantDb((db) =>
      makeTaskRepository(db).setDone(req.params.id, req.body.done)
    );
    if (!task) return reply.code(404).send({ error: "task not found" });
    return task;
  });
}
