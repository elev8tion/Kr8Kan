import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import type { BrowserArtifact } from "@kr8kan/agents";
import type { NextApiRequest, NextApiResponse } from "next";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";

import { callerFor } from "~/server/caller";

/**
 * GET /api/agents/artifact?jobId=…&name=desktop — a post-verify screenshot.
 *
 * Authorisation rides on agent.status, so whoever may see the job may see
 * its screenshots. The path is taken from the job record rather than the
 * query string; the checks below exist so a malformed record still cannot
 * make this route read an arbitrary file.
 */
export default async function artifactRoute(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const jobId = typeof req.query.jobId === "string" ? req.query.jobId : "";
  const name = typeof req.query.name === "string" ? req.query.name : "";
  if (!/^[a-z0-9-]{1,40}$/.test(name)) {
    res.status(400).json({ error: "invalid artifact name" });
    return;
  }

  try {
    const caller = await callerFor(req);
    const job = await caller.agent.status({ jobId });
    const artifact = job.browserArtifacts?.find(
      (a: BrowserArtifact) => a.name === name,
    );
    if (!artifact) {
      res.status(404).json({ error: "no such artifact" });
      return;
    }

    const path = resolve(artifact.path);
    if (
      basename(path) !== `${name}.png` ||
      basename(dirname(path)) !== job.id
    ) {
      res.status(400).json({ error: "artifact path is not well formed" });
      return;
    }

    const png = await readFile(path);
    res.setHeader("content-type", "image/png");
    res.setHeader("content-length", String(png.byteLength));
    // Job artifacts never change once written, but they are per-job and
    // permissioned, so keep them out of shared caches.
    res.setHeader("cache-control", "private, max-age=31536000, immutable");
    res.status(200).send(png);
  } catch (err) {
    if (err instanceof TRPCError) {
      res
        .status(getHTTPStatusCodeFromError(err))
        .json({ error: err.message, code: err.code });
      return;
    }
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      res.status(404).json({ error: "artifact file is gone" });
      return;
    }
    res.status(500).json({ error: "internal error" });
  }
}
