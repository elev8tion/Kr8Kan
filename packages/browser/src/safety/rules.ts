/**
 * Browser safety rule engine.
 *
 * URL rules: domain-suffix match by default, `regex:` for a full-URL regex.
 * Action rules: match gate action ids (navigate, click, form-submit, …).
 * Most-restrictive URL rule wins; first matching action rule wins;
 * a URL `block` trumps everything.
 *
 * Adapted from dodis-browser `src/shared/browser-safety.ts` (MIT) — see NOTICE.
 * Differences: the `eval` action rule is gone because the command no longer
 * exists, and `mask` is a real effect here (see ./mask.ts).
 */

export type SafetyEffect = "allow" | "mask" | "confirm" | "block";

export interface UrlSafetyRule {
  kind: "url";
  name: string;
  effect: SafetyEffect;
  /** Domain ("chase.com") or "regex:<body>" tested against the full URL. */
  pattern: string;
}

export interface ActionSafetyRule {
  kind: "action";
  name: string;
  effect: SafetyEffect;
  /** Gate action ids (e.g. "form-submit", "navigate"). */
  actions: string[];
}

export interface BrowserSafetyConfig {
  enabled: boolean;
  urlRules: UrlSafetyRule[];
  actionRules: ActionSafetyRule[];
}

export type SafetyDecision =
  | { effect: "allow" }
  | { effect: "mask"; ruleName: string }
  | { effect: "confirm"; ruleName: string; reason: string }
  | { effect: "block"; ruleName: string; reason: string };

const EFFECT_RANK: Record<SafetyEffect, number> = {
  allow: 0,
  mask: 1,
  confirm: 2,
  block: 3,
};

type CompiledUrlMatcher =
  { type: "domain"; value: string } | { type: "regex"; source: RegExp };

export function compileUrlMatcher(pattern: string): CompiledUrlMatcher | null {
  const trimmed = pattern.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("regex:")) {
    try {
      return {
        type: "regex",
        source: new RegExp(trimmed.slice("regex:".length), "i"),
      };
    } catch {
      // An invalid operator-supplied regex must never break the gate —
      // the rule stays inert rather than throwing mid-evaluation.
      return null;
    }
  }
  const domain = trimmed
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/^\*+\.?/, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase();
  return domain ? { type: "domain", value: domain } : null;
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function urlMatches(matcher: CompiledUrlMatcher, url: string): boolean {
  if (matcher.type === "regex") return matcher.source.test(url);
  const hostname = safeHostname(url);
  return hostname === matcher.value || hostname.endsWith(`.${matcher.value}`);
}

function toDecision(
  effect: SafetyEffect,
  ruleName: string,
  reason: string,
): SafetyDecision {
  switch (effect) {
    case "allow":
      return { effect: "allow" };
    case "mask":
      return { effect: "mask", ruleName };
    case "confirm":
      return { effect: "confirm", ruleName, reason };
    case "block":
      return { effect: "block", ruleName, reason };
  }
}

/** Most-restrictive matching URL rule (block > confirm > mask > allow). */
export function checkUrlRules(
  config: BrowserSafetyConfig,
  url: string,
): SafetyDecision {
  let winner: UrlSafetyRule | null = null;
  for (const rule of config.urlRules) {
    const matcher = compileUrlMatcher(rule.pattern);
    if (!matcher || !urlMatches(matcher, url)) continue;
    if (!winner || EFFECT_RANK[rule.effect] > EFFECT_RANK[winner.effect]) {
      winner = rule;
    }
  }
  if (!winner) return { effect: "allow" };
  return toDecision(
    winner.effect,
    winner.name,
    `URL matches safety rule "${winner.name}" (${winner.pattern})`,
  );
}

/** First matching action rule wins. */
export function checkActionRules(
  config: BrowserSafetyConfig,
  actionIds: string[],
): SafetyDecision {
  const idSet = new Set(actionIds);
  for (const rule of config.actionRules) {
    if (rule.actions.some((a) => idSet.has(a))) {
      return toDecision(
        rule.effect,
        rule.name,
        `Action matches safety rule "${rule.name}"`,
      );
    }
  }
  return { effect: "allow" };
}

/**
 * Combined gate: a URL block wins over everything; otherwise take the more
 * restrictive of the URL and action decisions.
 */
export function checkBrowserAction(
  config: BrowserSafetyConfig,
  actionIds: string[],
  url: string,
): SafetyDecision {
  if (!config.enabled) return { effect: "allow" };

  const urlDecision = checkUrlRules(config, url);
  if (urlDecision.effect === "block") return urlDecision;

  const actionDecision = checkActionRules(config, actionIds);
  if (EFFECT_RANK[actionDecision.effect] >= EFFECT_RANK[urlDecision.effect]) {
    return actionDecision;
  }
  return urlDecision;
}

/**
 * Conservative defaults — high-stakes domains confirm, form submit confirms.
 * These only bite for hosts the operator has already allowlisted; the host
 * allowlist in ../config.ts is the outer boundary.
 */
export const DEFAULT_SAFETY_CONFIG: BrowserSafetyConfig = {
  enabled: true,
  urlRules: [
    {
      kind: "url",
      name: "Banking (chase)",
      effect: "confirm",
      pattern: "chase.com",
    },
    {
      kind: "url",
      name: "Banking (wells fargo)",
      effect: "confirm",
      pattern: "wellsfargo.com",
    },
    {
      kind: "url",
      name: "Banking (bank of america)",
      effect: "confirm",
      pattern: "bankofamerica.com",
    },
    {
      kind: "url",
      name: "Banking (citibank)",
      effect: "confirm",
      pattern: "citi.com",
    },
    {
      kind: "url",
      name: "Payments (paypal)",
      effect: "confirm",
      pattern: "paypal.com",
    },
    {
      kind: "url",
      name: "Payments (stripe)",
      effect: "confirm",
      pattern: "stripe.com",
    },
    {
      kind: "url",
      name: "Email (gmail)",
      effect: "confirm",
      pattern: "mail.google.com",
    },
    {
      kind: "url",
      name: "Email (outlook)",
      effect: "confirm",
      pattern: "outlook.live.com",
    },
    {
      kind: "url",
      name: "Government (.gov)",
      effect: "confirm",
      pattern: "regex:\\.gov(\\.|$|/)",
    },
  ],
  actionRules: [
    {
      kind: "action",
      name: "Form submission",
      effect: "confirm",
      actions: ["form-submit"],
    },
  ],
};

export function normalizeBrowserSafetyConfig(
  raw: unknown,
): BrowserSafetyConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SAFETY_CONFIG };
  const obj = raw as Partial<BrowserSafetyConfig>;
  return {
    enabled: obj.enabled !== false,
    urlRules: Array.isArray(obj.urlRules)
      ? obj.urlRules
      : DEFAULT_SAFETY_CONFIG.urlRules,
    actionRules: Array.isArray(obj.actionRules)
      ? obj.actionRules
      : DEFAULT_SAFETY_CONFIG.actionRules,
  };
}
