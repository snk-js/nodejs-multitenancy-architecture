import { randomBytes, createHash } from "node:crypto";

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export const newSessionToken = (): string => randomBytes(32).toString("base64url");
export const hashToken = (t: string): string => createHash("sha256").update(t).digest("hex");
export const sessionExpiry = (): Date => new Date(Date.now() + SESSION_TTL_MS);
