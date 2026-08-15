// buildApp(): builds and returns the app; starts nothing.
// This split is what lets tests exercise the whole HTTP surface via
// app.inject() — no port, no socket, hundreds of instances in parallel.
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { taskRoutes } from "./routes/tasks.js";

export function buildApp(opts = {}) {
  const app = Fastify({
    logger: opts.logger ?? true,
    bodyLimit: 100 * 1024, // Epoch 01's hard-won 100 KiB cap, now one option
    ajv: {
      // Fastify's default is removeAdditional: true — unknown body fields are
      // silently STRIPPED. We want a loud 400 instead: a client sending fields
      // we don't know about is a bug (or an attack) worth surfacing.
      customOptions: { coerceTypes: "array", useDefaults: true, removeAdditional: false },
    },
  });

  app.register(fastifyStatic, {
    root: path.resolve("./public"),
    prefix: "/public/",
  });
  // @fastify/static does the traversal check from Epoch 01 for us —
  // we know exactly what bug it is preventing.

  app.get("/", (req, reply) => reply.sendFile("index.html"));
  app.get("/health", async () => ({ status: "ok" }));
  app.register(taskRoutes, { prefix: "/api" });

  app.setErrorHandler((err, req, reply) => {
    if (err.validation) {
      return reply.code(400).send({ error: "validation failed", details: err.validation });
    }
    req.log.error({ err }, "unhandled error");
    const status = err.statusCode ?? 500;
    // 🛡️ 5xx messages stay generic: internal details are reconnaissance gold.
    reply.code(status).send({
      error: status >= 500 ? "internal server error" : err.message,
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: "not found" });
  });

  return app;
}
