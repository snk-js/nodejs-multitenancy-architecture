import { hashPassword, verifyPassword, DUMMY_ARGON2_HASH } from "../services/password.js";
import { newSessionToken, hashToken, sessionExpiry, SESSION_TTL_MS } from "../services/session.js";
import { config } from "../config.js";

const credentialsSchema = {
  type: "object",
  required: ["email", "password"],
  additionalProperties: false,
  properties: {
    email: { type: "string", format: "email", maxLength: 254 },
    password: { type: "string", minLength: 10, maxLength: 128 },
  },
};

// Login is the internet's most-attacked endpoint: credential stuffing is a
// when, not an if. Per-IP+email limiting slows it by orders of magnitude.
const loginRateLimit = {
  rateLimit: {
    max: 10,
    timeWindow: "1 minute",
    keyGenerator: (req) => `${req.ip}:${req.body?.email ?? ""}`,
    hook: "preHandler", // body is parsed by then, so the email is usable in the key
  },
};

export async function authRoutes(app) {
  const users = app.userRepository;
  const sessions = app.sessionRepository;

  app.post("/auth/register", {
    schema: { body: credentialsSchema },
    config: loginRateLimit,
  }, async (req, reply) => {
    const { email, password } = req.body;
    const password_hash = await hashPassword(password);
    try {
      const user = await users.create({ email, password_hash });
      return reply.code(201).send({ id: user.id, email: user.email });
    } catch (err) {
      if (err.code === "23505") { // unique_violation
        return reply.code(409).send({ error: "email already registered" });
      }
      throw err;
    }
  });

  app.post("/auth/login", {
    schema: { body: credentialsSchema },
    config: loginRateLimit,
  }, async (req, reply) => {
    const user = await users.findByEmail(req.body.email);
    // 🛡️ Burn a hash verification even when the user doesn't exist, so
    // "unknown email" and "wrong password" take the same time.
    const hash = user?.password_hash ?? DUMMY_ARGON2_HASH;
    const ok = await verifyPassword(hash, req.body.password);
    if (!user || !ok) {
      // one message for both cases: no account enumeration
      return reply.code(401).send({ error: "invalid email or password" });
    }

    const token = newSessionToken();
    await sessions.create({
      token_hash: hashToken(token),
      user_id: user.id,
      expires_at: sessionExpiry(),
    });

    reply.setCookie("session", token, {
      httpOnly: true,                        // JS cannot read it → XSS can't exfiltrate it
      secure: config.env !== "development",  // HTTPS-only outside dev
      sameSite: "lax",                       // cross-site POSTs don't carry it → CSRF baseline
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
