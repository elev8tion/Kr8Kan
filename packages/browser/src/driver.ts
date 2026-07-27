/**
 * The agent-facing driver.
 *
 * Shape borrowed from dodis-browser's agent bridge — a command union, one
 * dispatcher, a `{ok, data, error, safety}` envelope — with the Electron
 * mechanics replaced by CDP and the gaps closed:
 *
 *  - `eval` does not exist here
 *  - selectors are never interpolated into evaluated source; they cross as
 *    bound arguments to Runtime.callFunctionOn
 *  - navigation awaits the load event instead of returning immediately
 *  - every command has a timeout
 *  - input goes through Input.dispatch*, so pages see real events rather
 *    than synthetic ones a framework can tell apart
 */

import { PageCapture } from "./capture";
import { CdpConnection } from "./cdp/connection";
import { launchChrome, type LaunchedBrowser } from "./cdp/launcher";
import {
  allowedHosts,
  assertBrowserEnabled,
  commandTimeoutMs,
  maxPages,
} from "./config";
import { assertNavigable, NavigationDeniedError } from "./safety/url";
import { maskInputValue, maskPageText, maskUrl } from "./safety/mask";
import { BrowserActionGate, type GateOutcome } from "./safety/gate";
import { captureSnapshot } from "./snapshot";
import { getViewportPreset } from "./presets";
import type {
  AgentBrowserCommand,
  AgentBrowserResult,
  BrowserTab,
  BrowserTabId,
} from "./types";

/** Elements are addressed by ref or selector; one of them must be present. */
interface ResolvedElement {
  objectId: string;
  release(): Promise<void>;
}

const QUERY_FN = "function(selector) { return this.querySelector(selector); }";
const RECT_FN = `function() {
  this.scrollIntoView({ block: 'center', inline: 'center' });
  const r = this.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}`;
const FILL_FN = `function(value) {
  const proto = this instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) { setter.call(this, value); } else { this.value = value; }
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}`;
const SELECT_FN = `function(value) {
  this.value = value;
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return this.value === value;
}`;

interface CdpEvalReply {
  result?: { objectId?: string; value?: unknown };
  exceptionDetails?: {
    text?: string;
    exception?: { description?: string; value?: unknown };
  };
}

function throwOnException(reply: CdpEvalReply): void {
  const details = reply.exceptionDetails;
  if (!details) return;
  const description =
    details.exception?.description ??
    (details.exception?.value !== undefined
      ? String(details.exception.value)
      : undefined) ??
    details.text ??
    "evaluation threw";
  throw new Error(description.split("\n")[0] ?? description);
}

/**
 * Read the real pixel dimensions out of the PNG header.
 *
 * Layout metrics describe CSS pixels; with a device-scale override the
 * encoded image is larger. Reporting the metrics as the image size makes a
 * screenshot artifact lie about itself, so the bytes are the source of truth.
 */
function pngDimensions(
  base64: string,
): { width: number; height: number } | null {
  if (base64.length < 48) return null;
  const header = Buffer.from(base64.slice(0, 48), "base64");
  if (header.length < 24) return null;
  if (header.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

/** Ceiling on an emulated full-page viewport, so one very long page
 * cannot ask Chrome for a gigapixel image. */
const MAX_CAPTURE_HEIGHT = 20_000;

interface KeySpec {
  key: string;
  code: string;
  keyCode: number;
  text?: string;
}

const KEYS: Record<string, KeySpec> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", keyCode: 9, text: "\t" },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
};

export class BrowserPage {
  private currentUrl = "about:blank";
  private currentTitle = "";
  private refs = new Map<string, number>();
  readonly capture: PageCapture;

  constructor(
    readonly targetId: string,
    readonly sessionId: string,
    private readonly connection: CdpConnection,
    private readonly timeoutMs: number,
  ) {
    this.capture = new PageCapture(connection, sessionId);
    connection.on("Page.frameNavigated", (event) => {
      if (event.sessionId !== sessionId) return;
      const frame = event.params.frame as
        { url?: string; parentId?: string } | undefined;
      // Only the main frame defines "where the page is".
      if (frame?.url && !frame.parentId) {
        this.currentUrl = frame.url;
        this.refs.clear();
      }
    });
  }

  get url(): string {
    return this.currentUrl;
  }

  get title(): string {
    return this.currentTitle;
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    return this.connection.send<T>(
      method,
      params,
      this.sessionId,
      this.timeoutMs,
    );
  }

  async init(): Promise<void> {
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Log.enable");
    await this.send("Network.enable");
    await this.send("DOM.enable");
    await this.send("Accessibility.enable");
    // Nothing on a verification page legitimately needs the camera, the
    // clipboard or notifications. Upstream granted these to every origin.
    await this.send("Browser.setPermission", {
      permission: { name: "notifications" },
      setting: "denied",
    }).catch(() => undefined);
  }

  async navigate(
    url: string,
    waitUntil: "load" | "domcontentloaded" = "load",
  ): Promise<void> {
    const target = await assertNavigable(url, { allowedHosts: allowedHosts() });
    const event =
      waitUntil === "load"
        ? "Page.loadEventFired"
        : "Page.domContentEventFired";
    const settled = this.connection.once(event, {
      sessionId: this.sessionId,
      timeoutMs: this.timeoutMs,
    });
    const result = await this.send<{ errorText?: string }>("Page.navigate", {
      url: target,
    });
    if (result.errorText) {
      throw new Error(`navigation failed: ${result.errorText}`);
    }
    await settled;
    this.currentUrl = target;
    this.refs.clear();
    await this.refreshTitle();
  }

  private async refreshTitle(): Promise<void> {
    try {
      const res = await this.evaluate<string>("document.title", true);
      this.currentTitle = String(res.value ?? "");
    } catch {
      this.currentTitle = "";
    }
  }

  /**
   * Runtime.evaluate that treats a thrown exception as a failure.
   *
   * CDP reports an in-page throw as a normal reply carrying
   * `exceptionDetails` plus a `result` holding the *exception object*.
   * Miss that and the caller happily uses an Error as if it were the DOM
   * node it asked for — which is exactly how a malformed selector slipped
   * through in testing.
   */
  private async evaluate<T = unknown>(
    expression: string,
    returnByValue = false,
  ): Promise<{ objectId?: string; value?: T }> {
    const res = await this.send<CdpEvalReply>("Runtime.evaluate", {
      expression,
      returnByValue,
    });
    throwOnException(res);
    return (res.result ?? {}) as { objectId?: string; value?: T };
  }

  private async callOn<T = unknown>(
    objectId: string,
    functionDeclaration: string,
    args: unknown[] = [],
    returnByValue = false,
  ): Promise<{ objectId?: string; value?: T }> {
    const res = await this.send<CdpEvalReply>("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration,
      arguments: args.map((value) => ({ value })),
      returnByValue,
    });
    throwOnException(res);
    return (res.result ?? {}) as { objectId?: string; value?: T };
  }

  async history(delta: number): Promise<void> {
    const history = await this.send<{
      currentIndex?: number;
      entries?: Array<{ id?: number; url?: string }>;
    }>("Page.getNavigationHistory");
    const entries = history.entries ?? [];
    const index = (history.currentIndex ?? 0) + delta;
    const entry = entries[index];
    if (!entry || typeof entry.id !== "number") {
      throw new Error(
        delta < 0 ? "no page to go back to" : "no page to go forward to",
      );
    }
    // A page can push history entries the gate never saw, so the
    // destination is re-checked rather than trusted for having been visited.
    await assertNavigable(entry.url ?? "", { allowedHosts: allowedHosts() });
    const settled = this.connection.once("Page.loadEventFired", {
      sessionId: this.sessionId,
      timeoutMs: this.timeoutMs,
    });
    await this.send("Page.navigateToHistoryEntry", { entryId: entry.id });
    await settled;
    await this.refreshTitle();
  }

  async reload(): Promise<void> {
    const settled = this.connection.once("Page.loadEventFired", {
      sessionId: this.sessionId,
      timeoutMs: this.timeoutMs,
    });
    await this.send("Page.reload");
    await settled;
    await this.refreshTitle();
  }

  async snapshot(maxNodes: number | undefined, mask: boolean) {
    await this.refreshTitle();
    const result = await captureSnapshot(
      (method, params) => this.send(method, params),
      {
        url: mask ? maskUrl(this.currentUrl) : this.currentUrl,
        title: this.currentTitle,
        maxNodes,
        mask,
      },
    );
    this.refs = result.refs;
    return result.snapshot;
  }

  async screenshot(fullPage: boolean, preset?: string) {
    const viewport = getViewportPreset(preset);
    if (viewport) {
      await this.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor,
        mobile: viewport.mobile,
      });
    }
    let metrics = await this.layoutMetrics();

    // captureBeyondViewport re-derives the capture area from the content
    // box and, in doing so, discards the device-metrics override — a
    // "mobile" full-page shot comes back rendered at desktop width, which
    // is worse than useless for checking a breakpoint. So with a preset we
    // grow the emulated viewport to the content height instead and take an
    // ordinary viewport capture.
    const growViewport = Boolean(viewport) && fullPage;
    if (growViewport && viewport) {
      const contentHeight = Math.min(
        Math.ceil(metrics.contentHeight || viewport.height),
        MAX_CAPTURE_HEIGHT,
      );
      await this.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: contentHeight,
        deviceScaleFactor: viewport.deviceScaleFactor,
        mobile: viewport.mobile,
      });
      metrics = await this.layoutMetrics();
    }

    const width = fullPage ? metrics.contentWidth : metrics.viewportWidth;
    const height = fullPage ? metrics.contentHeight : metrics.viewportHeight;

    const shot = await this.send<{ data?: string }>("Page.captureScreenshot", {
      format: "png",
      // Electron's capturePage cannot do this; CDP can, so full-page
      // screenshots need no scroll-and-stitch pass.
      captureBeyondViewport: fullPage && !growViewport,
    });
    if (viewport) {
      await this.send("Emulation.clearDeviceMetricsOverride").catch(
        () => undefined,
      );
    }
    const data = String(shot.data ?? "");
    const actual = pngDimensions(data);
    return {
      data,
      width: actual?.width ?? Math.round(width),
      height: actual?.height ?? Math.round(height),
      fullPage,
    };
  }

  private async layoutMetrics(): Promise<{
    contentWidth: number;
    contentHeight: number;
    viewportWidth: number;
    viewportHeight: number;
  }> {
    const metrics = await this.send<{
      cssContentSize?: { width?: number; height?: number };
      cssLayoutViewport?: { clientWidth?: number; clientHeight?: number };
    }>("Page.getLayoutMetrics");
    return {
      contentWidth: metrics.cssContentSize?.width ?? 0,
      contentHeight: metrics.cssContentSize?.height ?? 0,
      viewportWidth: metrics.cssLayoutViewport?.clientWidth ?? 0,
      viewportHeight: metrics.cssLayoutViewport?.clientHeight ?? 0,
    };
  }

  /** Resolve a ref or selector to a live remote object. */
  private async resolve(target: {
    ref?: string;
    selector?: string;
  }): Promise<ResolvedElement> {
    if (target.ref) {
      const backendNodeId = this.refs.get(target.ref);
      if (backendNodeId === undefined) {
        throw new Error(
          `unknown ref ${target.ref} — take a snapshot before acting`,
        );
      }
      const resolved = await this.send<{ object?: { objectId?: string } }>(
        "DOM.resolveNode",
        { backendNodeId },
      );
      const objectId = resolved.object?.objectId;
      if (!objectId) throw new Error(`ref ${target.ref} is no longer attached`);
      return { objectId, release: () => this.release(objectId) };
    }

    if (!target.selector) {
      throw new Error("an element needs a ref or a selector");
    }

    const doc = await this.evaluate("document");
    const docId = doc.objectId;
    if (!docId) throw new Error("could not reach the document");
    try {
      // The selector crosses as an argument, never as part of the source
      // text — an invalid one throws inside querySelector and surfaces as
      // an error, rather than becoming code.
      const found = await this.callOn(docId, QUERY_FN, [target.selector]);
      const objectId = found.objectId;
      if (!objectId) {
        throw new Error(`no element matched ${target.selector}`);
      }
      return { objectId, release: () => this.release(objectId) };
    } finally {
      await this.release(docId);
    }
  }

  private async release(objectId: string): Promise<void> {
    await this.send("Runtime.releaseObject", { objectId }).catch(
      () => undefined,
    );
  }

  private async centerOf(objectId: string): Promise<{ x: number; y: number }> {
    const res = await this.callOn<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>(objectId, RECT_FN, [], true);
    const rect = res.value;
    if (!rect || rect.width === 0 || rect.height === 0) {
      throw new Error("element is not visible");
    }
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }

  async click(target: { ref?: string; selector?: string }): Promise<void> {
    const el = await this.resolve(target);
    try {
      const { x, y } = await this.centerOf(el.objectId);
      const base = { x, y, button: "left", clickCount: 1 };
      await this.send("Input.dispatchMouseEvent", {
        ...base,
        type: "mouseMoved",
      });
      await this.send("Input.dispatchMouseEvent", {
        ...base,
        type: "mousePressed",
      });
      await this.send("Input.dispatchMouseEvent", {
        ...base,
        type: "mouseReleased",
      });
    } finally {
      await el.release();
    }
  }

  async hover(target: { ref?: string; selector?: string }): Promise<void> {
    const el = await this.resolve(target);
    try {
      const { x, y } = await this.centerOf(el.objectId);
      await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    } finally {
      await el.release();
    }
  }

  async type(
    target: { ref?: string; selector?: string },
    text: string,
  ): Promise<void> {
    const el = await this.resolve(target);
    try {
      await this.send("DOM.focus", { objectId: el.objectId });
      await this.send("Input.insertText", { text });
    } finally {
      await el.release();
    }
  }

  async fill(
    target: { ref?: string; selector?: string },
    text: string,
  ): Promise<void> {
    const el = await this.resolve(target);
    try {
      await this.callOn(el.objectId, FILL_FN, [text], true);
    } finally {
      await el.release();
    }
  }

  async select(
    target: { ref?: string; selector?: string },
    value: string,
  ): Promise<boolean> {
    const el = await this.resolve(target);
    try {
      const res = await this.callOn<boolean>(
        el.objectId,
        SELECT_FN,
        [value],
        true,
      );
      return res.value === true;
    } finally {
      await el.release();
    }
  }

  async press(key: string): Promise<void> {
    const spec = KEYS[key.toLowerCase()];
    if (spec) {
      await this.send("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        key: spec.key,
        code: spec.code,
        windowsVirtualKeyCode: spec.keyCode,
        nativeVirtualKeyCode: spec.keyCode,
      });
      if (spec.text) {
        await this.send("Input.dispatchKeyEvent", {
          type: "char",
          key: spec.key,
          text: spec.text,
        });
      }
      await this.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: spec.key,
        code: spec.code,
        windowsVirtualKeyCode: spec.keyCode,
        nativeVirtualKeyCode: spec.keyCode,
      });
      return;
    }
    if (key.length === 1) {
      await this.send("Input.insertText", { text: key });
      return;
    }
    throw new Error(`unsupported key: ${key}`);
  }

  async scroll(dx: number, dy: number): Promise<void> {
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 0,
      y: 0,
      deltaX: dx,
      deltaY: dy,
    });
  }

  dispose(): void {
    this.capture.dispose();
  }
}

export interface BrowserSessionOptions {
  /** Injected so the API layer can park a job on a confirm. */
  requestConfirm?(request: {
    requestId: string;
    summary: string;
    url: string;
    ruleName: string;
    reason: string;
  }): Promise<boolean>;
  /** Operator-stored rule overrides; defaults are used when absent. */
  safetyConfig?: unknown;
  timeoutMs?: number;
}

export class AgentBrowser {
  private readonly pages = new Map<BrowserTabId, BrowserPage>();
  private activeTabId: BrowserTabId | null = null;
  private readonly gate: BrowserActionGate;
  private readonly timeoutMs: number;

  private constructor(
    private readonly connection: CdpConnection,
    private readonly launched: LaunchedBrowser,
    options: BrowserSessionOptions,
  ) {
    this.timeoutMs = options.timeoutMs ?? commandTimeoutMs();
    this.gate = new BrowserActionGate({
      isEnabled: () => true,
      getConfig: () => options.safetyConfig,
      currentUrl: () => this.active()?.url ?? "",
      // No confirm channel wired ⇒ the action does not happen. A missing
      // human is a denial, never an approval.
      requestConfirm: options.requestConfirm ?? (async () => false),
    });
  }

  static async launch(
    options: BrowserSessionOptions = {},
  ): Promise<AgentBrowser> {
    assertBrowserEnabled();
    const launched = await launchChrome();
    try {
      const connection = await CdpConnection.connect(
        launched.webSocketDebuggerUrl,
      );
      return new AgentBrowser(connection, launched, options);
    } catch (err) {
      launched.close();
      throw err;
    }
  }

  active(): BrowserPage | null {
    if (!this.activeTabId) return null;
    return this.pages.get(this.activeTabId) ?? null;
  }

  async newPage(): Promise<BrowserPage> {
    if (this.pages.size >= maxPages()) {
      throw new Error(
        `page limit reached (${maxPages()}) — raise KR8KAN_BROWSER_MAX_PAGES or close a tab`,
      );
    }
    const created = await this.connection.send<{ targetId?: string }>(
      "Target.createTarget",
      { url: "about:blank" },
      undefined,
      this.timeoutMs,
    );
    const targetId = created.targetId;
    if (!targetId) throw new Error("chrome did not return a target id");

    const attached = await this.connection.send<{ sessionId?: string }>(
      "Target.attachToTarget",
      { targetId, flatten: true },
      undefined,
      this.timeoutMs,
    );
    const sessionId = attached.sessionId;
    if (!sessionId) throw new Error("could not attach to the new page");

    const page = new BrowserPage(
      targetId,
      sessionId,
      this.connection,
      this.timeoutMs,
    );
    await page.init();
    this.pages.set(targetId, page);
    this.activeTabId ??= targetId;
    return page;
  }

  async closePage(tabId: BrowserTabId): Promise<void> {
    const page = this.pages.get(tabId);
    if (!page) throw new Error(`unknown tab ${tabId}`);
    page.dispose();
    this.pages.delete(tabId);
    if (this.activeTabId === tabId) {
      this.activeTabId = this.pages.keys().next().value ?? null;
    }
    await this.connection
      .send(
        "Target.closeTarget",
        { targetId: tabId },
        undefined,
        this.timeoutMs,
      )
      .catch(() => undefined);
  }

  tabs(): BrowserTab[] {
    return [...this.pages.entries()].map(([id, page]) => ({
      id,
      title: page.title,
      url: page.url,
      active: id === this.activeTabId,
      createdAt: 0,
    }));
  }

  /** Single entry point — gate first, then act. */
  async execute(command: AgentBrowserCommand): Promise<AgentBrowserResult> {
    const params = commandParams(command);
    let outcome: GateOutcome;
    try {
      outcome = await this.gate.evaluate(command.type, params);
    } catch (err) {
      return {
        ok: false,
        error: `safety gate failed: ${(err as Error).message}`,
      };
    }

    if (outcome.kind === "block") {
      return {
        ok: false,
        error: outcome.message,
        safety: { effect: "block" },
      };
    }
    if (outcome.kind === "confirm-needed") {
      return {
        ok: false,
        error: "awaiting human confirmation",
        safety: {
          effect: "confirm",
          ruleName: outcome.request.ruleName,
          reason: outcome.request.reason,
        },
      };
    }

    const mask = outcome.kind === "mask";
    const safety =
      outcome.kind === "mask"
        ? { effect: "mask", ruleName: outcome.ruleName }
        : { effect: "allow" };
    try {
      const data = await this.dispatch(command, mask);
      return { ok: true, data, safety };
    } catch (err) {
      if (err instanceof NavigationDeniedError) {
        return {
          ok: false,
          error: `navigation denied: ${err.message}`,
          safety: { effect: "block" },
        };
      }
      return { ok: false, error: (err as Error).message };
    }
  }

  private async requirePage(): Promise<BrowserPage> {
    const page = this.active();
    if (page) return page;
    return this.newPage();
  }

  private async dispatch(
    command: AgentBrowserCommand,
    mask: boolean,
  ): Promise<unknown> {
    switch (command.type) {
      case "goto": {
        const page = await this.requirePage();
        await page.navigate(command.url, command.waitUntil);
        return { url: mask ? maskUrl(page.url) : page.url };
      }
      case "back":
      case "forward": {
        const page = await this.requirePage();
        await page.history(command.type === "back" ? -1 : 1);
        return { url: mask ? maskUrl(page.url) : page.url };
      }
      case "reload": {
        const page = await this.requirePage();
        await page.reload();
        return { url: mask ? maskUrl(page.url) : page.url };
      }
      case "click": {
        const page = await this.requirePage();
        await page.click(command);
        return { clicked: command.ref ?? command.selector };
      }
      case "hover": {
        const page = await this.requirePage();
        await page.hover(command);
        return { hovered: command.ref ?? command.selector };
      }
      case "type": {
        const page = await this.requirePage();
        await page.type(command, command.text);
        return { typed: maskInputValue(command.text) };
      }
      case "fill": {
        const page = await this.requirePage();
        await page.fill(command, command.text);
        return { filled: maskInputValue(command.text) };
      }
      case "select": {
        const page = await this.requirePage();
        const ok = await page.select(command, command.value);
        return { selected: ok };
      }
      case "press": {
        const page = await this.requirePage();
        await page.press(command.key);
        return { pressed: command.key };
      }
      case "scroll": {
        const page = await this.requirePage();
        await page.scroll(command.dx ?? 0, command.dy ?? 0);
        return { scrolled: true };
      }
      case "snapshot": {
        const page = await this.requirePage();
        return page.snapshot(command.maxNodes, mask);
      }
      case "screenshot": {
        const page = await this.requirePage();
        return page.screenshot(command.fullPage === true, command.preset);
      }
      case "console": {
        const page = await this.requirePage();
        return page.capture.consoleEntries(command.level, mask);
      }
      case "network": {
        const page = await this.requirePage();
        return page.capture.networkEntries(mask);
      }
      case "tabCreate": {
        const page = await this.newPage();
        this.activeTabId = page.targetId;
        if (command.url) await page.navigate(command.url);
        return {
          tabId: page.targetId,
          url: mask ? maskUrl(page.url) : page.url,
        };
      }
      case "tabClose": {
        const tabId = command.tabId ?? this.activeTabId;
        if (!tabId) throw new Error("no tab to close");
        await this.closePage(tabId);
        return { closed: tabId };
      }
      case "tabList":
        return this.tabs().map((t) =>
          mask
            ? { ...t, url: maskUrl(t.url), title: maskPageText(t.title) }
            : t,
        );
      case "tabSwitch": {
        if (!this.pages.has(command.tabId)) {
          throw new Error(`unknown tab ${command.tabId}`);
        }
        this.activeTabId = command.tabId;
        await this.connection
          .send("Target.activateTarget", { targetId: command.tabId })
          .catch(() => undefined);
        return { tabId: command.tabId };
      }
    }
  }

  async close(): Promise<void> {
    for (const page of this.pages.values()) page.dispose();
    this.pages.clear();
    this.activeTabId = null;
    this.connection.close();
    this.launched.close();
  }
}

function commandParams(command: AgentBrowserCommand): Record<string, unknown> {
  const { type: _type, ...rest } = command as Record<string, unknown> & {
    type: string;
  };
  return rest;
}
