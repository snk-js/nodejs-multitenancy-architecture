// buildApp(): builds and returns the app; starts nothing.
import Fastify, { type FastifyError } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import fastifyRateLimit from "@fastify/rate-limit";
import path from "node:path";
import "./types.ts";
import { taskRoutes } from "./routes/tasks.ts";
import { authRoutes } from "./routes/auth.ts";
import { authPlugin } from "./plugins/auth.ts";
import { makeTaskRepository } from "./repositories/task-repository.ts";
import { makeUserRepository } from "./repositories/user-repository.ts";
import { makeSessionRepository } from "./repositories/session-repository.ts";
import type { Db } from "./db/client.ts";

export interface BuildAppOptions {
  db?: Db;
  logger?: boolean;
}

export function buildApp(opts: BuildAppOptions = {}) {
  const app = Fastify({
    logger: opts.logger ?? true,
    bodyLimit: 100 * 1024,
    ajv: {
      customOptions: { coerceTypes: "array", useDefaults: true, removeAdditional: false },
    },
  });

  // Default db is imported lazily by server.ts; tests always pass their own.
  const db = opts.db;
  if (!db) throw new Error("buildApp requires a db (pass makeDb(pool) from db/client.ts)");

  app.decorate("taskRepository", makeTaskRepository(db));
  app.decorate("userRepository", makeUserRepository(db));
  app.decorate("sessionRepository", makeSessionRepository(db));

  app.register(fastifyCookie);
  app.register(fastifyRateLimit, { global: false });
  app.register(authPlugin);

  app.register(fastifyStatic, {
    root: path.resolve("./public"),
    prefix: "/public/",
  });

  app.get("/", (req, reply) => reply.sendFile("index.html"));
  app.get("/health", async () => ({ status: "ok" }));
  app.register(authRoutes);
  app.register(taskRoutes, { prefix: "/api" });

  app.setErrorHandler((err: FastifyError, req, reply) => {
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
