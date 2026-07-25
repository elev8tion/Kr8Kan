import type { NextApiRequest, NextApiResponse } from "next";

import { getAuth, subscribeLive } from "@kr8kan/api";
import { db, dbReady, workspaceRepo } from "@kr8kan/db";

import { reqHeaders } from "~/server/headers";

/**
 * Per-workspace SSE stream for the channel surface. Auth mirrors tRPC
 * exactly: better-auth session from the request headers, then workspace
 * membership — non-members get the same 404 shape the routers use.
 * Payloads are minimal pointers; clients refetch via tRPC on receipt.
 */

const HEARTBEAT_MS = 25_000;

export const config = {
  api: { responseLimit: false },
};

export default async function liveRoute(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const workspacePublicId =
    typeof req.query.workspaceId === "string" ? req.query.workspaceId : "";
  await dbReady();
  const session = await getAuth().api.getSession({
    headers: reqHeaders(req),
  });
  if (!session?.user) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  const workspace = await workspaceRepo.getWorkspaceByPublicId(
    db,
    workspacePublicId,
  );
  const membership = workspace
    ? await workspaceRepo.getMembership(db, session.user.id, workspace.id)
    : null;
  if (!workspace || !membership) {
    res.status(404).json({ error: "workspace not found" });
    return;
  }

  const unsubscribe = subscribeLive(workspace.id, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  if (!unsubscribe) {
    // Workspace at the subscriber cap: refuse honestly — the client
    // keeps its polling fallback, nothing is silently dropped.
    res.status(503).json({ error: "too many live connections" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // nginx and friends: do not buffer the stream
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");

  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, HEARTBEAT_MS);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
