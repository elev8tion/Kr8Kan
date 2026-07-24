import { createNextApiHandler } from "@trpc/server/adapters/next";

import { appRouter, createTRPCContext } from "@kr8kan/api";

import { reqHeaders } from "~/server/headers";

export default createNextApiHandler({
  router: appRouter,
  createContext: ({ req }) => createTRPCContext({ headers: reqHeaders(req) }),
  onError:
    process.env.NODE_ENV === "development"
      ? ({ path, error }) => {
          console.error(`❌ tRPC failed on ${path ?? "<no-path>"}:`, error.message);
        }
      : undefined,
});
