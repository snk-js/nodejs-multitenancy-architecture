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
  const repo = app.taskRepository;

  app.get("/tasks", {
    schema: { response: { 200: { type: "array", items: taskSchema } } },
  }, async (req) => repo.listByOwner(req.user.id));

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
    const task = await repo.create({ title: req.body.title.trim(), ownerId: req.user.id });
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
    const task = await repo.setDone(req.params.id, req.user.id, req.body.done);
    // 🛡️ 404, not 403: "doesn't exist" and "not yours" must be indistinguishable
    if (!task) return reply.code(404).send({ error: "task not found" });
    return task;
  });
}
