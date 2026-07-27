/**
 * Action gate — evaluates one driver call against the safety rules and
 * returns what the driver should do about it.
 *
 * Every dependency is injected, so the confirm channel can be an in-process
 * callback in tests and a job-parking tRPC round-trip in the API layer.
 *
 * Adapted from dodis-browser `src/main/browser/action-gate.ts` (MIT) —
 * see NOTICE. Kept: fail-closed behaviour on every lookup. Changed:
 * request ids come from an injected id source so runs stay deterministic
 * under test.
 */

import { classifyBrowserAction } from "./classify";
import {
  checkBrowserAction,
  normalizeBrowserSafetyConfig,
  type BrowserSafetyConfig,
  type SafetyDecision,
} from "./rules";

export interface ConfirmRequest {
  requestId: string;
  summary: string;
  url: string;
  ruleName: string;
  reason: string;
}

export type GateOutcome =
  | { kind: "allow" }
  | { kind: "mask"; ruleName: string }
  | { kind: "block"; message: string }
  | { kind: "confirm-needed"; request: ConfirmRequest };

export interface ActionGateDeps {
  isEnabled(): boolean;
  getConfig(): unknown;
  currentUrl(params: Record<string, unknown>): string | Promise<string>;
  /** Resolves true when a human approved the action. */
  requestConfirm(request: ConfirmRequest): Promise<boolean>;
  /** Injected so tests get stable ids. */
  newRequestId?(): string;
}

let confirmCounter = 0;

function defaultRequestId(): string {
  confirmCounter += 1;
  return `confirm-${Date.now().toString(36)}-${confirmCounter}`;
}

export class BrowserActionGate {
  constructor(private readonly deps: ActionGateDeps) {}

  async evaluate(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<GateOutcome> {
    if (!this.safeIsEnabled()) return { kind: "allow" };

    const config = this.resolveConfig();
    const { actionIds, summary } = classifyBrowserAction(method, params);
    const url = await this.safeUrl(params);
    const decision = checkBrowserAction(config, actionIds, url);
    return this.applyDecision(decision, summary, url);
  }

  private async applyDecision(
    decision: SafetyDecision,
    summary: string,
    url: string,
  ): Promise<GateOutcome> {
    switch (decision.effect) {
      case "allow":
        return { kind: "allow" };
      case "mask":
        return { kind: "mask", ruleName: decision.ruleName };
      case "block":
        return {
          kind: "block",
          message: `blocked by safety rule "${decision.ruleName}": ${decision.reason} — action not performed`,
        };
      case "confirm": {
        const request: ConfirmRequest = {
          requestId: (this.deps.newRequestId ?? defaultRequestId)(),
          summary,
          url,
          ruleName: decision.ruleName,
          reason: decision.reason,
        };
        const approved = await this.safeConfirm(request);
        if (!approved) {
          return {
            kind: "block",
            message: `action gated by "${decision.ruleName}" was not approved`,
          };
        }
        return { kind: "allow" };
      }
    }
  }

  /** A gate that cannot read its own switch stays on. */
  private safeIsEnabled(): boolean {
    try {
      return this.deps.isEnabled();
    } catch {
      return true;
    }
  }

  private resolveConfig(): BrowserSafetyConfig {
    try {
      return normalizeBrowserSafetyConfig(this.deps.getConfig());
    } catch {
      return normalizeBrowserSafetyConfig(null);
    }
  }

  /** A confirm channel that throws denies — never silently approves. */
  private async safeConfirm(request: ConfirmRequest): Promise<boolean> {
    try {
      return await this.deps.requestConfirm(request);
    } catch {
      return false;
    }
  }

  private async safeUrl(params: Record<string, unknown>): Promise<string> {
    try {
      if (typeof params.url === "string" && params.url) return params.url;
      return await this.deps.currentUrl(params);
    } catch {
      return "";
    }
  }
}
