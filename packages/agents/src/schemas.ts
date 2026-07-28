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
  /** Optional workspace card-template name this draft resembles —
   * surfaced as a hint in the UI, never applied automatically. */
  templateName: z.string().min(1).max(120).optional(),
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
  /** One-paragraph digest — what workflow templates interpolate as
   * `{{steps.N.result.summary}}`. */
  summary: z.string().min(1).max(2000),
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

export const diagnosticianSchema = z.object({
  whatFailed: z.string().min(1).max(1000),
  probableCause: z.string().min(1).max(2000),
  evidence: z.array(z.string().max(500)).max(8).default([]),
  suggestedFix: z.string().min(1).max(2000),
});
export type DiagnosticianResult = z.infer<typeof diagnosticianSchema>;

export const judgeSchema = z.object({
  verdict: z.enum(["pass", "warn", "fail"]),
  reasons: z.array(z.string().max(500)).max(8).default([]),
  notes: z.string().max(2000).optional(),
});
export type JudgeResult = z.infer<typeof judgeSchema>;

export const evalReviewSchema = z.object({
  summary: z.string().min(1).max(5000),
  proposals: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        detail: z.string().min(1).max(2000),
      }),
    )
    .max(10)
    .default([]),
});
export type EvalReviewResult = z.infer<typeof evalReviewSchema>;

export const devTaskSchema = z.object({
  what: z.string().min(1).max(10_000),
  howToVerify: z.string().max(5000).default(""),
  notes: z.string().max(10_000).default(""),
  checklistItemsDone: z.array(z.string().max(500)).max(50).optional(),
});
export type DevTaskResult = z.infer<typeof devTaskSchema>;

/**
 * Output-contract snippets auto-appended to workspace-defined custom
 * workers that borrow a stock schema — the operator writes personality,
 * the contract is injected, so prompt/schema drift is impossible.
 */
export const SCHEMA_CONTRACT_SNIPPETS: Record<string, string> = {
  "draft-card": `\n\n## Output contract\nEnd your reply with exactly ONE fenced \`\`\`json block (the last thing in the reply):\n\`\`\`json\n{"title": "...", "description": "...", "checklist": ["..."], "suggestedListPublicId": "abc123def456"}\n\`\`\`\n"suggestedListPublicId" is optional — only a publicId copied verbatim from context. Never invent publicIds.`,
  "triage-card": `\n\n## Output contract\nEnd your reply with exactly ONE fenced \`\`\`json block (the last thing in the reply):\n\`\`\`json\n{"listPublicId": "abc123def456", "labelPublicIds": ["..."], "reasoning": "..."}\n\`\`\`\nIds MUST be copied verbatim from the provided context. Never invent publicIds.`,
  "breakdown-card": `\n\n## Output contract\nEnd your reply with exactly ONE fenced \`\`\`json block (the last thing in the reply):\n\`\`\`json\n{"checklistName": "Breakdown", "items": ["step 1", "step 2"]}\n\`\`\``,
  standup: `\n\n## Output contract\nEnd your reply with exactly ONE fenced \`\`\`json block (the last thing in the reply):\n\`\`\`json\n{"summary": "One-paragraph digest of the update.", "sections": {"done": ["..."], "doing": ["..."], "blocked": ["..."]}}\n\`\`\``,
  "summarize-board": `\n\n## Output contract\nEnd your reply with exactly ONE fenced \`\`\`json block (the last thing in the reply):\n\`\`\`json\n{"summary": "...", "highlights": ["..."]}\n\`\`\``,
  diagnostician: `\n\n## Output contract\nEnd your reply with exactly ONE fenced \`\`\`json block (the last thing in the reply):\n\`\`\`json\n{"whatFailed": "...", "probableCause": "...", "evidence": ["..."], "suggestedFix": "..."}\n\`\`\`\nGround every claim in the provided failure context. Never invent evidence.`,
};

/** `custom` has no schema — raw output only, apply limited to comment. */
export const WORKER_SCHEMAS: Record<string, z.ZodTypeAny | null> = {
  "summarize-board": summarizeBoardSchema,
  "draft-card": draftCardSchema,
  "triage-card": triageCardSchema,
  "breakdown-card": breakdownCardSchema,
  standup: standupSchema,
  "dev-task": devTaskSchema,
  diagnostician: diagnosticianSchema,
  judge: judgeSchema,
  "eval-reviewer": evalReviewSchema,
  custom: null,
};
