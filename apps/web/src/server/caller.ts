import type { NextApiRequest } from "next";

import { appRouter, createCallerFactory, createTRPCContext } from "@kr8kan/api";

import { reqHeaders } from "./headers";

const factory = createCallerFactory(appRouter);

/** Server-side tRPC caller bound to the request's auth context. */
export async function callerFor(req: NextApiRequest) {
  const ctx = await createTRPCContext({ headers: reqHeaders(req) });
  return factory(ctx);
}
