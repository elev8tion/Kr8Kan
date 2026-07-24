import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url:
      process.env.POSTGRES_URL ??
      "postgres://kr8kan:kr8kan@localhost:5433/kr8kan",
  },
});
