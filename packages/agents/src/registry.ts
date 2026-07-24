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
  /** Bumped whenever the prompt or its output schema changes shape —
   * stamped on every job so old results keep parsing under the contract
   * they were produced with. */
  promptVersion: number;
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
    promptVersion: 2,
  },
  {
    name: "draft-card",
    title: "Draft card",
    description:
      "Turn a natural-language request into a card draft: title, description, checklist.",
    needs: "either",
    promptFile: "draft-card.md",
    promptVersion: 2,
  },
  {
    name: "triage-card",
    title: "Triage card",
    description:
      "Suggest which list a card belongs in and which labels apply, with reasoning.",
    needs: "card",
    promptFile: "triage-card.md",
    promptVersion: 2,
  },
  {
    name: "breakdown-card",
    title: "Break down card",
    description: "Split a card into concrete checklist items.",
    needs: "card",
    promptFile: "breakdown-card.md",
    promptVersion: 2,
  },
  {
    name: "standup",
    title: "Standup blurb",
    description:
      "Write a short standup update from recent board activity: done, doing, blocked.",
    needs: "board",
    promptFile: "standup.md",
    promptVersion: 2,
  },
  {
    name: "dev-task",
    title: "Dev agent (project folder)",
    description:
      "Execute the card as a coding task inside the board's linked project folder — pi runs with read/bash/edit/write tools and reports what it changed.",
    needs: "card",
    promptFile: "dev-task.md",
    promptVersion: 2,
    allowTools: true,
  },
  {
    name: "custom",
    title: "Custom prompt",
    description:
      "Freeform prompt with board/card context attached. You steer, Pi answers.",
    needs: "either",
    promptFile: "custom.md",
    promptVersion: 2,
  },
];

export function getWorker(name: string): WorkerDefinition | undefined {
  return WORKERS.find((w) => w.name === name);
}
