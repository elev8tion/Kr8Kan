import { z } from "zod";

import type { Database } from "@kr8kan/db";
import { workspaceRepo } from "@kr8kan/db";

import { assertPermission, notFound } from "../permissions";
import { createTRPCRouter, protectedProcedure } from "../trpc";

type Row = Record<string, unknown>;

/** Per-parent fan-out fetch, ~8 concurrent (matches the gateway's pattern
 * for per-parent parallel fetches). Avoids instance-wide unfiltered scans
 * while keeping request count bounded — 8-wide batches of otherwise
 * server-filtered (equality where) findMany calls. */
async function mapChunked<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    out.push(...(await Promise.all(batch.map(fn))));
  }
  return out;
}

/**
 * search.* — workspace-scoped search over cards, comments, messages, and
 * agent results. Postgres FTS was replaced by in-process token matching
 * when the data store moved to NoCodeBackend (no SQL surface): rows are
 * fetched through the gateway and ranked in JS. Self-host scale.
 * Results are workspace-scoped; membership is the visibility boundary.
 */

interface SearchHit {
  kind: "card" | "comment" | "message" | "agent_result";
  cardPublicId?: string;
  commentPublicId?: string;
  messagePublicId?: string;
  channelPublicId?: string;
  /** Thread root when the hit is a reply — the UI opens that thread. */
  threadRootPublicId?: string;
  jobId?: string;
  boardPublicId?: string;
  title: string;
  snippet: string;
  rank: number;
}

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
}

/** Token-hit ranking: fraction of query tokens present, phrase bonus. */
function rankText(tokens: string[], phrase: string, text: string): number {
  if (!text) return 0;
  const lower = text.toLowerCase();
  let hits = 0;
  for (const t of tokens) if (lower.includes(t)) hits++;
  if (hits === 0) return 0;
  const base = hits / tokens.length;
  return lower.includes(phrase) ? base + 0.5 : base;
}

/** ~18-word window around the first matched token. */
function makeSnippet(tokens: string[], text: string): string {
  const words = text.split(/\s+/);
  const idx = words.findIndex((w) =>
    tokens.some((t) => w.toLowerCase().includes(t)),
  );
  const start = Math.max(0, (idx === -1 ? 0 : idx) - 6);
  const slice = words.slice(start, start + 18).join(" ");
  return slice.length < text.length ? `${slice}…` : slice;
}

/** boards → lists (per board, chunked) → listToBoard map. All requests are
 * equality-server-filtered (where: boardId), unlike the old unfiltered
 * whole-table `lists` scan this replaces. */
async function workspaceBoardScope(db: Database, workspaceId: number) {
  const boards = await db.findMany("boards", { where: { workspaceId } });
  const listsPerBoard = await mapChunked(boards, 8, (b) =>
    db.findMany("lists", { where: { boardId: b.id } }),
  );
  const lists: Row[] = [];
  const listToBoard = new Map<number, string>();
  boards.forEach((b, i) => {
    for (const l of listsPerBoard[i] ?? []) {
      lists.push(l);
      listToBoard.set(l.id as number, b.publicId as string);
    }
  });
  return { lists, listToBoard };
}

export const searchRouter = createTRPCRouter({
  query: protectedProcedure
    .input(
      z.object({
        workspacePublicId: z.string().length(12),
        q: z.string().min(2).max(200),
        limit: z.number().int().min(1).max(30).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const workspace = await workspaceRepo.getWorkspaceByPublicId(
        ctx.db,
        input.workspacePublicId,
      );
      if (!workspace) notFound("workspace");
      const membership = await assertPermission(
        ctx.db,
        ctx.user.id,
        workspace.id,
        "workspace:view",
      );
      const limit = input.limit ?? 15;
      const tokens = tokenize(input.q);
      const phrase = input.q.toLowerCase();
      if (tokens.length === 0) return [] as SearchHit[];

      const { lists, listToBoard } = await workspaceBoardScope(ctx.db, workspace.id);

      // cards per list, chunked ~8 concurrent — equality-server-filtered
      // (where: listId), replacing the old unfiltered whole-table scan.
      const cardsPerList = await mapChunked(lists, 8, (l) =>
        ctx.db.findMany("cards", { where: { listId: l.id } }),
      );
      const cards: Row[] = cardsPerList.flat();
      const cardById = new Map(cards.map((c) => [c.id as number, c]));

      const hits: SearchHit[] = [];

      for (const c of cards) {
        const text = `${String(c.title)} ${String(c.description ?? "")}`;
        const rank = rankText(tokens, phrase, text);
        if (rank > 0) {
          hits.push({
            kind: "card",
            cardPublicId: String(c.publicId),
            boardPublicId: listToBoard.get(c.listId as number),
            title: String(c.title),
            snippet: makeSnippet(tokens, String(c.description ?? c.title)),
            rank,
          });
        }
      }

      // Comments per card only pay off request-count-wise while the
      // workspace's card set is small; past that, one whole-table scan is
      // cheaper than fanning out hundreds of per-card requests. Trade-off:
      // the whole-table branch reads every workspace's comments, but the
      // loop below still filters to `cardById` (this workspace's cards)
      // before any comment reaches a hit, so nothing cross-workspace leaks
      // out — the cost is purely in rows scanned server-side, not exposure.
      const comments: Row[] =
        cards.length <= 100
          ? (
              await mapChunked(cards, 8, (c) =>
                ctx.db.findMany("comments", { where: { cardId: c.id } }),
              )
            ).flat()
          : await ctx.db.findMany("comments", {});
      for (const cm of comments) {
        const card = cardById.get(cm.cardId as number);
        if (!card) continue;
        const rank = rankText(tokens, phrase, String(cm.comment));
        if (rank > 0) {
          hits.push({
            kind: "comment",
            commentPublicId: String(cm.publicId),
            cardPublicId: String(card.publicId),
            boardPublicId: listToBoard.get(card.listId as number),
            title: String(card.title),
            snippet: makeSnippet(tokens, String(cm.comment)),
            rank,
          });
        }
      }

      const channels = await ctx.db.findMany("channels", {
        where: { workspaceId: workspace.id },
      });
      const channelById = new Map(channels.map((ch) => [ch.id as number, ch]));
      // Messages per channel, chunked ~8 concurrent — equality-server-
      // filtered (where: channelId), replacing the old unfiltered
      // whole-table scan (channels are already workspace-scoped above).
      const messagesPerChannel = await mapChunked(channels, 8, (ch) =>
        ctx.db.findMany("messages", { where: { channelId: ch.id } }),
      );
      const messages: Row[] = messagesPerChannel.flat();
      const messageById = new Map(messages.map((m) => [m.id as number, m]));
      for (const m of messages) {
        const ch = channelById.get(m.channelId as number);
        if (!ch) continue;
        const rank = rankText(tokens, phrase, String(m.body));
        if (rank > 0) {
          const root = m.parentMessageId
            ? messageById.get(m.parentMessageId as number)
            : undefined;
          hits.push({
            kind: "message",
            messagePublicId: String(m.publicId),
            channelPublicId: String(ch.publicId),
            threadRootPublicId: root ? String(root.publicId) : undefined,
            title: `#${String(ch.name)}`,
            snippet: makeSnippet(tokens, String(m.body)),
            rank,
          });
        }
      }

      // Agent-job resultRaw snippets can carry workspace-internal detail
      // beyond what workspace:view alone should hand a guest — gate the
      // whole section on membership role rather than trimming the snippet,
      // so guests never see agent_result hits at all.
      if (membership.role !== "guest") {
        const jobs = await ctx.db.findMany("agentJobs", {
          where: { workspaceId: workspace.id },
        });
        for (const j of jobs) {
          const raw = String(j.resultRaw ?? "");
          const rank = rankText(tokens, phrase, raw);
          if (rank > 0) {
            hits.push({
              kind: "agent_result",
              jobId: String(j.publicId),
              cardPublicId: j.cardPublicId ? String(j.cardPublicId) : undefined,
              boardPublicId: j.boardPublicId ? String(j.boardPublicId) : undefined,
              title: `${String(j.worker)} result`,
              snippet: makeSnippet(tokens, raw),
              rank,
            });
          }
        }
      }

      return hits.sort((a, b) => b.rank - a.rank).slice(0, limit);
    }),
});
