import { sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@kr8kan/db";
import { workspaceRepo } from "@kr8kan/db";

import { assertPermission, notFound } from "../permissions";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * search.* — Postgres FTS over cards, comments, and agent results
 * (generated tsvector columns + GIN indexes, same SQL on PGlite).
 * Results are workspace-scoped; membership is the visibility boundary.
 */

interface SearchHit {
  kind: "card" | "comment" | "agent_result";
  cardPublicId?: string;
  commentPublicId?: string;
  jobId?: string;
  boardPublicId?: string;
  title: string;
  snippet: string;
  rank: number;
}

async function rawRows(db: Database, query: ReturnType<typeof sql>) {
  const result = (await db.execute(query)) as unknown;
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return (result as { rows: Record<string, unknown>[] }).rows ?? [];
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
      await assertPermission(ctx.db, ctx.user.id, workspace.id, "workspace:view");
      const limit = input.limit ?? 15;
      const per = Math.max(5, Math.ceil(limit / 3));

      const cardRows = await rawRows(
        ctx.db,
        sql`
          SELECT c.public_id AS card_public_id, b.public_id AS board_public_id,
                 c.title,
                 ts_headline('english', coalesce(c.description, c.title), plainto_tsquery('english', ${input.q}),
                   'MaxWords=18, MinWords=6') AS snippet,
                 ts_rank(c.search_tsv, plainto_tsquery('english', ${input.q})) AS rank
          FROM card c
          JOIN list l ON l.id = c.list_id
          JOIN board b ON b.id = l.board_id
          WHERE b.workspace_id = ${workspace.id}
            AND c.deleted_at IS NULL AND l.deleted_at IS NULL AND b.deleted_at IS NULL
            AND c.search_tsv @@ plainto_tsquery('english', ${input.q})
          ORDER BY rank DESC LIMIT ${per}`,
      );

      const commentRows = await rawRows(
        ctx.db,
        sql`
          SELECT cm.public_id AS comment_public_id, c.public_id AS card_public_id,
                 b.public_id AS board_public_id, c.title,
                 ts_headline('english', cm.comment, plainto_tsquery('english', ${input.q}),
                   'MaxWords=18, MinWords=6') AS snippet,
                 ts_rank(cm.search_tsv, plainto_tsquery('english', ${input.q})) AS rank
          FROM comment cm
          JOIN card c ON c.id = cm.card_id
          JOIN list l ON l.id = c.list_id
          JOIN board b ON b.id = l.board_id
          WHERE b.workspace_id = ${workspace.id}
            AND cm.deleted_at IS NULL AND c.deleted_at IS NULL
            AND cm.search_tsv @@ plainto_tsquery('english', ${input.q})
          ORDER BY rank DESC LIMIT ${per}`,
      );

      const jobRows = await rawRows(
        ctx.db,
        sql`
          SELECT j.public_id AS job_id, j.worker, j.card_public_id, j.board_public_id,
                 ts_headline('english', j.result_raw, plainto_tsquery('english', ${input.q}),
                   'MaxWords=18, MinWords=6') AS snippet,
                 ts_rank(j.search_tsv, plainto_tsquery('english', ${input.q})) AS rank
          FROM agent_job j
          WHERE j.workspace_id = ${workspace.id}
            AND j.search_tsv @@ plainto_tsquery('english', ${input.q})
          ORDER BY rank DESC LIMIT ${per}`,
      );

      const hits: SearchHit[] = [
        ...cardRows.map((r) => ({
          kind: "card" as const,
          cardPublicId: String(r.card_public_id),
          boardPublicId: String(r.board_public_id),
          title: String(r.title),
          snippet: String(r.snippet ?? ""),
          rank: Number(r.rank ?? 0),
        })),
        ...commentRows.map((r) => ({
          kind: "comment" as const,
          commentPublicId: String(r.comment_public_id),
          cardPublicId: String(r.card_public_id),
          boardPublicId: String(r.board_public_id),
          title: String(r.title),
          snippet: String(r.snippet ?? ""),
          rank: Number(r.rank ?? 0),
        })),
        ...jobRows.map((r) => ({
          kind: "agent_result" as const,
          jobId: String(r.job_id),
          cardPublicId: r.card_public_id ? String(r.card_public_id) : undefined,
          boardPublicId: r.board_public_id ? String(r.board_public_id) : undefined,
          title: `${String(r.worker)} result`,
          snippet: String(r.snippet ?? ""),
          rank: Number(r.rank ?? 0),
        })),
      ];
      return hits.sort((a, b) => b.rank - a.rank).slice(0, limit);
    }),
});
