// buildApp(): builds and returns the app; starts nothing.
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { taskRoutes } from "./routes/tasks.js";
import { makeTaskRepository } from "./repositories/task-repository.js";
import { pool } from "./db/pool.js";

export function buildApp(opts = {}) {
  const app = Fastify({
    logger: opts.logger ?? true,
    bodyLimit: 100 * 1024,
    ajv: {
      customOptions: { coerceTypes: "array", useDefaults: true, removeAdditional: false },
    },
  });

  const db = opts.db ?? pool;
  app.decorate("taskRepository", makeTaskRepository(db));

  app.register(fastifyStatic, {
    root: path.resolve("./public"),
    prefix: "/public/",
  });

  app.get("/", (req, reply) => reply.sendFile("index.html"));
  app.get("/health", async () => ({ status: "ok" }));
  app.register(taskRoutes, { prefix: "/api" });

  app.setErrorHandler((err, req, reply) => {
    if (err.validation) {
      return reply.code(400).send({ error: "validation failed", details: err.validation });
    }
    req.log.error({ err }, "unhandled error");
    const status = err.statusCode ?? 500;
    reply.code(status).send({
      error: status >= 500 ? "internal server error" : err.message,
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: "not found" });
  });

  return app;
}
