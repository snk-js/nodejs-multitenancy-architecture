import { pino } from "pino";
import { tryGetContext } from "./context.ts";

// Structured logs: events with fields, never interpolated prose.
// The AsyncLocalStorage mixin stamps request id, tenant, and user on EVERY
// line from ANY layer — `tenantId=...` filters the whole system's output
// down to one tenant's story; `reqId=...` down to one request's.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  mixin() {
    const ctx = tryGetContext();
    return ctx
      ? { reqId: ctx.requestId, tenantId: ctx.tenant?.id, userId: ctx.userId }
      : {};
  },
  // 🛡️ Redaction lives HERE, centrally — not in per-callsite vigilance.
  // The day someone logs a whole `req` object, the cookie header contains
  // session tokens: credentials in log storage, readable for the retention
  // period by everyone with log access. Deny by default, again.
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.email", // PII: logs are terrible at surgical deletion (GDPR)
    ],
    censor: "[redacted]",
  },
});
