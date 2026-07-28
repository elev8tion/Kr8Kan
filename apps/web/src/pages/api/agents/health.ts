import type { NextApiRequest, NextApiResponse } from "next";

import { checkPiHealth, workersEnabled } from "@kr8kan/agents";

import { callerFor } from "~/server/caller";

/**
 * Liveness probe for the Pi worker runtime. Unauthenticated callers get
 * `{ ok, enabled }` only; full detail (PI_BIN, agent home, roots) requires
 * a session or API key.
 */
export default async function healthRoute(req: NextApiRequest, res: NextApiResponse) {
  const health = await checkPiHealth();
  const enabled = workersEnabled();

  try {
    const caller = await callerFor(req);
    // Full detail (PI_BIN, agent home, roots) is admin-only — the router
    // redacts unless the caller is an admin of this workspace.
    const workspacePublicId =
      typeof req.query.workspacePublicId === "string"
        ? req.query.workspacePublicId
        : undefined;
    const full = await caller.agent.health(
      workspacePublicId ? { workspacePublicId } : undefined,
    );
    res.status(health.ok ? 200 : 503).json(full);
    return;
  } catch {
    // unauthenticated — minimal response, no paths leaked
  }
  res.status(health.ok ? 200 : 503).json({ ok: health.ok, enabled });
}
