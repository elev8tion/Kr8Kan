import type {
  BreakdownCardResult,
  DevTaskResult,
  DiagnosticianResult,
  DraftCardResult,
  StandupResult,
  SummarizeBoardResult,
  TriageCardResult,
} from "./schemas";

/**
 * The apply-action vocabulary shared by agent.apply (API) and the
 * WorkerRunner UI. Each action maps 1:1 onto an existing repo mutation
 * and is permission-checked server-side like its UI equivalent.
 */
export type ApplyAction =
  | {
      type: "createCard";
      listPublicId: string;
      title: string;
      description?: string;
      checklist?: string[];
    }
  | { type: "updateCard"; cardPublicId: string; title?: string; description?: string }
  | { type: "moveCard"; cardPublicId: string; listPublicId: string }
  | { type: "setLabels"; cardPublicId: string; labelPublicIds: string[] }
  | {
      type: "replaceChecklist";
      cardPublicId: string;
      name?: string;
      items: string[];
    }
  | {
      type: "appendChecklistItems";
      cardPublicId: string;
      name?: string;
      items: string[];
    }
  | { type: "completeChecklistItems"; cardPublicId: string; items: string[] }
  | { type: "addComment"; cardPublicId: string; body: string };

export interface ApplyPreset {
  /** CTA label, e.g. "Create card". */
  label: string;
  actions: ApplyAction[];
}

export interface ApplyPresetContext {
  boardPublicId?: string;
  cardPublicId?: string;
  /** Fallback target list when the worker did not suggest one (UI list
   * picker can override before submit). */
  defaultListPublicId?: string;
  /** Raw markdown result, used for post-as-comment presets. */
  resultRaw?: string;
}

function standupMarkdown(data: StandupResult): string {
  const section = (title: string, items: string[]) =>
    items.length ? `**${title}**\n${items.map((i) => `- ${i}`).join("\n")}` : null;
  return [
    section("Done", data.sections.done),
    section("Doing", data.sections.doing),
    section("Blocked", data.sections.blocked),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Turn a worker's parsed result into a ready-to-edit apply preset.
 * Returns null when there is nothing applicable (e.g. board-scoped
 * result with no card to comment on → copy-only in the UI).
 */
export function buildApplyActions(
  worker: string,
  parsedData: unknown,
  context: ApplyPresetContext,
): ApplyPreset | null {
  switch (worker) {
    case "draft-card": {
      const data = parsedData as DraftCardResult;
      const listPublicId =
        data.suggestedListPublicId ?? context.defaultListPublicId ?? "";
      return {
        label: "Create card",
        actions: [
          {
            type: "createCard",
            listPublicId,
            title: data.title,
            description: data.description || undefined,
            checklist: data.checklist.length ? data.checklist : undefined,
          },
        ],
      };
    }
    case "breakdown-card": {
      const data = parsedData as BreakdownCardResult;
      if (!context.cardPublicId) return null;
      return {
        label: "Add checklist to card",
        actions: [
          {
            type: "appendChecklistItems",
            cardPublicId: context.cardPublicId,
            name: data.checklistName || "Breakdown",
            items: data.items,
          },
        ],
      };
    }
    case "triage-card": {
      const data = parsedData as TriageCardResult;
      if (!context.cardPublicId) return null;
      return {
        label: "Move + set labels",
        actions: [
          {
            type: "moveCard",
            cardPublicId: context.cardPublicId,
            listPublicId: data.listPublicId,
          },
          {
            type: "setLabels",
            cardPublicId: context.cardPublicId,
            labelPublicIds: data.labelPublicIds,
          },
        ],
      };
    }
    case "standup": {
      const data = parsedData as StandupResult;
      if (!context.cardPublicId) return null;
      return {
        label: "Post as comment",
        actions: [
          {
            type: "addComment",
            cardPublicId: context.cardPublicId,
            body: standupMarkdown(data),
          },
        ],
      };
    }
    case "summarize-board": {
      const data = parsedData as SummarizeBoardResult;
      if (!context.cardPublicId) return null;
      const body = [
        data.summary,
        data.highlights.length
          ? data.highlights.map((h) => `- ${h}`).join("\n")
          : null,
      ]
        .filter(Boolean)
        .join("\n\n");
      return {
        label: "Post as comment",
        actions: [
          { type: "addComment", cardPublicId: context.cardPublicId, body },
        ],
      };
    }
    case "dev-task": {
      const data = parsedData as DevTaskResult;
      if (!context.cardPublicId) return null;
      const body = [
        `**What was done**\n${data.what}`,
        data.howToVerify ? `**How to verify**\n${data.howToVerify}` : null,
        data.notes ? `**Notes**\n${data.notes}` : null,
      ]
        .filter(Boolean)
        .join("\n\n");
      const actions: ApplyAction[] = [
        { type: "addComment", cardPublicId: context.cardPublicId, body },
      ];
      if (data.checklistItemsDone?.length) {
        actions.push({
          type: "completeChecklistItems",
          cardPublicId: context.cardPublicId,
          items: data.checklistItemsDone,
        });
      }
      return { label: "Post report as comment", actions };
    }
    case "diagnostician": {
      const data = parsedData as DiagnosticianResult;
      if (!context.cardPublicId) return null;
      const body = [
        `🚨 **System finding**`,
        `**What failed**\n${data.whatFailed}`,
        `**Probable cause**\n${data.probableCause}`,
        data.evidence.length
          ? `**Evidence**\n${data.evidence.map((e) => `- ${e}`).join("\n")}`
          : null,
        `**Suggested fix**\n${data.suggestedFix}`,
      ]
        .filter(Boolean)
        .join("\n\n");
      return {
        label: "Post finding as comment",
        actions: [
          { type: "addComment", cardPublicId: context.cardPublicId, body },
        ],
      };
    }
    case "custom": {
      if (!context.cardPublicId || !context.resultRaw) return null;
      return {
        label: "Post as comment",
        actions: [
          {
            type: "addComment",
            cardPublicId: context.cardPublicId,
            body: context.resultRaw,
          },
        ],
      };
    }
    default:
      return null;
  }
}
