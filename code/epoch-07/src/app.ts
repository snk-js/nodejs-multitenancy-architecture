// buildApp(): builds and returns the app; starts nothing.
import Fastify, { type FastifyError } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import fastifyRateLimit from "@fastify/rate-limit";
import path from "node:path";
import "./types.ts";
import { taskRoutes } from "./routes/tasks.ts";
import { authRoutes } from "./routes/auth.ts";
import { workspaceRoutes } from "./routes/workspaces.ts";
import { authPlugin } from "./plugins/auth.ts";
import { tenantPlugin } from "./plugins/tenant.ts";
import { makeUserRepository } from "./repositories/user-repository.ts";
import { makeSessionRepository } from "./repositories/session-repository.ts";
import { makeWorkspaceRepository } from "./repositories/workspace-repository.ts";
import { enterContext } from "./context.ts";
import { makeDb } from "./db/client.ts";
import { makeTenantDb } from "./db/tenant-db.ts";
import type pg from "pg";

export interface BuildAppOptions {
  pool?: pg.Pool;
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

  const pool = opts.pool;
  if (!pool) throw new Error("buildApp requires a pool (import it from db/client.ts)");
  const db = makeDb(pool);

  // Identity/membership tables are user-scoped, not tenant-scoped: they use
  // the plain pool. Tenant-owned data goes through tenantDb → RLS.
  app.decorate("userRepository", makeUserRepository(db));
  app.decorate("sessionRepository", makeSessionRepository(db));
  app.decorate("workspaceRepository", makeWorkspaceRepository(db));
  app.decorate("tenantDb", makeTenantDb(pool));

  // Bind the AsyncLocalStorage context to this request's async chain.
  // Later hooks fill in userId (auth) and tenant (tenant resolution);
  // any layer below can then ask "who / which workspace?" without params.
  app.addHook("onRequest", async (req) => {
    enterContext({ requestId: req.id });
  });

  app.register(fastifyCookie);
  app.register(fastifyRateLimit, { global: false });
  app.register(authPlugin);
  app.register(tenantPlugin); // order matters: after auth — first WHO, then WHICH workspace

  app.register(fastifyStatic, {
    root: path.resolve("./public"),
    prefix: "/public/",
  });

  app.get("/", (req, reply) => reply.sendFile("index.html"));
  app.get("/health", async () => ({ status: "ok" }));
  app.register(authRoutes);
  app.register(workspaceRoutes);
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
