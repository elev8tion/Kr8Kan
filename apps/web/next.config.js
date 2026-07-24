import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Anchor the monorepo root at the directory containing pnpm-workspace.yaml.
// Next.js otherwise infers its root from the nearest lockfile — and a stray
// package-lock.json above this repo makes it pick /Users/kc, which breaks
// .env discovery (NEXT_PUBLIC_* resolve undefined) and .next tracing. This
// matches how packages/db anchors its own paths.
function findMonorepoRoot() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = join(dir, "..");
  }
  return undefined;
}

const monorepoRoot = findMonorepoRoot();

/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: true,
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // Pin the project root so Next.js loads Kr8Kan/.env (not some parent .env)
  // and traces the right files. Fixes the "multiple lockfiles" warning too.
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: [
    "@kr8kan/api",
    "@kr8kan/auth",
    "@kr8kan/db",
    "@kr8kan/shared",
    "@kr8kan/email",
    "@kr8kan/logger",
    "@kr8kan/agents",
  ],
  eslint: { ignoreDuringBuilds: true },
  serverExternalPackages: ["@electric-sql/pglite", "pino", "pino-pretty"],
};

export default config;
