import type { NextApiRequest, NextApiResponse } from "next";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";

import { callerFor } from "~/server/caller";

/** GET /api/agents/status?jobId=… — job status/result. */
export default async function statusRoute(req: NextApiRequest, res: NextApiResponse) {
  const jobId = typeof req.query.jobId === "string" ? req.query.jobId : "";
  try {
    const caller = await callerFor(req);
    const job = await caller.agent.status({ jobId });
    res.status(200).json(job);
  } catch (err) {
    if (err instanceof TRPCError) {
      res
        .status(getHTTPStatusCodeFromError(err))
        .json({ error: err.message, code: err.code });
      return;
    }
    res.status(500).json({ error: "internal error" });
  }
}
