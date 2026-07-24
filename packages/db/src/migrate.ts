/**
 * `pnpm db:migrate` — applies ./migrations to POSTGRES_URL, or to the
 * embedded PGLite store when POSTGRES_URL is empty.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(here, "..", "migrations");

async function main() {
  // Load repo-root .env if present (tsx does not autoload it).
  const envPath = join(here, "..", "..", "..", ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
      if (m && process.env[m[1]!] === undefined) {
        process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
      }
    }
  }

  const url = process.env.POSTGRES_URL;
  if (url) {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const postgres = (await import("postgres")).default;
    const client = postgres(url, { max: 1 });
    console.log("migrating postgres →", url.replace(/:[^:@/]+@/, ":***@"));
    await migrate(drizzle(client), { migrationsFolder });
    await client.end();
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const dataDir =
      process.env.KR8KAN_PGLITE_DIR ??
      join(here, "..", "..", "..", ".kr8kan", "pglite");
    console.log("migrating embedded pglite →", dataDir);
    const pglite = new PGlite(dataDir);
    await migrate(drizzle(pglite), { migrationsFolder });
    await pglite.close();
  }
  console.log("migrations complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
