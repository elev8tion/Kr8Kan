/**
 * End-to-end against a real Chrome and a real page.
 *
 * Skipped when no Chrome/Chromium is installed, so the suite still runs on
 * a bare CI box — but when a browser is present these are the tests that
 * matter, because the unit tests above cannot tell you whether CDP works.
 */

import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findChrome } from "../cdp/launcher";
import { AgentBrowser } from "../driver";

function chromeAvailable(): boolean {
  try {
    findChrome();
    return true;
  } catch {
    return false;
  }
}

const PAGE = `<!doctype html>
<html><head><title>Kr8Kan fixture</title></head>
<body>
  <h1>Sprint board</h1>
  <form id="login">
    <label for="email">Email</label>
    <input id="email" type="text" name="email" />
    <button id="go" type="button">Sign in</button>
  </form>
  <p id="out">idle</p>
  <script>
    document.getElementById('go').addEventListener('click', () => {
      document.getElementById('out').textContent =
        'clicked:' + document.getElementById('email').value;
    });
    console.error('deliberate console error');
  </script>
</body></html>`;

describe.skipIf(!chromeAvailable())("agent browser against real Chrome", () => {
  let server: Server;
  let origin: string;
  let browser: AgentBrowser;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(PAGE);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    origin = `http://127.0.0.1:${address.port}`;

    process.env.KR8KAN_BROWSER_ENABLED = "true";
    process.env.KR8KAN_BROWSER_ALLOWED_HOSTS = `127.0.0.1:${address.port}`;
    browser = await AgentBrowser.launch();
    const goto = await browser.execute({ type: "goto", url: `${origin}/` });
    expect(goto.ok).toBe(true);
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  it("denies a host outside the allowlist", async () => {
    const res = await browser.execute({
      type: "goto",
      url: "http://example.com/",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not in KR8KAN_BROWSER_ALLOWED_HOSTS/);
  });

  it("denies file://", async () => {
    const res = await browser.execute({
      type: "goto",
      url: "file:///etc/passwd",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not navigable/);
  });

  it("snapshots controls with refs and page text", async () => {
    const res = await browser.execute({ type: "snapshot" });
    const snapshot = res.data as {
      text: string;
      nodes: Array<{ ref: string; role: string; name: string }>;
    };
    expect(snapshot.text).toMatch(/Sprint board/);
    const button = snapshot.nodes.find((n) => n.role === "button");
    expect(button?.ref).toBeTruthy();
    // Prose has to be visible too, not just the controls.
    expect(snapshot.text).toMatch(/idle/);
  });

  it("fills and clicks by ref, and the page actually changes", async () => {
    const before = (
      (await browser.execute({ type: "snapshot" })).data as {
        nodes: Array<{ ref: string; role: string }>;
      }
    ).nodes;
    const email = before.find((n) => n.role === "textbox");
    const button = before.find((n) => n.role === "button");

    const filled = await browser.execute({
      type: "fill",
      ref: email?.ref,
      text: "ada@example.com",
    });
    expect(filled.ok).toBe(true);
    // A typed value never comes back out in clear text.
    expect(JSON.stringify(filled.data)).not.toContain("ada@example.com");

    const clicked = await browser.execute({ type: "click", ref: button?.ref });
    expect(clicked.ok).toBe(true);

    const after = (await browser.execute({ type: "snapshot" })).data as {
      text: string;
    };
    expect(after.text).toMatch(/clicked:ada@example\.com/);
  });

  it("rejects a malformed selector instead of evaluating it", async () => {
    const res = await browser.execute({
      type: "click",
      selector: "#nope\\'\n+alert(1)//",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/querySelector|no element matched/);
  });

  it("fails an unknown ref rather than acting on the wrong element", async () => {
    const res = await browser.execute({ type: "click", ref: "e9999" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown ref/);
  });

  it("captures console errors", async () => {
    const res = await browser.execute({ type: "console", level: "error" });
    const errors = res.data as Array<{ text: string }>;
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => /deliberate console error/.test(e.text))).toBe(
      true,
    );
  });

  it("captures network activity", async () => {
    const res = await browser.execute({ type: "network" });
    expect((res.data as unknown[]).length).toBeGreaterThan(0);
  });

  it("takes a full-page screenshot and reports the real pixel size", async () => {
    const res = await browser.execute({ type: "screenshot", fullPage: true });
    const shot = res.data as { data: string; width: number; height: number };
    expect(shot.data.length).toBeGreaterThan(1000);
    expect(shot.width).toBeGreaterThan(0);
    expect(shot.height).toBeGreaterThan(0);
  });

  it("honours a viewport preset", async () => {
    const res = await browser.execute({
      type: "screenshot",
      preset: "mobile-m",
    });
    // 375 CSS px at a device scale factor of 2.
    expect((res.data as { width: number }).width).toBe(750);
  });

  it("enforces the page limit", async () => {
    const first = await browser.execute({ type: "tabCreate" });
    expect(first.ok).toBe(true);
    const overLimit = await browser.execute({ type: "tabCreate" });
    expect(overLimit.ok).toBe(false);
    expect(overLimit.error).toMatch(/page limit reached/);
    const tabId = (first.data as { tabId: string }).tabId;
    await browser.execute({ type: "tabClose", tabId });
  });
});
