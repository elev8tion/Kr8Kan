import { createAuthEndpoint } from "@better-auth/core/api";
import { APIError } from "better-auth";
import { setSessionCookie } from "better-auth/cookies";
import { parseUserOutput } from "better-auth/db";
import type { BetterAuthPlugin, User } from "better-auth";

/**
 * Quick login — a self-host / dev convenience that mints a session for a single
 * configured operator without email, password, or magic link.
 *
 * This plugin is registered ONLY when `KR8KAN_QUICK_LOGIN=true`. When the flag
 * is off, the endpoint does not exist (better-auth 404s) and the UI button is
 * hidden, so there is nothing to bypass in a real deployment.
 *
 * The session is created through the exact same trusted path better-auth's own
 * magic-link and anonymous plugins use: `internalAdapter.createSession(userId)`
 * + `setSessionCookie`. No hand-rolled cookie signing.
 *
 * Safety:
 *   - Targets exactly one email (`KR8KAN_QUICK_LOGIN_EMAIL`), never "anyone".
 *   - Respects `BETTER_AUTH_ALLOWED_DOMAINS` if set when auto-creating a user.
 *   - Auto-create only happens because the operator explicitly opted in on
 *     their own box; it is the only user this endpoint ever creates.
 */
export function quickLogin(options: {
  email: string;
  name?: string;
  allowedDomains?: string[];
}): BetterAuthPlugin {
  const { email, name, allowedDomains = [] } = options;

  return {
    id: "quick-login",
    endpoints: {
      quickLogin: createAuthEndpoint(
        "/quick-login",
        {
          method: "POST",
          metadata: {
            // Server-only endpoint; no client plugin, no OpenAPI exposure.
            isOpenAPI: false,
          },
        },
        async (ctx) => {
          // Find or create the single configured operator.
          let user: User;
          const found = await ctx.context.internalAdapter.findUserByEmail(email);
          if (found?.user) {
            user = found.user as User;
          } else {
            if (allowedDomains.length > 0) {
              const domain = email.split("@")[1]?.toLowerCase() ?? "";
              if (!allowedDomains.includes(domain)) {
                throw new APIError("FORBIDDEN", {
                  message:
                    "Quick-login email is not in BETTER_AUTH_ALLOWED_DOMAINS",
                });
              }
            }
            const created = await ctx.context.internalAdapter.createUser({
              email,
              name: name ?? email.split("@")[0] ?? "Operator",
              emailVerified: true, // operator opted in on their own box
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            if (!created) {
              throw new APIError("INTERNAL_SERVER_ERROR", {
                message: "Could not create quick-login user",
              });
            }
            user = created as User;
          }

          const session = await ctx.context.internalAdapter.createSession(
            user.id,
          );
          if (!session) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Could not create session",
            });
          }

          await setSessionCookie(ctx, {
            session,
            user,
          });

          return ctx.json({
            user: parseUserOutput(ctx.context.options, user),
          });
        },
      ),
    },
  };
}
