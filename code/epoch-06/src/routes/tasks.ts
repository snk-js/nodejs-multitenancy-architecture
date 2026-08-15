import type { FastifyInstance } from "fastify";
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

export async function taskRoutes(app: FastifyInstance) {
  const repo = app.taskRepository;

  app.get("/tasks", {
    schema: { response: { 200: { type: "array", items: taskSchema } } },
  }, async () => repo.list());

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
  }, async (req, reply) => {
    const task = await repo.create({ title: req.body.title.trim() });
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
    const task = await repo.setDone(req.params.id, req.body.done);
    if (!task) return reply.code(404).send({ error: "task not found" });
    return task;
  });
}
