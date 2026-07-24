import { z } from "zod";

/**
 * Structured-output contract per worker. Every catalog worker (except
 * `custom`) must end its reply with exactly one fenced ```json block
 * matching its schema; parse.ts extracts and validates it fail-closed.
 * Bump the worker's promptVersion in registry.ts whenever a schema or
 * its prompt changes shape.
 */

export const draftCardSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10_000).optional().default(""),
  checklist: z.array(z.string().min(1).max(500)).max(50).default([]),
  suggestedListPublicId: z.string().length(12).optional(),
});
export type DraftCardResult = z.infer<typeof draftCardSchema>;

export const triageCardSchema = z.object({
  listPublicId: z.string().length(12),
  labelPublicIds: z.array(z.string().length(12)).max(20).default([]),
  reasoning: z.string().max(2000).optional(),
});
export type TriageCardResult = z.infer<typeof triageCardSchema>;

export const breakdownCardSchema = z.object({
  checklistName: z.string().min(1).max(160).default("Breakdown"),
  items: z.array(z.string().min(1).max(500)).min(1).max(50),
});
export type BreakdownCardResult = z.infer<typeof breakdownCardSchema>;

export const standupSchema = z.object({
  sections: z.object({
    done: z.array(z.string().max(500)).default([]),
    doing: z.array(z.string().max(500)).default([]),
    blocked: z.array(z.string().max(500)).default([]),
  }),
});
export type StandupResult = z.infer<typeof standupSchema>;

export const summarizeBoardSchema = z.object({
  summary: z.string().min(1).max(10_000),
  highlights: z.array(z.string().max(500)).max(20).default([]),
});
export type SummarizeBoardResult = z.infer<typeof summarizeBoardSchema>;

export const devTaskSchema = z.object({
  what: z.string().min(1).max(10_000),
  howToVerify: z.string().max(5000).default(""),
  notes: z.string().max(10_000).default(""),
  checklistItemsDone: z.array(z.string().max(500)).max(50).optional(),
});
export type DevTaskResult = z.infer<typeof devTaskSchema>;

/** `custom` has no schema — raw output only, apply limited to comment. */
export const WORKER_SCHEMAS: Record<string, z.ZodTypeAny | null> = {
  "summarize-board": summarizeBoardSchema,
  "draft-card": draftCardSchema,
  "triage-card": triageCardSchema,
  "breakdown-card": breakdownCardSchema,
  standup: standupSchema,
  "dev-task": devTaskSchema,
  custom: null,
};
