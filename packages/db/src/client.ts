import type { NcbGateway } from "./ncb/gateway";
import { createGatewayFromEnv } from "./ncb/gateway";

import * as schema from "./schema";

/**
 * Database client — NoCodeBackend REST gateway.
 *
 * The Postgres/PGLite Drizzle client was replaced by the NCB data-store
 * gateway (instance from NCB_INSTANCE, auth via NCB_SECRET_KEY). The
 * Drizzle schema files remain the type source of truth: repository Row
 * types still derive from `$inferSelect`, and the gateway's table specs
 * mirror the same shapes onto the MySQL columns (see ncb/tables.ts for
 * the reserved-word renames).
 */
export type Database = NcbGateway;

const globalForDb = globalThis as unknown as {
  kr8kanDb?: Database;
};

function getOrCreate(): Database {
  if (!globalForDb.kr8kanDb) {
    globalForDb.kr8kanDb = createGatewayFromEnv();
  }
  return globalForDb.kr8kanDb;
}

/** Lazy proxy: env is read on first use, not at import time, so builds
 * and tooling that merely import the module never need NCB credentials. */
export const db: Database = new Proxy({} as Database, {
  get(_t, prop, receiver) {
    const real = getOrCreate();
    const value = Reflect.get(real, prop, real) as unknown;
    return typeof value === "function" ? value.bind(real) : value;
  },
});

/** Kept for API compatibility — the NCB gateway needs no migration wait. */
export function dbReady(): Promise<void> {
  return Promise.resolve();
}

export { schema };
