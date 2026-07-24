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
    promptVersion: 3,
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
      "Execute the card as a coding task in an isolated sandbox of the board's linked project folder — pi runs with read/bash/edit/write tools; changes land as a reviewable patch a human applies.",
    needs: "card",
    promptFile: "dev-task.md",
    promptVersion: 3,
    allowTools: true,
  },
  {
    name: "diagnostician",
    title: "Diagnostician",
    description:
      "Investigate a failed job or workflow run and report a structured finding: what failed, probable cause, evidence, suggested fix. The sentinel loop's researcher.",
    needs: "either",
    promptFile: "diagnostician.md",
    promptVersion: 1,
  },
  {
    name: "judge",
    title: "Judge (eval)",
    description:
      "Score a completed job's output before it becomes gate-able: grounded, on-task, safe? Opt-in per workspace; a fail verdict blocks the gated apply.",
    needs: "none",
    promptFile: "judge.md",
    promptVersion: 1,
  },
  {
    name: "eval-reviewer",
    title: "Eval reviewer",
    description:
      "Review recent proposal rejections and judge failures, then propose new eval heuristics or persona prompt adjustments — as a gated proposal, never self-applying.",
    needs: "board",
    promptFile: "eval-reviewer.md",
    promptVersion: 1,
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
