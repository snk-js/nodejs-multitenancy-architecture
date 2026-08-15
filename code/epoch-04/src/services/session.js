import { randomBytes, createHash } from "node:crypto";

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// randomBytes = CSPRNG. Math.random() is predictable and has produced real,
// exploited session-token vulnerabilities. Non-negotiable.
export const newSessionToken = () => randomBytes(32).toString("base64url");

// Tokens are 256 random bits — uncrackable by brute force — so a FAST hash is
// correct here; argon2's slowness is only needed against low-entropy passwords.
export const hashToken = (t) => createHash("sha256").update(t).digest("hex");

export const sessionExpiry = () => new Date(Date.now() + SESSION_TTL_MS);
