import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/**
 * Database client.
 *  - POSTGRES_URL set  → postgres-js against a real Postgres (compose: :5433)
 *  - POSTGRES_URL empty → embedded PGLite persisted at .kr8kan/pglite,
 *    auto-migrated on first boot. Zero external services needed.
 *
 * Both drivers expose the same Drizzle API; we normalize the type to the
 * postgres-js flavour so consumers see a single `Database` type.
 */
export type Database = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  kr8kanDb?: Database;
  kr8kanDbReady?: Promise<void>;
};

function createDb(): { db: Database; ready: Promise<void> } {
  const url = process.env.POSTGRES_URL;
  if (url) {
    const client = postgres(url, { max: 10 });
    return {
      db: drizzlePostgres(client, { schema }),
      ready: Promise.resolve(),
    };
  }

  /* eslint-disable @typescript-eslint/no-require-imports */
  // Lazy requires keep pglite out of the bundle when Postgres is used.
  const { PGlite } =
    require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
  const { drizzle: drizzlePglite } =
    require("drizzle-orm/pglite") as typeof import("drizzle-orm/pglite");
  /* eslint-enable @typescript-eslint/no-require-imports */

  const dataDir = process.env.KR8KAN_PGLITE_DIR ?? defaultPgliteDir();
  const pglite = new PGlite(dataDir);
  const db = drizzlePglite(pglite, { schema }) as unknown as Database;
  const ready = autoMigratePglite(db);
  return { db, ready };
}

/** Anchor the embedded store at the workspace root (walk up from cwd to
 * pnpm-workspace.yaml) so dev/migrate/docker all hit the same files. */
function defaultPgliteDir(): string {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { existsSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  /* eslint-enable @typescript-eslint/no-require-imports */
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      const target = join(dir, ".kr8kan", "pglite");
      mkdirSync(target, { recursive: true });
      return target;
    }
    dir = join(dir, "..");
  }
  const fallback = join(process.cwd(), ".kr8kan", "pglite");
  mkdirSync(fallback, { recursive: true });
  return fallback;
}

async function autoMigratePglite(db: Database): Promise<void> {
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const folder = await findMigrationsFolder();
  if (!folder) {
    console.warn(
      "[kr8kan/db] migrations folder not found — run `pnpm db:migrate` from the repo root",
    );
    return;
  }
  await migrate(db as never, { migrationsFolder: folder });
}

async function findMigrationsFolder(): Promise<string | null> {
  const { existsSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const candidates: string[] = [];
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(here, "..", "migrations"));
  } catch {
    // bundled — import.meta.url may be unusable
  }
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    candidates.push(join(dir, "packages", "db", "migrations"));
    candidates.push(join(dir, "migrations"));
    dir = join(dir, "..");
  }
  for (const c of candidates) {
    if (existsSync(join(c, "meta", "_journal.json"))) return c;
  }
  return null;
}

function getOrCreate(): Database {
  if (!globalForDb.kr8kanDb) {
    const { db, ready } = createDb();
    globalForDb.kr8kanDb = db;
    globalForDb.kr8kanDbReady = ready;
  }
  return globalForDb.kr8kanDb;
}

export const db: Database = getOrCreate();

/** Resolves once the (PGLite) auto-migration finished. No-op for Postgres. */
export function dbReady(): Promise<void> {
  return globalForDb.kr8kanDbReady ?? Promise.resolve();
}

export { schema };
