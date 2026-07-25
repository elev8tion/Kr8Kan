import { z } from "zod";

/**
 * Workflow trigger + step contracts (Buzz-inspired). Shared between the
 * API executor and the settings UI so both validate the same shapes.
 */

const publicId12 = z.string().length(12);

export const workflowTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("card.created"), listPublicId: publicId12.optional() }),
  z.object({ type: z.literal("card.moved"), toListPublicId: publicId12.optional() }),
  z.object({ type: z.literal("label.added"), labelPublicId: publicId12.optional() }),
  z.object({
    type: z.literal("card.due"),
    beforeHours: z.number().int().min(1).max(24 * 14),
  }),
  z.object({
    type: z.literal("comment.created"),
    contains: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal("reaction.added"),
    emoji: z.string().max(16),
    onAgentComment: z.boolean().optional(),
  }),
  z.object({
    // Channel surface: a human posts a message. Agent-authored messages
    // NEVER fire this — that's the reply-loop guard (an agent answering
    // in-thread must not re-trigger the workflow that summoned it).
    type: z.literal("message.posted"),
    channelPublicId: publicId12.optional(),
    contains: z.string().max(200).optional(),
  }),
  z.object({ type: z.literal("schedule"), cron: z.string().max(100) }),
  z.object({
    type: z.literal("webhook"),
    slug: z
      .string()
      .min(3)
      .max(64)
      .regex(/^[a-z0-9-]+$/),
  }),
  // System events (the sentinel loop): the app's own failures fire these
  // so a workflow can dispatch a diagnostician instead of waiting for a
  // human to notice a dead job.
  z.object({
    type: z.literal("job.failed"),
    worker: z.string().min(1).max(64).optional(),
  }),
  z.object({
    type: z.literal("job.verify_failed"),
    worker: z.string().min(1).max(64).optional(),
  }),
  z.object({ type: z.literal("workflow.run.failed") }),
]);
export type WorkflowTrigger = z.infer<typeof workflowTriggerSchema>;

/** Trigger types fired by the system itself rather than a user action.
 * Runs started by these never fire further system events (depth-1 guard —
 * a failing diagnostician must not summon another diagnostician). */
export const SYSTEM_EVENT_TRIGGER_TYPES = [
  "job.failed",
  "job.verify_failed",
  "workflow.run.failed",
] as const;

export function isSystemEventTrigger(type: string | undefined): boolean {
  return (SYSTEM_EVENT_TRIGGER_TYPES as readonly string[]).includes(type ?? "");
}

export const workflowStepSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("runWorker"),
    worker: z.string().min(1).max(64),
    promptTemplate: z.string().max(4000).optional(),
  }),
  z.object({
    type: z.literal("gate"),
    emoji: z.string().max(16).default("👍"),
    /** Who may approve: any member holding the needed permissions, or admins only. */
    approvers: z.enum(["member", "admin"]).default("member"),
    timeoutHours: z.number().int().min(1).max(24 * 7).default(24),
    message: z.string().max(1000).optional(),
  }),
  z.object({
    /** Applies the preceding runWorker step's parsed result via its
     * apply preset. Requires a gate immediately before it unless
     * autoApply is explicitly true (default false — no silent mutation). */
    type: z.literal("applyPreset"),
    autoApply: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("postComment"),
    bodyTemplate: z.string().min(1).max(10_000),
    /** Where to post when the trigger has no card (schedule/webhook):
     * a fixed target card. Card-scoped triggers can omit it. */
    targetCardPublicId: publicId12.optional(),
  }),
  z.object({
    /** Write to the board's notes doc — board-scoped, needs no card.
     * append adds a dated separator block; replace overwrites. */
    type: z.literal("postNote"),
    bodyTemplate: z.string().min(1).max(10_000),
    mode: z.enum(["replace", "append"]).default("append"),
  }),
  z.object({
    /** Post to a channel as the workflow identity. Channel-scoped runs
     * (message.posted) may omit the target and post in the triggering
     * channel; every other trigger needs an explicit channel. */
    type: z.literal("postMessage"),
    bodyTemplate: z.string().min(1).max(10_000),
    channelPublicId: publicId12.optional(),
  }),
  z.object({
    type: z.literal("callWebhook"),
    url: z.string().url().max(500),
  }),
]);
export type WorkflowStep = z.infer<typeof workflowStepSchema>;

export const workflowStepsSchema = z
  .array(workflowStepSchema)
  .min(1)
  .max(10)
  .superRefine((steps, ctx) => {
    steps.forEach((step, i) => {
      if (step.type === "applyPreset") {
        const prevGate = steps[i - 1]?.type === "gate";
        if (!prevGate && !step.autoApply) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [i],
            message:
              "applyPreset needs a gate step immediately before it, or explicit autoApply: true",
          });
        }
        const hasWorker = steps.slice(0, i).some((s) => s.type === "runWorker");
        if (!hasWorker) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [i],
            message: "applyPreset needs a runWorker step before it",
          });
        }
      }
    });
  });

/** Trigger events as emitted by the app's choke points. */
export interface WorkflowTriggerEvent {
  type: WorkflowTrigger["type"];
  workspaceId: number;
  boardPublicId?: string;
  cardPublicId?: string;
  listPublicId?: string;
  toListPublicId?: string;
  labelPublicId?: string;
  commentPublicId?: string;
  commentBody?: string;
  commentIsAgent?: boolean;
  /** Channel surface (message.posted): where the message landed. */
  channelPublicId?: string;
  /** Channel surface: the triggering message (gates park in its thread). */
  messagePublicId?: string;
  messageBody?: string;
  /** True when an agent identity authored the message — such events are
   * refused by matchesTrigger (reply-loop guard). */
  messageIsAgent?: boolean;
  emoji?: string;
  /** Set on events caused BY a workflow run — used for loop guarding. */
  workflowRunId?: string;
  /** Actor to attribute triggered work to (falls back to workflow creator). */
  actorUserId?: string;
  /** System events: the failed job (job.failed / job.verify_failed). */
  jobId?: string;
  /** System events: worker name of the failed job. */
  worker?: string;
  /** System events: the failure message. */
  error?: string;
  /** workflow.run.failed: the workflow whose run failed — excluded from
   * the fan-out so a workflow never reacts to its own failure. */
  failedWorkflowPublicId?: string;
  /** workflow.run.failed: the failed run's publicId. */
  failedRunPublicId?: string;
}

export function matchesTrigger(
  trigger: WorkflowTrigger,
  event: WorkflowTriggerEvent,
): boolean {
  if (trigger.type !== event.type) return false;
  switch (trigger.type) {
    case "card.created":
      return !trigger.listPublicId || trigger.listPublicId === event.listPublicId;
    case "card.moved":
      return (
        !trigger.toListPublicId || trigger.toListPublicId === event.toListPublicId
      );
    case "label.added":
      return !trigger.labelPublicId || trigger.labelPublicId === event.labelPublicId;
    case "comment.created":
      return (
        !trigger.contains ||
        (event.commentBody ?? "")
          .toLowerCase()
          .includes(trigger.contains.toLowerCase())
      );
    case "reaction.added":
      return (
        trigger.emoji === event.emoji &&
        (!trigger.onAgentComment || Boolean(event.commentIsAgent))
      );
    case "message.posted":
      // Reply-loop guard: agent-authored messages never fire, no matter
      // what the workflow asks for.
      if (event.messageIsAgent) return false;
      if (
        trigger.channelPublicId &&
        trigger.channelPublicId !== event.channelPublicId
      ) {
        return false;
      }
      return (
        !trigger.contains ||
        (event.messageBody ?? "")
          .toLowerCase()
          .includes(trigger.contains.toLowerCase())
      );
    case "job.failed":
    case "job.verify_failed":
      return !trigger.worker || trigger.worker === event.worker;
    case "workflow.run.failed":
      return true;
    case "card.due":
    case "schedule":
    case "webhook":
      // These fire from the scheduler / webhook route, which pre-select
      // the workflow — matching is identity there.
      return true;
  }
}
