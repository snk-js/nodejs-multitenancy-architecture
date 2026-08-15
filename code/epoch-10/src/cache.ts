import { redis } from "./redis.ts";

// Cache-aside with the three rules that keep caching from becoming your best
// bug generator:
//   1. tenant id in every key (callers build keys via tenantKey below)
//   2. TTL on everything — a missed invalidation is wrong for ≤ttl, not forever
//   3. invalidate on write, tolerate the sub-second race; where staleness is
//      unacceptable (permissions!), don't cache.
export async function cached<T>(key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
  if (!redis) return load(); // no Redis configured → pass-through

  try {
    const hit = await redis.get(key);
    if (hit !== null) return JSON.parse(hit) as T;
  } catch {
    return load(); // 🛡️ a broken cache must degrade to "slower", never to "down"
  }

  const value = await load();
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSec);
  } catch {
    // ignore: same principle
  }
  return value;
}

export async function invalidate(key: string): Promise<void> {
  try {
    await redis?.del(key);
  } catch {
    // TTL is the backstop for exactly this failure
  }
}

// 🛡️ A cache is a data store: Epoch 06's laws follow the data into it.
export const tenantKey = (tenantId: string, suffix: string): string =>
  `ws:${tenantId}:${suffix}`;
