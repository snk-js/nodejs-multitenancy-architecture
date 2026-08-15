import { Redis } from "ioredis";
import { config } from "./config.ts";

// One shared client. Null when REDIS_URL is unset (tests, minimal dev):
// consumers degrade gracefully — cache becomes pass-through, rate limits
// fall back to per-process memory.
export const redis: Redis | null = config.redisUrl
  ? new Redis(config.redisUrl, {
      maxRetriesPerRequest: 2,   // fail fast: a slow cache must not become slow requests
      enableOfflineQueue: false, // if Redis is down, error now — don't buffer forever
    })
  : null;

redis?.on("error", (err) => {
  console.error("redis error", err.message);
});
