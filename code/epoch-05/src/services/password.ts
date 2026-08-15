import argon2 from "argon2";

// OWASP-recommended baseline: 19 MiB memory, 2 iterations, parallelism 1.
const OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (plain: string): Promise<string> => argon2.hash(plain, OPTS);
export const verifyPassword = (hash: string, plain: string): Promise<boolean> =>
  argon2.verify(hash, plain);

// 🛡️ Burned on login attempts against nonexistent emails (no timing oracle).
export const DUMMY_ARGON2_HASH = await hashPassword("dummy-password-for-timing");
