/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: true,
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
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
