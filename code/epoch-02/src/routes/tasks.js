import { randomUUID } from "node:crypto";

const tasks = new Map(); // still in-memory — its funeral is Epoch 03

const taskSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    title: { type: "string" },
    done: { type: "boolean" },
  },
};

export async function taskRoutes(app) {
  app.get("/tasks", {
    schema: {
      response: { 200: { type: "array", items: taskSchema } },
    },
  }, async () => [...tasks.values()]);

  app.post("/tasks", {
    schema: {
      body: {
        type: "object",
        required: ["title"],
        additionalProperties: false, // 🛡️ mass-assignment killer
        properties: {
          title: { type: "string", minLength: 1, maxLength: 500 },
        },
      },
      response: { 201: taskSchema },
    },
  }, async (req, reply) => {
    const task = { id: randomUUID(), title: req.body.title.trim(), done: false };
    tasks.set(task.id, task);
    return reply.code(201).send(task);
  });
}
