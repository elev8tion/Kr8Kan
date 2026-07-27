import { describe, expect, it, vi } from "vitest";

import { classifyBrowserAction } from "../safety/classify";
import { BrowserActionGate, type ConfirmRequest } from "../safety/gate";
import {
  checkBrowserAction,
  DEFAULT_SAFETY_CONFIG,
  normalizeBrowserSafetyConfig,
  type BrowserSafetyConfig,
} from "../safety/rules";
import { maskInputValue, maskPageText, maskUrl } from "../safety/mask";

const config: BrowserSafetyConfig = {
  enabled: true,
  urlRules: [
    { kind: "url", name: "masked", effect: "mask", pattern: "example.com" },
    { kind: "url", name: "blocked", effect: "block", pattern: "evil.test" },
    {
      kind: "url",
      name: "confirmed",
      effect: "confirm",
      pattern: "bank.example.com",
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

describe("checkBrowserAction", () => {
  it("returns allow when the gate is disabled", () => {
    expect(
      checkBrowserAction(
        { ...config, enabled: false },
        ["click"],
        "https://evil.test/",
      ),
    ).toEqual({ effect: "allow" });
  });

  it("lets a URL block trump an action rule", () => {
    const decision = checkBrowserAction(
      config,
      ["form-submit"],
      "https://evil.test/",
    );
    expect(decision.effect).toBe("block");
  });

  it("takes the most restrictive matching URL rule", () => {
    // bank.example.com matches both the example.com mask and the
    // bank.example.com confirm — confirm outranks mask.
    const decision = checkBrowserAction(
      config,
      ["click"],
      "https://bank.example.com/",
    );
    expect(decision.effect).toBe("confirm");
  });

  it("keeps the action decision when it is more restrictive", () => {
    const decision = checkBrowserAction(
      config,
      ["form-submit"],
      "https://example.com/",
    );
    expect(decision.effect).toBe("confirm");
  });

  it("falls back to the URL decision when the action is permissive", () => {
    const decision = checkBrowserAction(
      config,
      ["click"],
      "https://example.com/",
    );
    expect(decision.effect).toBe("mask");
  });

  it("ignores an unparseable regex rule instead of throwing", () => {
    const broken: BrowserSafetyConfig = {
      enabled: true,
      urlRules: [
        { kind: "url", name: "broken", effect: "block", pattern: "regex:([" },
      ],
      actionRules: [],
    };
    expect(checkBrowserAction(broken, ["click"], "https://x.test/")).toEqual({
      effect: "allow",
    });
  });

  it("confirms .gov by default", () => {
    const decision = checkBrowserAction(
      DEFAULT_SAFETY_CONFIG,
      ["click"],
      "https://irs.gov/pay",
    );
    expect(decision.effect).toBe("confirm");
  });
});

describe("normalizeBrowserSafetyConfig", () => {
  it("falls back to defaults for junk input", () => {
    expect(normalizeBrowserSafetyConfig("nope").urlRules).toEqual(
      DEFAULT_SAFETY_CONFIG.urlRules,
    );
  });

  it("treats a missing enabled flag as enabled", () => {
    expect(normalizeBrowserSafetyConfig({}).enabled).toBe(true);
  });
});

describe("classifyBrowserAction", () => {
  it("treats Enter as a form submission", () => {
    const { actionIds } = classifyBrowserAction("press", { key: "Enter" });
    expect(actionIds).toContain("form-submit");
  });

  it("treats a submit-shaped selector as a form submission", () => {
    const { actionIds } = classifyBrowserAction("click", {
      selector: "button[type=submit]",
    });
    expect(actionIds).toContain("form-submit");
  });

  it("never puts a typed value in the summary", () => {
    const { summary } = classifyBrowserAction("fill", {
      selector: "#password",
      text: "hunter2",
    });
    expect(summary).not.toContain("hunter2");
    expect(summary).toBe("fill into #password");
  });

  it("labels a ref target", () => {
    expect(classifyBrowserAction("click", { ref: "e7" }).summary).toBe(
      "click ref e7",
    );
  });

  it("falls back to unknown for an unmapped method", () => {
    expect(classifyBrowserAction("teleport").actionIds).toEqual(["unknown"]);
  });
});

describe("BrowserActionGate", () => {
  it("allows an unmatched action", async () => {
    const gate = new BrowserActionGate({
      isEnabled: () => true,
      getConfig: () => config,
      currentUrl: () => "https://safe.test/",
      requestConfirm: async () => true,
    });
    expect(await gate.evaluate("click", { selector: "#a" })).toEqual({
      kind: "allow",
    });
  });

  it("blocks and never asks for confirmation", async () => {
    const requestConfirm = vi.fn(async () => true);
    const gate = new BrowserActionGate({
      isEnabled: () => true,
      getConfig: () => config,
      currentUrl: () => "https://evil.test/",
      requestConfirm,
    });
    const outcome = await gate.evaluate("click", { selector: "#a" });
    expect(outcome.kind).toBe("block");
    expect(requestConfirm).not.toHaveBeenCalled();
  });

  it("allows a confirmed action once approved", async () => {
    const gate = new BrowserActionGate({
      isEnabled: () => true,
      getConfig: () => config,
      currentUrl: () => "https://example.com/",
      requestConfirm: async () => true,
      newRequestId: () => "req-1",
    });
    expect(await gate.evaluate("press", { key: "Enter" })).toEqual({
      kind: "allow",
    });
  });

  it("blocks a denied confirmation", async () => {
    const gate = new BrowserActionGate({
      isEnabled: () => true,
      getConfig: () => config,
      currentUrl: () => "https://example.com/",
      requestConfirm: async () => false,
      newRequestId: () => "req-1",
    });
    const outcome = await gate.evaluate("press", { key: "Enter" });
    expect(outcome.kind).toBe("block");
  });

  it("treats a throwing confirm channel as a denial", async () => {
    const gate = new BrowserActionGate({
      isEnabled: () => true,
      getConfig: () => config,
      currentUrl: () => "https://example.com/",
      requestConfirm: async () => {
        throw new Error("channel down");
      },
    });
    const outcome = await gate.evaluate("press", { key: "Enter" });
    expect(outcome.kind).toBe("block");
  });

  it("stays on when its own switch throws", async () => {
    const gate = new BrowserActionGate({
      isEnabled: () => {
        throw new Error("no store");
      },
      getConfig: () => config,
      currentUrl: () => "https://evil.test/",
      requestConfirm: async () => true,
    });
    expect((await gate.evaluate("click", {})).kind).toBe("block");
  });

  it("falls back to default rules when the config throws", async () => {
    const gate = new BrowserActionGate({
      isEnabled: () => true,
      getConfig: () => {
        throw new Error("corrupt");
      },
      currentUrl: () => "https://chase.com/",
      requestConfirm: async () => false,
    });
    expect((await gate.evaluate("click", {})).kind).toBe("block");
  });

  it("gates the destination URL, not the current page", async () => {
    const gate = new BrowserActionGate({
      isEnabled: () => true,
      getConfig: () => config,
      currentUrl: () => "https://safe.test/",
      requestConfirm: async () => false,
    });
    const outcome = await gate.evaluate("goto", { url: "https://evil.test/x" });
    expect(outcome.kind).toBe("block");
  });

  it("passes a readable request to the confirm channel", async () => {
    let seen: ConfirmRequest | null = null;
    const gate = new BrowserActionGate({
      isEnabled: () => true,
      getConfig: () => config,
      currentUrl: () => "https://example.com/",
      requestConfirm: async (req) => {
        seen = req;
        return true;
      },
      newRequestId: () => "req-42",
    });
    await gate.evaluate("press", { key: "Enter" });
    expect(seen).toMatchObject({
      requestId: "req-42",
      ruleName: "Form submission",
    });
  });
});

describe("mask", () => {
  it("redacts an email", () => {
    expect(maskPageText("write to ada@example.com now")).toContain(
      "[redacted-email]",
    );
  });

  it("redacts a card-shaped number", () => {
    expect(maskPageText("4111 1111 1111 1111")).toBe("[redacted-card]");
  });

  it("redacts a JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF123_-x";
    expect(maskPageText(jwt)).toBe("[redacted-jwt]");
  });

  it("keeps ordinary prose intact", () => {
    expect(maskPageText("Board loaded with 3 lists")).toBe(
      "Board loaded with 3 lists",
    );
  });

  it("masks sensitive query values but keeps the path", () => {
    const masked = maskUrl("https://x.test/cb?code=abc123&page=2");
    expect(masked).toContain("code=%5Bredacted%5D");
    expect(masked).toContain("page=2");
  });

  it("strips URL credentials", () => {
    expect(maskUrl("https://user:pw@x.test/")).toBe("https://x.test/");
  });

  it("never echoes a typed value", () => {
    expect(maskInputValue("hunter2")).toBe("[7 chars]");
  });
});
