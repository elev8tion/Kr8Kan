import type { NextApiRequest, NextApiResponse } from "next";
import { createOpenApiNextHandler } from "trpc-to-openapi";

import { appRouter, createTRPCContext } from "@kr8kan/api";

import { reqHeaders } from "~/server/headers";

/**
 * REST surface generated from the tRPC routers (procedures with openapi
 * meta), served under /api/v1/*. Auth: session cookie, Bearer API key,
 * or x-api-key.
 */
const handler = createOpenApiNextHandler({
  router: appRouter,
  createContext: ({ req }: { req: NextApiRequest }) =>
    createTRPCContext({ headers: reqHeaders(req) }),
  onError:
    process.env.NODE_ENV === "development"
      ? ({ path, error }: { path?: string; error: Error }) => {
          console.error(`❌ REST failed on ${path ?? "<no-path>"}:`, error.message);
        }
      : undefined,
});

export default function v1Route(req: NextApiRequest, res: NextApiResponse) {
  return handler(req, res);
}
