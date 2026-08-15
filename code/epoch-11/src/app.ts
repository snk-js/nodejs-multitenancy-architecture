// buildApp(): builds and returns the app; starts nothing.
import Fastify, { type FastifyError } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyHelmet from "@fastify/helmet";
import fastifyCors from "@fastify/cors";
import { config } from "./config.ts";
import path from "node:path";
import "./types.ts";
import { taskRoutes } from "./routes/tasks.ts";
import { authRoutes } from "./routes/auth.ts";
import { workspaceRoutes, workspaceInfoRoutes } from "./routes/workspaces.ts";
import { inviteRoutes } from "./routes/invites.ts";
import { authPlugin } from "./plugins/auth.ts";
import { tenantPlugin } from "./plugins/tenant.ts";
import { makeUserRepository } from "./repositories/user-repository.ts";
import { makeSessionRepository } from "./repositories/session-repository.ts";
import { makeWorkspaceRepository } from "./repositories/workspace-repository.ts";
import { enterContext } from "./context.ts";
import { makeDb } from "./db/client.ts";
import { makeTenantDb } from "./db/tenant-db.ts";
import { redis } from "./redis.ts";
import { logger } from "./logging.ts";
import type pg from "pg";

export interface BuildAppOptions {
  pool?: pg.Pool;
  logger?: boolean;
}

export function buildApp(opts: BuildAppOptions = {}) {
  const app = Fastify({
    // the shared pino instance: ALS mixin + central redaction (Epoch 10)
    ...(opts.logger === false ? { logger: false } : { loggerInstance: logger }),
    trustProxy: config.trustProxy,
    bodyLimit: 100 * 1024,
    // Nothing waits forever: deadlines on every cross-process await.
    connectionTimeout: 10_000, // slow-open connections
    requestTimeout: 30_000,    // hard cap on any request's lifetime
    keepAliveTimeout: 72_000,  // 🛡️ MUST exceed the load balancer's idle timeout
                               // (LB 60s → Node 72s) or you get random 502s
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

  // Security headers (CSP limits XSS blast radius; HSTS pins HTTPS) and an
  // explicit CORS allowlist — never "*" with credentials.
  app.register(fastifyHelmet, { hsts: { maxAge: 63072000 } });
  if (config.allowedOrigins.length > 0) {
    app.register(fastifyCors, { origin: config.allowedOrigins, credentials: true });
  }

  app.register(fastifyCookie);
  // Distributed limiting: with Redis the counters are shared across all
  // instances (a per-process counter grants N× the budget at N instances).
  app.register(fastifyRateLimit, { global: false, redis: redis ?? undefined });
  app.register(authPlugin);
  app.register(tenantPlugin); // order matters: after auth — first WHO, then WHICH workspace

  app.register(fastifyStatic, {
    root: path.resolve("./public"),
    prefix: "/public/",
  });

  const shutdownState = { draining: false };
  app.decorate("shutdownState", shutdownState);

  app.get("/", (req, reply) => reply.sendFile("index.html"));

  // Liveness: "should this process be RESTARTED?" — cheap, dependency-free.
  // 🛡️ Never check the DB here: a DB outage + liveness-DB-check = the platform
  // restarts every healthy instance (a restart storm on top of an incident).
  app.get("/health/live", async () => ({ status: "ok" }));

  // Readiness: "should this process receive TRAFFIC?" — does check deps,
  // and goes false during shutdown drain.
  app.get("/health/ready", async (req, reply) => {
    if (shutdownState.draining) {
      return reply.code(503).send({ status: "draining" });
    }
    try {
      await Promise.all([pool.query("SELECT 1"), redis?.ping()]);
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "degraded" });
    }
  });
  app.register(authRoutes);
  app.register(workspaceRoutes);
  app.register(taskRoutes, { prefix: "/api" });
  app.register(workspaceInfoRoutes, { prefix: "/api" });
  app.register(inviteRoutes, { prefix: "/api" });

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
