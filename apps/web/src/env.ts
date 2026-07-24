import { z } from "zod";

/**
 * Self-host env contract. Only NEXT_PUBLIC_BASE_URL + BETTER_AUTH_SECRET
 * are required; everything else (Postgres, Redis, SMTP, S3, OAuth, Pi)
 * enhances but is optional for boot. Validated once at server start.
 */
const serverSchema = z.object({
  BETTER_AUTH_SECRET: z
    .string()
    .min(16, "BETTER_AUTH_SECRET must be at least 16 chars"),
  POSTGRES_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  NEXT_PUBLIC_BASE_URL: z.string().url().default("http://localhost:3310"),
});

export function validateEnv(): void {
  if (process.env.SKIP_ENV_VALIDATION === "true") return;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      "❌ Invalid environment:",
      parsed.error.flatten().fieldErrors,
    );
    throw new Error("Invalid environment — check your .env against .env.example");
  }
}

export const publicEnv = {
  baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3310",
  allowCredentials: process.env.NEXT_PUBLIC_ALLOW_CREDENTIALS === "true",
  disableSignUp: process.env.NEXT_PUBLIC_DISABLE_SIGN_UP === "true",
};
