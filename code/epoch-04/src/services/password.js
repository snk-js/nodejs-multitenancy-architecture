import argon2 from "argon2";

// OWASP-recommended baseline: 19 MiB memory, 2 iterations, parallelism 1.
// Parameters are embedded in the hash output, so they can be raised later
// and old hashes upgraded transparently at next successful login.
const OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (plain) => argon2.hash(plain, OPTS);
export const verifyPassword = (hash, plain) => argon2.verify(hash, plain);

// 🛡️ Burned on login attempts against nonexistent emails so that
// "unknown email" and "wrong password" take the same time (no timing oracle).
export const DUMMY_ARGON2_HASH = await hashPassword("dummy-password-for-timing");
