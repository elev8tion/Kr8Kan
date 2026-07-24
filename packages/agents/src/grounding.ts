import type { ApplyAction } from "./apply-presets";
import type { WorkerContext } from "./types";

/**
 * Grounding check: every entity publicId a worker's output references must
 * have been present in the context the worker was given. An invented id is
 * a grounding failure — the eval layer's cheapest, fully deterministic
 * evaluator. No LLM involved.
 */

/** Collect every publicId that appeared in a worker's prompt context. */
export function collectContextIds(context: WorkerContext): string[] {
  const ids = new Set<string>();
  const card = context.card;
  if (card) {
    ids.add(card.publicId);
    if (card.listPublicId) ids.add(card.listPublicId);
    for (const s of card.siblings ?? []) ids.add(s.publicId);
  }
  const board = context.board;
  if (board) {
    ids.add(board.publicId);
    for (const label of board.labels ?? []) ids.add(label.publicId);
    for (const list of board.lists) {
      ids.add(list.publicId);
      for (const c of list.cards) {
        ids.add(c.publicId);
        if (c.listPublicId) ids.add(c.listPublicId);
      }
    }
  }
  return [...ids];
}

export interface GroundingFailure {
  /** Index of the offending action in the preset. */
  actionIndex: number;
  /** Which field carried the ungrounded id. */
  field: string;
  /** The id that was not in the worker's context. */
  id: string;
}

export interface GroundingResult {
  ok: boolean;
  failures: GroundingFailure[];
}

/**
 * Verify every publicId referenced by the actions against the ids that
 * were actually in the worker's context (plus any ids the applying human
 * supplied explicitly, e.g. a list picked in the UI — pass those via
 * `allowed`). Fail-closed spirit: unknown action shapes contribute no ids
 * and therefore cannot fail, but every known id-bearing field is checked.
 */
export function checkGrounding(
  actions: ApplyAction[],
  contextIds: Iterable<string>,
  allowed: Iterable<string> = [],
): GroundingResult {
  const known = new Set<string>();
  for (const id of contextIds) known.add(id);
  for (const id of allowed) if (id) known.add(id);

  const failures: GroundingFailure[] = [];
  const check = (actionIndex: number, field: string, id: string | undefined) => {
    if (id && !known.has(id)) failures.push({ actionIndex, field, id });
  };

  actions.forEach((action, i) => {
    if ("cardPublicId" in action) check(i, "cardPublicId", action.cardPublicId);
    if ("listPublicId" in action) check(i, "listPublicId", action.listPublicId);
    if (action.type === "setLabels") {
      for (const id of action.labelPublicIds) check(i, "labelPublicIds", id);
    }
  });

  return { ok: failures.length === 0, failures };
}

/** Human-readable reasons list for job records and proposal comments. */
export function groundingReasons(result: GroundingResult): string[] {
  return result.failures.map(
    (f) =>
      `action ${f.actionIndex} references ${f.field} \`${f.id}\` which was not in the worker's context`,
  );
}
