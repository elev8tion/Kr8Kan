import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { OpenApiMeta } from "trpc-to-openapi";
import { ZodError } from "zod";

import type { TRPCContext } from "./context";

const t = initTRPC
  .meta<OpenApiMeta>()
  .context<TRPCContext>()
  .create({
    transformer: superjson,
    errorFormatter({ shape, error }) {
      return {
        ...shape,
        data: {
          ...shape.data,
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
