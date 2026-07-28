import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { OpenApiMeta } from "trpc-to-openapi";
import { ZodError } from "zod";

import { NcbError } from "@kr8kan/db";
import { createLogger } from "@kr8kan/logger";

import type { TRPCContext } from "./context";

const logger = createLogger("trpc");

/** True for the NCB HTTP client's error class — checked by name rather
 * than a bare `instanceof` so it still matches across a duplicated
 * @kr8kan/db module instance (pnpm workspace hoisting quirks). */
function isNcbError(err: unknown): err is NcbError {
  return (
    err instanceof NcbError ||
    (err instanceof Error && err.name === "NcbError")
  );
}

const t = initTRPC
  .meta<OpenApiMeta>()
  .context<TRPCContext>()
  .create({
    transformer: superjson,
    errorFormatter({ shape, error }) {
      // NCB HTTP errors (raw response bodies, upstream status text) must
      // never reach the client — they can leak internal store details.
      // Log the real error server-side and surface a generic message.
      const cause = error.cause;
      if (isNcbError(cause) || isNcbError(error)) {
        logger.error(
          { err: isNcbError(cause) ? cause : error },
          "NCB data-store error surfaced to a tRPC procedure",
        );
        return {
          ...shape,
          message: "data store unavailable",
          data: {
            ...shape.data,
            // Server stack traces (webpack-internal paths) never go to
            // the client — not even outside production.
            stack: undefined,
            code: "INTERNAL_SERVER_ERROR",
            httpStatus: 500,
            zodError: null,
          },
        };
      }
      return {
        ...shape,
        data: {
          ...shape.data,
          stack: undefined,
          zodError:
            error.cause instanceof ZodError ? error.cause.flatten() : null,
        },
      };
    },
  });

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;

/* ── rate limiting: Redis-free default, 100 req/min per session/IP ── */

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 100;
const buckets = new Map<string, { count: number; resetAt: number }>();

const rateLimitMiddleware = t.middleware(({ ctx, next }) => {
  const key =
    ctx.session?.user.id ??
    ctx.headers.get("x-forwarded-for") ??
    ctx.headers.get("x-real-ip") ??
    "anonymous";
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else if (++bucket.count > MAX_REQUESTS) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Rate limit exceeded (100 requests/minute)",
    });
  }
  if (buckets.size > 10_000) buckets.clear();
  return next();
});

export const publicProcedure = t.procedure.use(rateLimitMiddleware);

export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: { ...ctx, session: ctx.session, user: ctx.session.user },
  });
});
