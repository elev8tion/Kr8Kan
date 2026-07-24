import type { NextApiRequest, NextApiResponse } from "next";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";

import { callerFor } from "~/server/caller";

/** Thin HTTP bridge over agent.run for callers that skip /api/v1. */
export default async function runRoute(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  try {
    const caller = await callerFor(req);
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const result = await caller.agent.run({
      worker: String(body?.worker ?? ""),
      boardPublicId: body?.boardPublicId ?? null,
      cardPublicId: body?.cardPublicId ?? null,
      prompt: body?.prompt ?? null,
    });
    res.status(200).json(result);
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
