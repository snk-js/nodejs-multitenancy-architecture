import type { FastifyInstance } from "fastify";
import { hashPassword, verifyPassword, DUMMY_ARGON2_HASH } from "../services/password.ts";
import { newSessionToken, hashToken, sessionExpiry, SESSION_TTL_MS } from "../services/session.ts";
import { config } from "../config.ts";

const credentialsSchema = {
  type: "object",
  required: ["email", "password"],
  additionalProperties: false,
  properties: {
    email: { type: "string", format: "email", maxLength: 254 },
    password: { type: "string", minLength: 10, maxLength: 128 },
  },
} as const;

const loginRateLimit = {
  rateLimit: {
    max: 10,
    timeWindow: "1 minute",
    keyGenerator: (req: { ip: string; body?: unknown }) =>
      `${req.ip}:${(req.body as { email?: string } | undefined)?.email ?? ""}`,
    hook: "preHandler" as const,
  },
};

interface Credentials { email: string; password: string }

export async function authRoutes(app: FastifyInstance) {
  const users = app.userRepository;
  const sessions = app.sessionRepository;

  app.post<{ Body: Credentials }>("/auth/register", {
    schema: { body: credentialsSchema },
    config: loginRateLimit,
  }, async (req, reply) => {
    const { email, password } = req.body;
    const passwordHash = await hashPassword(password);
    try {
      const user = await users.create({ email, passwordHash });
      return reply.code(201).send({ id: user.id, email: user.email });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") { // unique_violation
        return reply.code(409).send({ error: "email already registered" });
      }
      throw err;
    }
  });

  app.post<{ Body: Credentials }>("/auth/login", {
    schema: { body: credentialsSchema },
    config: loginRateLimit,
  }, async (req, reply) => {
    const user = await users.findByEmail(req.body.email);
    const hash = user?.passwordHash ?? DUMMY_ARGON2_HASH;
    const ok = await verifyPassword(hash, req.body.password);
    if (!user || !ok) {
      return reply.code(401).send({ error: "invalid email or password" });
    }

    const token = newSessionToken();
    await sessions.create({
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt: sessionExpiry(),
    });

    reply.setCookie("session", token, {
      httpOnly: true,
      secure: config.env !== "development" && config.env !== "test",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    });
    return { id: user.id, email: user.email };
  });

  app.post("/auth/logout", async (req, reply) => {
    if (req.cookies.session) {
      await sessions.delete(hashToken(req.cookies.session));
    }
    reply.clearCookie("session", { path: "/" });
    return { ok: true };
  });
}
