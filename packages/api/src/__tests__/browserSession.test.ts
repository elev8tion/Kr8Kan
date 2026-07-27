/**
 * The confirm channel against a real browser.
 *
 * The unit tests around BrowserConfirmChannel prove the promise mechanics.
 * This proves the wiring: a gated command really does park, a human answer
 * really does release it, and a denial really does stop the action.
 */

import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findChrome, type BrowserSafetyConfig } from "@kr8kan/browser";

import { browserConfirmChannel } from "../browserConfirm";
import { withAgentBrowser } from "../browserSession";

function chromeAvailable(): boolean {
  try {
    findChrome();
    return true;
  } catch {
    return false;
  }
}

const PAGE = `<!doctype html><html><head><title>gated</title></head>
<body><h1>Gated page</h1></body></html>`;

/** Confirm every navigation, so a plain goto is a gated action. */
const CONFIRM_NAVIGATION: BrowserSafetyConfig = {
  enabled: true,
  urlRules: [],
  actionRules: [
    {
      kind: "action",
      name: "Navigation",
      effect: "confirm",
      actions: ["navigate"],
    },
  ],
};

const BLOCK_NAVIGATION: BrowserSafetyConfig = {
  enabled: true,
  urlRules: [],
  actionRules: [
    {
      kind: "action",
      name: "No navigation",
      effect: "block",
      actions: ["navigate"],
    },
  ],
};

describe.skipIf(!chromeAvailable())(
  "withAgentBrowser + confirm channel",
  () => {
    let server: Server;
    let origin: string;
    const prior = { ...process.env };

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
    });

    afterAll(() => {
      server?.close();
      browserConfirmChannel.denyAll();
      process.env.KR8KAN_BROWSER_ENABLED = prior.KR8KAN_BROWSER_ENABLED;
      process.env.KR8KAN_BROWSER_ALLOWED_HOSTS =
        prior.KR8KAN_BROWSER_ALLOWED_HOSTS;
    });

    it("parks a gated navigation until a human approves it", async () => {
      const context = { jobId: "run-approve", workspaceId: 1 };
      await withAgentBrowser(
        context,
        async (browser) => {
          const navigation = browser.execute({
            type: "goto",
            url: `${origin}/`,
          });

          // Poll until the command has actually parked in the channel.
          let pending = browserConfirmChannel.list(context);
          for (let i = 0; i < 100 && pending.length === 0; i += 1) {
            await new Promise((r) => setTimeout(r, 20));
            pending = browserConfirmChannel.list(context);
          }
          expect(pending).toHaveLength(1);
          expect(pending[0]?.ruleName).toBe("Navigation");
          expect(pending[0]?.url).toBe(`${origin}/`);
          expect(pending[0]?.jobId).toBe("run-approve");

          const outcome = browserConfirmChannel.respond(
            pending[0]!.requestId,
            true,
          );
          expect(outcome).toEqual({ approved: true, matched: true });

          const result = await navigation;
          expect(result.ok).toBe(true);
          expect(browserConfirmChannel.list(context)).toHaveLength(0);
        },
        { safetyConfig: CONFIRM_NAVIGATION },
      );
    }, 60_000);

    it("stops the action when a human denies it", async () => {
      const context = { jobId: "run-deny", workspaceId: 1 };
      await withAgentBrowser(
        context,
        async (browser) => {
          const navigation = browser.execute({
            type: "goto",
            url: `${origin}/`,
          });
          let pending = browserConfirmChannel.list(context);
          for (let i = 0; i < 100 && pending.length === 0; i += 1) {
            await new Promise((r) => setTimeout(r, 20));
            pending = browserConfirmChannel.list(context);
          }
          expect(pending).toHaveLength(1);
          browserConfirmChannel.respond(pending[0]!.requestId, false);

          const result = await navigation;
          expect(result.ok).toBe(false);
          expect(result.error).toMatch(/not approved/);
        },
        { safetyConfig: CONFIRM_NAVIGATION },
      );
    }, 60_000);

    it("never asks a human about a blocked action", async () => {
      const context = { jobId: "run-block", workspaceId: 1 };
      await withAgentBrowser(
        context,
        async (browser) => {
          const result = await browser.execute({
            type: "goto",
            url: `${origin}/`,
          });
          expect(result.ok).toBe(false);
          expect(result.safety?.effect).toBe("block");
          expect(browserConfirmChannel.list(context)).toHaveLength(0);
        },
        { safetyConfig: BLOCK_NAVIGATION },
      );
    }, 60_000);

    it("denies anything still parked when the session ends", async () => {
      const context = { jobId: "run-orphan", workspaceId: 1 };
      let orphan: Promise<{ ok: boolean; error?: string }> | undefined;

      await withAgentBrowser(
        context,
        async (browser) => {
          // Start a gated command and leave without answering it.
          orphan = browser.execute({ type: "goto", url: `${origin}/` });
          let pending = browserConfirmChannel.list(context);
          for (let i = 0; i < 100 && pending.length === 0; i += 1) {
            await new Promise((r) => setTimeout(r, 20));
            pending = browserConfirmChannel.list(context);
          }
          expect(pending).toHaveLength(1);
        },
        { safetyConfig: CONFIRM_NAVIGATION },
      );

      expect(browserConfirmChannel.list(context)).toHaveLength(0);
      const result = await orphan;
      expect(result?.ok).toBe(false);
    }, 60_000);
  },
);
