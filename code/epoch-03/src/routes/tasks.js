// Route files translate HTTP ↔ domain, and nothing else.
const taskSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    title: { type: "string" },
    done: { type: "boolean" },
    created_at: { type: "string" },
  },
};

export async function taskRoutes(app) {
  const repo = app.taskRepository; // decorated in app.js

  app.get("/tasks", {
    schema: { response: { 200: { type: "array", items: taskSchema } } },
  }, async () => repo.list());

  app.post("/tasks", {
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

  app.patch("/tasks/:id/done", {
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
  }, async (req, reply) => {
    const task = await repo.setDone(req.params.id, req.body.done);
    if (!task) return reply.code(404).send({ error: "task not found" });
    return task;
  });
}
