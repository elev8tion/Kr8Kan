import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { apiKey, genericOAuth, magicLink } from "better-auth/plugins";

import type { Database } from "@kr8kan/db";
import { sendEmail } from "@kr8kan/email";
import { createLogger } from "@kr8kan/logger";

import { ncbAdapter } from "./ncb-adapter";
import { quickLogin } from "./quick-login";

const logger = createLogger("auth");

/** Quick login is on only when the operator explicitly opts in. Server-side
 * master switch: when off, the `/quick-login` endpoint is not registered. */
export function isQuickLoginEnabled(): boolean {
  return process.env.KR8KAN_QUICK_LOGIN === "true";
}

/**
 * Kr8Kan auth — better-auth for a private self-hosted instance.
 *
 * Intentionally absent vs upstream Kan: the Stripe plugin, customer
 * creation on sign-up, trials, plan hooks, and the Novu sign-up
 * notification dependency (we log + optionally send an SMTP welcome).
 */
export function initAuth(db: Database) {
  const baseURL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3310";
  const allowCredentials = process.env.NEXT_PUBLIC_ALLOW_CREDENTIALS === "true";
  const disableSignUp = process.env.NEXT_PUBLIC_DISABLE_SIGN_UP === "true";
  const allowedDomains = (process.env.BETTER_AUTH_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  const trustedOrigins = [
    baseURL,
    ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  ];

  const socialProviders: Record<
    string,
    { clientId: string; clientSecret: string }
  > = {};
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
  }
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    socialProviders.github = {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    };
  }

  const plugins = [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendEmail(email, { type: "MAGIC_LINK", url });
      },
      expiresIn: 300,
    }),
    apiKey({
      // REST callers authenticate with either `x-api-key: <key>` or
      // `Authorization: Bearer <key>`; both resolve to a session.
      enableSessionForAPIKeys: true,
      // The tRPC layer already enforces 100 req/min; better-auth's per-key
      // default (10/day) would strangle REST + worker polling on a private box.
      rateLimit: { enabled: false },
      customAPIKeyGetter: (ctx) => {
        const direct = ctx.headers?.get("x-api-key");
        if (direct) return direct;
        const bearer = ctx.headers?.get("authorization");
        if (bearer?.startsWith("Bearer ")) return bearer.slice(7);
        return null;
      },
    }),
  ];

  if (
    process.env.OIDC_CLIENT_ID &&
    process.env.OIDC_CLIENT_SECRET &&
    process.env.OIDC_DISCOVERY_URL
  ) {
    plugins.push(
      genericOAuth({
        config: [
          {
            providerId: "oidc",
            clientId: process.env.OIDC_CLIENT_ID,
            clientSecret: process.env.OIDC_CLIENT_SECRET,
            discoveryUrl: process.env.OIDC_DISCOVERY_URL,
            scopes: ["openid", "profile", "email"],
          },
        ],
      }) as never,
    );
  }

  // Quick login: self-host/dev one-click sign-in for a single operator.
  // Registered only when KR8KAN_QUICK_LOGIN=true AND an email is configured.
  if (isQuickLoginEnabled() && process.env.KR8KAN_QUICK_LOGIN_EMAIL) {
    plugins.push(
      quickLogin({
        email: process.env.KR8KAN_QUICK_LOGIN_EMAIL,
        name: process.env.KR8KAN_QUICK_LOGIN_NAME,
        allowedDomains,
      }) as never,
    );
  }

  return betterAuth({
    baseURL,
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins,
    database: ncbAdapter(db),
    advanced: {
      cookiePrefix: "kr8kan",
    },
    emailAndPassword: {
      enabled: allowCredentials,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(user.email, { type: "RESET_PASSWORD", url });
      },
    },
    socialProviders,
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (disableSignUp) {
              // Sign-up is locked, but an invited user still needs an
              // account to redeem their invite — let them through if a
              // live (unaccepted, unexpired) invite exists for their
              // email. Invite emails are exact-match on the NCB gateway
              // and stored as the admin typed them, so compare
              // case-insensitively in JS rather than via the `where`.
              const email = user.email.toLowerCase();
              const openInvites = (await db.findMany("workspaceInvites", {
                where: { acceptedAt: null },
              })) as { email: string | null; expiresAt: Date | null }[];
              const now = Date.now();
              const hasLiveInvite = openInvites.some(
                (invite) =>
                  invite.email?.toLowerCase() === email &&
                  (invite.expiresAt === null ||
                    invite.expiresAt === undefined ||
                    invite.expiresAt.getTime() > now),
              );
              if (!hasLiveInvite) {
                throw new APIError("FORBIDDEN", {
                  message: "Sign-up is disabled on this instance",
                });
              }
            }
            if (allowedDomains.length > 0) {
              const domain = user.email.split("@")[1]?.toLowerCase() ?? "";
              if (!allowedDomains.includes(domain)) {
                throw new APIError("FORBIDDEN", {
                  message: "Email domain is not allowed on this instance",
                });
              }
            }
            return { data: user };
          },
          after: async (user) => {
            // Self-host: log only. No Novu, no CRM, no Stripe customer.
            logger.info({ email: user.email }, "user signed up");
          },
        },
      },
    },
    plugins,
  });
}

export type Auth = ReturnType<typeof initAuth>;
export type Session = Auth["$Infer"]["Session"];
