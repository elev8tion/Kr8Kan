/**
 * Maps a driver method + params onto gate action ids and a human summary.
 *
 * Adapted from dodis-browser `src/main/browser/action-classification.ts`
 * (MIT) — see NOTICE. The `eval` entry is gone with the command.
 */

export interface ClassifiedBrowserAction {
  actionIds: string[];
  summary: string;
}

const ENTER_KEY_RE = /^(enter|return|numpadenter)$/i;
const SUBMIT_SELECTOR_RE = /submit|button\[type=["']?submit/i;

const METHOD_ACTION_IDS: Record<string, string[]> = {
  goto: ["navigate"],
  back: ["navigate"],
  forward: ["navigate"],
  reload: ["navigate"],
  click: ["click"],
  type: ["type"],
  fill: ["fill"],
  press: ["keypress"],
  scroll: ["scroll"],
  hover: ["hover"],
  select: ["fill"],
  snapshot: ["read"],
  screenshot: ["screenshot"],
  console: ["read"],
  network: ["read"],
  tabCreate: ["tab"],
  tabClose: ["tab"],
  tabList: ["read"],
  tabSwitch: ["tab"],
};

function targetLabel(params: Record<string, unknown>): string {
  if (typeof params.ref === "string" && params.ref) return `ref ${params.ref}`;
  if (typeof params.selector === "string" && params.selector) {
    return params.selector;
  }
  return "element";
}

export function classifyBrowserAction(
  method: string,
  params: Record<string, unknown> = {},
): ClassifiedBrowserAction {
  const base = METHOD_ACTION_IDS[method] ?? ["unknown"];
  const actionIds = [...base];
  let summary = method;

  if (
    method === "press" &&
    typeof params.key === "string" &&
    ENTER_KEY_RE.test(params.key)
  ) {
    actionIds.push("form-submit");
    summary = `press Enter (${params.key})`;
  } else if (method === "goto" && typeof params.url === "string") {
    summary = `navigate to ${params.url}`;
  } else if (method === "click") {
    summary = `click ${targetLabel(params)}`;
  } else if (method === "type" || method === "fill" || method === "select") {
    // The value itself is deliberately absent — a summary can reach a human
    // review surface, and fill values are frequently credentials.
    summary = `${method} into ${targetLabel(params)}`;
  } else if (method === "hover") {
    summary = `hover ${targetLabel(params)}`;
  }

  // Clicking a submit-shaped target is a form submission in practice.
  if (
    method === "click" &&
    typeof params.selector === "string" &&
    SUBMIT_SELECTOR_RE.test(params.selector)
  ) {
    actionIds.push("form-submit");
  }

  return { actionIds, summary };
}
