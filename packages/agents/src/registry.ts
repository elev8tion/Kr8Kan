/**
 * Worker catalog. Each worker is a system prompt + expectations about
 * which context (board/card) it needs. Execution happens through the
 * operator's own Pi install (~/.pi) — no AI SaaS vendor involved.
 */

export interface WorkerDefinition {
  name: string;
  title: string;
  description: string;
  needs: "board" | "card" | "either" | "none";
  promptFile: string;
  /** Tool-enabled worker: runs pi WITH tools inside the board's linked
   * project folder. Requires KR8KAN_PI_ALLOW_TOOLS=true and an allowlisted
   * folder (KR8KAN_PI_PROJECT_ROOTS). */
  allowTools?: boolean;
}

export const WORKERS: WorkerDefinition[] = [
  {
    name: "summarize-board",
    title: "Summarize board",
    description:
      "Read the board's lists and cards and produce a concise markdown status summary.",
    needs: "board",
    promptFile: "summarize-board.md",
  },
  {
    name: "draft-card",
    title: "Draft card",
    description:
      "Turn a natural-language request into a card draft: title, description, checklist.",
    needs: "either",
    promptFile: "draft-card.md",
  },
  {
    name: "triage-card",
    title: "Triage card",
    description:
      "Suggest which list a card belongs in and which labels apply, with reasoning.",
    needs: "card",
    promptFile: "triage-card.md",
  },
  {
    name: "breakdown-card",
    title: "Break down card",
    description: "Split a card into concrete checklist items.",
    needs: "card",
    promptFile: "breakdown-card.md",
  },
  {
    name: "standup",
    title: "Standup blurb",
    description:
      "Write a short standup update from recent board activity: done, doing, blocked.",
    needs: "board",
    promptFile: "standup.md",
  },
  {
    name: "dev-task",
    title: "Dev agent (project folder)",
    description:
      "Execute the card as a coding task inside the board's linked project folder — pi runs with read/bash/edit/write tools and reports what it changed.",
    needs: "card",
    promptFile: "dev-task.md",
    allowTools: true,
  },
  {
    name: "custom",
    title: "Custom prompt",
    description:
      "Freeform prompt with board/card context attached. You steer, Pi answers.",
    needs: "either",
    promptFile: "custom.md",
  },
];

export function getWorker(name: string): WorkerDefinition | undefined {
  return WORKERS.find((w) => w.name === name);
}
