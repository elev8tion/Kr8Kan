import { Redis } from "ioredis";

import { createLoggerSafe } from "./log";

/**
 * Optional Redis (rate limiting). Absent REDIS_URL → returns null and the
 * API falls back to in-memory limiting. Compose profile binds :6380.
 */

const globalForRedis = globalThis as unknown as { kr8kanRedis?: Redis | null };

export function getRedis(): Redis | null {
  if (globalForRedis.kr8kanRedis !== undefined) {
    return globalForRedis.kr8kanRedis;
  }
  const url = process.env.REDIS_URL;
  if (!url) {
    globalForRedis.kr8kanRedis = null;
    return null;
  }
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
  client.on("error", (err) => {
    createLoggerSafe().warn({ err: err.message }, "redis error");
  });
  globalForRedis.kr8kanRedis = client;
  return client;
}
