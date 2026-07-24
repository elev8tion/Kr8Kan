#!/usr/bin/env tsx
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

/**
 * kr8kan-mcp — optional MCP server exposing the LOCAL Kr8Kan REST API
 * (default http://localhost:3310) as tools. Configure:
 *   KR8KAN_BASE_URL  (default http://localhost:3310)
 *   KR8KAN_API_TOKEN (API key from Settings → API)
 *
 * Run: pnpm -F @kr8kan/mcp start   (stdio transport)
 */

const BASE_URL = process.env.KR8KAN_BASE_URL ?? "http://localhost:3310";
const API_TOKEN = process.env.KR8KAN_API_TOKEN ?? "";

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`Kr8Kan API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({ name: "kr8kan", version: "0.1.0" });

server.tool(
  "list_workspaces",
  "List Kr8Kan workspaces visible to the configured API key",
  {},
  async () => jsonResult(await api("/workspaces")),
);

server.tool(
  "list_boards",
  "List boards in a workspace",
  { workspacePublicId: z.string().length(12) },
  async ({ workspacePublicId }) =>
    jsonResult(await api(`/workspaces/${workspacePublicId}/boards`)),
);

server.tool(
  "get_board",
  "Get a board with its lists and cards",
  { boardPublicId: z.string().length(12) },
  async ({ boardPublicId }) => jsonResult(await api(`/boards/${boardPublicId}`)),
);

server.tool(
  "get_card",
  "Get a card with checklists, comments, and activity",
  { cardPublicId: z.string().length(12) },
  async ({ cardPublicId }) => jsonResult(await api(`/cards/${cardPublicId}`)),
);

server.tool(
  "create_card",
  "Create a card in a list",
  {
    listPublicId: z.string().length(12),
    title: z.string().min(1).max(500),
    description: z.string().max(20000).optional(),
  },
  async (args) =>
    jsonResult(await api("/cards", { method: "POST", body: JSON.stringify(args) })),
);

server.tool(
  "move_card",
  "Move a card to a list at a position",
  {
    cardPublicId: z.string().length(12),
    toListPublicId: z.string().length(12),
    position: z.number().int().min(0),
  },
  async ({ cardPublicId, ...rest }) =>
    jsonResult(
      await api(`/cards/${cardPublicId}/move`, {
        method: "POST",
        body: JSON.stringify(rest),
      }),
    ),
);

server.tool(
  "run_ai_worker",
  "Run a Kr8Kan Pi AI worker (summarize-board, draft-card, triage-card, breakdown-card, standup, custom)",
  {
    worker: z.string(),
    boardPublicId: z.string().length(12).optional(),
    cardPublicId: z.string().length(12).optional(),
    prompt: z.string().max(4000).optional(),
  },
  async (args) =>
    jsonResult(await api("/agents/run", { method: "POST", body: JSON.stringify(args) })),
);

server.tool(
  "get_ai_job",
  "Get status/result of a Pi worker job",
  { jobId: z.string() },
  async ({ jobId }) => jsonResult(await api(`/agents/jobs/${jobId}`)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
