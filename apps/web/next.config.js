import { config as loadRootEnv } from "dotenv";
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

// Load the root .env directly, regardless of how the server was launched.
// Next only auto-loads .env from the app directory, so `pnpm dev` run from
// apps/web (bypassing the root dotenv wrapper) silently drops every flag —
// NEXT_PUBLIC_QUICK_LOGIN vanished this way once. dotenv is a no-op on a
// missing file and never overrides variables already set by the launcher.
if (monorepoRoot) loadRootEnv({ path: join(monorepoRoot, ".env") });

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
  serverExternalPackages: ["pino", "pino-pretty"],
};

export default config;
