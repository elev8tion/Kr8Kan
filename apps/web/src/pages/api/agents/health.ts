import type { NextApiRequest, NextApiResponse } from "next";

import { checkPiHealth, workersEnabled } from "@kr8kan/agents";

/** Unauthenticated liveness probe for the Pi worker runtime. */
export default async function healthRoute(_req: NextApiRequest, res: NextApiResponse) {
  const health = await checkPiHealth();
  res.status(health.ok ? 200 : 503).json({
    ...health,
    enabled: workersEnabled(),
  });
}
