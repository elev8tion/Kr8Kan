import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { AppliedAction, JobRecord } from "@kr8kan/agents";
import type { Database } from "@kr8kan/db";
import { agentJobRepo, boardRepo, cardRepo } from "@kr8kan/db";
import { createLogger } from "@kr8kan/logger";
import type { Permission } from "@kr8kan/shared";

import { audit } from "./audit";
import { assertPermission, notFound } from "./permissions";

const logger = createLogger("agent-apply");

/**
 * agent.apply engine: turn a completed job's operator-confirmed actions
 * into real board mutations through the same repos + permissions the UI
 * uses. All referenced entities are prechecked against the job's
 * workspace before anything mutates; application is sequential; applied
 * indices are recorded on the job row so re-apply is a no-op.
 */

const publicId12 = z.string().length(12);

export const applyActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("createCard"),
    listPublicId: publicId12,
    title: z.string().min(1).max(500),
    description: z.string().max(20_000).optional(),
    checklist: z.array(z.string().min(1).max(500)).max(50).optional(),
  }),
  z.object({
    type: z.literal("updateCard"),
    cardPublicId: publicId12,
    title: z.string().min(1).max(500).optional(),
    description: z.string().max(20_000).optional(),
  }),
  z.object({
    type: z.literal("moveCard"),
    cardPublicId: publicId12,
    listPublicId: publicId12,
  }),
  z.object({
    type: z.literal("setLabels"),
    cardPublicId: publicId12,
    labelPublicIds: z.array(publicId12).max(20),
  }),
  z.object({
    type: z.literal("replaceChecklist"),
    cardPublicId: publicId12,
    name: z.string().min(1).max(160).optional(),
    items: z.array(z.string().min(1).max(500)).min(1).max(50),
  }),
  z.object({
    type: z.literal("appendChecklistItems"),
    cardPublicId: publicId12,
    name: z.string().min(1).max(160).optional(),
    items: z.array(z.string().min(1).max(500)).min(1).max(50),
  }),
  z.object({
    type: z.literal("completeChecklistItems"),
    cardPublicId: publicId12,
    items: z.array(z.string().min(1).max(500)).min(1).max(50),
  }),
  z.object({
    type: z.literal("addComment"),
    cardPublicId: publicId12,
    body: z.string().min(1).max(20_000),
  }),
]);

export type ApplyActionInput = z.infer<typeof applyActionSchema>;

const ACTION_PERMISSION: Record<ApplyActionInput["type"], Permission> = {
  createCard: "card:create",
  updateCard: "card:edit",
  moveCard: "card:move",
  setLabels: "card:edit",
  replaceChecklist: "card:edit",
  appendChecklistItems: "card:edit",
  completeChecklistItems: "card:edit",
  addComment: "card:comment",
};

type CardWithBoard = NonNullable<
  Awaited<ReturnType<typeof cardRepo.getCardByPublicId>>
>;

interface ResolvedAction {
  action: ApplyActionInput;
  index: number;
  card?: CardWithBoard;
  listId?: number;
  labelIds?: number[];
}

async function resolveAndCheck(
  db: Database,
  userId: string,
  job: JobRecord,
  action: ApplyActionInput,
  index: number,
): Promise<ResolvedAction> {
  const workspaceId = job.workspaceId;
  if (!workspaceId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "job has no workspace — cannot apply",
    });
  }
  await assertPermission(db, userId, workspaceId, ACTION_PERMISSION[action.type]);

  const resolved: ResolvedAction = { action, index };

  if ("cardPublicId" in action) {
    const card = await cardRepo.getCardByPublicId(db, action.cardPublicId);
    if (!card || card.list.board.workspaceId !== workspaceId) {
      notFound(`card referenced by action ${index}`);
    }
    resolved.card = card;
  }
  if ("listPublicId" in action) {
    const list = await boardRepo.getListByPublicId(db, action.listPublicId);
    if (!list || list.board.workspaceId !== workspaceId) {
      notFound(`list referenced by action ${index}`);
    }
    resolved.listId = list.id;
  }
  if (action.type === "setLabels") {
    resolved.labelIds = [];
    for (const labelPublicId of action.labelPublicIds) {
      const label = await boardRepo.getLabelByPublicId(db, labelPublicId);
      if (!label || label.board.workspaceId !== workspaceId) {
        notFound(`label referenced by action ${index}`);
      }
      resolved.labelIds.push(label.id);
    }
  }
  return resolved;
}

async function performAction(
  db: Database,
  userId: string,
  job: JobRecord,
  resolved: ResolvedAction,
): Promise<{ entityPublicId?: string }> {
  const { action } = resolved;
  const agentMeta = {
    worker: job.worker,
    jobId: job.id,
    actionIndex: resolved.index,
  };
  const recordApplied = (cardId: number) =>
    cardRepo.recordActivity(db, {
      cardId,
      type: "agent.applied",
      userId,
      agentIdentityId: job.agentIdentityId,
      metadata: agentMeta,
    });

  switch (action.type) {
    case "createCard": {
      const card = await cardRepo.createCard(db, {
        listId: resolved.listId!,
        title: action.title,
        description: action.description,
        userId,
      });
      if (action.checklist?.length) {
        const checklist = await cardRepo.createChecklist(db, {
          cardId: card.id,
          name: "Checklist",
        });
        for (const item of action.checklist) {
          await cardRepo.addChecklistItem(db, {
            checklistId: checklist!.id,
            title: item,
          });
        }
      }
      await recordApplied(card.id);
      return { entityPublicId: card.publicId };
    }
    case "updateCard": {
      const card = resolved.card!;
      await cardRepo.updateCard(
        db,
        card.id,
        { title: action.title, description: action.description },
        userId,
      );
      await recordApplied(card.id);
      return { entityPublicId: card.publicId };
    }
    case "moveCard": {
      const card = resolved.card!;
      await cardRepo.moveCard(db, {
        cardId: card.id,
        toListId: resolved.listId!,
        position: 10_000,
        userId,
      });
      await recordApplied(card.id);
      return { entityPublicId: card.publicId };
    }
    case "setLabels": {
      const card = resolved.card!;
      const desired = new Set(resolved.labelIds!);
      const current = new Set(card.labels.map((cl) => cl.label.id));
      for (const labelId of desired) {
        if (!current.has(labelId)) {
          await cardRepo.addLabelToCard(db, card.id, labelId, userId);
        }
      }
      for (const labelId of current) {
        if (!desired.has(labelId)) {
          await cardRepo.removeLabelFromCard(db, card.id, labelId);
        }
      }
      await recordApplied(card.id);
      return { entityPublicId: card.publicId };
    }
    case "replaceChecklist":
    case "appendChecklistItems": {
      const card = resolved.card!;
      const name = action.name ?? "Breakdown";
      let checklist = card.checklists.find((cl) => cl.name === name);
      if (action.type === "replaceChecklist" && checklist) {
        await cardRepo.softDeleteChecklist(db, checklist.id);
        checklist = undefined;
      }
      const existingTitles = new Set(
        (checklist?.items ?? []).map((i) => i.title.trim().toLowerCase()),
      );
      const target =
        checklist ??
        (await cardRepo.createChecklist(db, { cardId: card.id, name }))!;
      for (const item of action.items) {
        // Apply-time dedupe: skip items already present by title.
        if (existingTitles.has(item.trim().toLowerCase())) continue;
        await cardRepo.addChecklistItem(db, { checklistId: target.id, title: item });
      }
      await recordApplied(card.id);
      return { entityPublicId: card.publicId };
    }
    case "completeChecklistItems": {
      const card = resolved.card!;
      const wanted = new Set(action.items.map((i) => i.trim().toLowerCase()));
      for (const checklist of card.checklists) {
        for (const item of checklist.items) {
          if (!item.completed && wanted.has(item.title.trim().toLowerCase())) {
            await cardRepo.updateChecklistItem(db, item.id, { completed: true });
          }
        }
      }
      await recordApplied(card.id);
      return { entityPublicId: card.publicId };
    }
    case "addComment": {
      const card = resolved.card!;
      const comment = await cardRepo.addComment(db, {
        cardId: card.id,
        comment: action.body,
        userId,
        agentIdentityId: job.agentIdentityId,
      });
      await recordApplied(card.id);
      return { entityPublicId: comment?.publicId ?? card.publicId };
    }
  }
}

export interface ApplyResult {
  applied: AppliedAction[];
  skipped: number[];
}

export async function applyJobActions(
  db: Database,
  userId: string,
  job: JobRecord,
  actions: ApplyActionInput[],
): Promise<ApplyResult> {
  if (job.status !== "completed") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `job is ${job.status} — only completed jobs can be applied`,
    });
  }

  const alreadyApplied = new Set(
    (job.appliedActions ?? []).map((a) => a.index),
  );

  // All-or-nothing precheck: every entity must resolve inside the job's
  // workspace and pass permissions before anything mutates.
  const resolved: ResolvedAction[] = [];
  for (let i = 0; i < actions.length; i++) {
    if (alreadyApplied.has(i)) continue;
    resolved.push(await resolveAndCheck(db, userId, job, actions[i]!, i));
  }

  const applied: AppliedAction[] = [];
  for (const r of resolved) {
    const { entityPublicId } = await performAction(db, userId, job, r);
    applied.push({
      index: r.index,
      entityPublicId,
      at: new Date().toISOString(),
    });
  }
  if (applied.length) {
    await agentJobRepo.appendAppliedActions(db, job.id, applied);
    audit(db, {
      workspaceId: job.workspaceId!,
      eventType: "agent.applied",
      entityType: "agent_job",
      entityPublicId: job.id,
      actorUserId: userId,
      actorAgentId: job.agentIdentityId ?? null,
      payload: {
        worker: job.worker,
        actions: applied.map((a) => ({
          index: a.index,
          type: actions[a.index]?.type,
          entityPublicId: a.entityPublicId,
        })),
      },
    });
  }
  logger.info(
    {
      job: job.id,
      worker: job.worker,
      apply_count: applied.length,
      skipped: alreadyApplied.size,
    },
    "agent actions applied",
  );
  return { applied, skipped: [...alreadyApplied].sort((a, b) => a - b) };
}
