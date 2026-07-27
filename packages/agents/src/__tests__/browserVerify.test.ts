import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { findChrome } from "@kr8kan/browser";

import {
  applyBrowserVerdict,
  formatConsoleErrors,
  runBrowserVerify,
  type BrowserVerifyResult,
} from "../browserVerify";
import type { JobRecord } from "../types";

type VerdictPatch = Pick<
  JobRecord,
  | "verifyStatus"
  | "verifyLog"
  | "browserArtifacts"
  | "browserConsoleErrors"
  | "browserError"
>;

function inspection(
  over: Partial<BrowserVerifyResult> = {},
): BrowserVerifyResult {
  return { artifacts: [], consoleErrors: [], ...over };
}

describe("formatConsoleErrors", () => {
  it("pluralises a single error correctly", () => {
    expect(formatConsoleErrors(["boom"])).toContain("1 console error on");
  });

  it("caps the list and says how many were dropped", () => {
    const many = Array.from({ length: 14 }, (_, i) => `err-${i}`);
    const text = formatConsoleErrors(many);
    expect(text).toContain("14 console errors");
    expect(text).toContain("… and 4 more");
    expect(text).not.toContain("err-11");
  });
});

describe("applyBrowserVerdict", () => {
  it("fails a job whose verify command passed", () => {
    const patch: VerdictPatch = {
      verifyStatus: "pass",
      verifyLog: "$ pnpm test\nok",
    };
    applyBrowserVerdict(patch, inspection({ consoleErrors: ["TypeError: x"] }));
    expect(patch.verifyStatus).toBe("fail");
    expect(patch.verifyLog).toContain("$ pnpm test");
    expect(patch.verifyLog).toContain("TypeError: x");
    expect(patch.browserConsoleErrors).toEqual(["TypeError: x"]);
  });

  it("leaves a clean pass alone", () => {
    const patch: VerdictPatch = { verifyStatus: "pass", verifyLog: "ok" };
    applyBrowserVerdict(patch, inspection());
    expect(patch.verifyStatus).toBe("pass");
    expect(patch.verifyLog).toBe("ok");
    expect(patch.browserConsoleErrors).toBeUndefined();
  });

  it("records artifacts without touching verify", () => {
    const patch: VerdictPatch = { verifyStatus: "pass" };
    applyBrowserVerdict(
      patch,
      inspection({
        artifacts: [
          {
            name: "desktop",
            preset: "viewport",
            width: 1,
            height: 1,
            bytes: 1,
            path: "/tmp/x/desktop.png",
            capturedAt: "2026-07-26T00:00:00.000Z",
          },
        ],
      }),
    );
    expect(patch.browserArtifacts).toHaveLength(1);
    expect(patch.verifyStatus).toBe("pass");
  });

  it("surfaces a capture failure without failing the job", () => {
    const patch: VerdictPatch = { verifyStatus: "pass" };
    applyBrowserVerdict(patch, inspection({ error: "browser is disabled" }));
    expect(patch.browserError).toBe("browser is disabled");
    expect(patch.verifyStatus).toBe("pass");
  });

  it("writes a summary even when there was no verify log", () => {
    const patch: VerdictPatch = {};
    applyBrowserVerdict(patch, inspection({ consoleErrors: ["boom"] }));
    expect(patch.verifyLog).toContain("1 console error");
    expect(patch.verifyStatus).toBe("fail");
  });
});

describe("runBrowserVerify when the browser is disabled", () => {
  const prior = process.env.KR8KAN_BROWSER_ENABLED;
  afterEach(() => {
    process.env.KR8KAN_BROWSER_ENABLED = prior;
  });

  it("reports why nothing was captured instead of throwing", async () => {
    delete process.env.KR8KAN_BROWSER_ENABLED;
    const result = await runBrowserVerify({
      url: "http://localhost:3310/",
      jobId: "job1",
      jobDir: tmpdir(),
    });
    expect(result.artifacts).toEqual([]);
    expect(result.error).toMatch(/KR8KAN_BROWSER_ENABLED/);
  });
});

function chromeAvailable(): boolean {
  try {
    findChrome();
    return true;
  } catch {
    return false;
  }
}

const CLEAN_PAGE = `<!doctype html><html><head><title>clean</title></head>
<body><h1>Board renders</h1></body></html>`;

const THROWING_PAGE = `<!doctype html><html><head><title>broken</title></head>
<body><h1>Board renders</h1>
<script>console.error('TypeError: cannot read property of undefined');</script>
</body></html>`;

describe.skipIf(!chromeAvailable())(
  "runBrowserVerify against real Chrome",
  () => {
    let server: Server;
    let origin: string;
    let jobDir: string;
    let body = CLEAN_PAGE;
    const prior = { ...process.env };

    beforeAll(async () => {
      server = createServer((_req, res) => {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(body);
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      origin = `http://127.0.0.1:${address.port}`;
      jobDir = mkdtempSync(join(tmpdir(), "kr8kan-verify-"));
      process.env.KR8KAN_BROWSER_ENABLED = "true";
      process.env.KR8KAN_BROWSER_ALLOWED_HOSTS = `127.0.0.1:${address.port}`;
    });

    afterAll(() => {
      server?.close();
      rmSync(jobDir, { recursive: true, force: true });
      process.env.KR8KAN_BROWSER_ENABLED = prior.KR8KAN_BROWSER_ENABLED;
      process.env.KR8KAN_BROWSER_ALLOWED_HOSTS =
        prior.KR8KAN_BROWSER_ALLOWED_HOSTS;
    });

    it("writes desktop and mobile screenshots to the job dir", async () => {
      body = CLEAN_PAGE;
      const result = await runBrowserVerify({
        url: `${origin}/`,
        jobId: "jobclean",
        jobDir,
      });
      expect(result.error).toBeUndefined();
      expect(result.artifacts.map((a) => a.name).sort()).toEqual([
        "desktop",
        "mobile",
      ]);
      expect(result.consoleErrors).toEqual([]);

      for (const artifact of result.artifacts) {
        const png = readFileSync(artifact.path);
        // Real PNG magic — the file is an image, not an empty placeholder.
        expect(png.subarray(0, 4).toString("hex")).toBe("89504e47");
        expect(png.byteLength).toBe(artifact.bytes);
      }
      const mobile = result.artifacts.find((a) => a.name === "mobile");
      expect(mobile?.width).toBe(750);
    }, 60_000);

    it("captures a console error and fails a passing verify", async () => {
      body = THROWING_PAGE;
      const result = await runBrowserVerify({
        url: `${origin}/`,
        jobId: "jobbroken",
        jobDir,
      });
      expect(result.consoleErrors.length).toBeGreaterThan(0);
      expect(result.consoleErrors.join(" ")).toMatch(/TypeError/);

      // The end-to-end point of the whole pass: green shell, red page.
      const patch: VerdictPatch = { verifyStatus: "pass", verifyLog: "$ true" };
      applyBrowserVerdict(patch, result);
      expect(patch.verifyStatus).toBe("fail");
    }, 60_000);

    it("reports an unreachable host rather than throwing", async () => {
      const result = await runBrowserVerify({
        url: "http://not-allowlisted.test/",
        jobId: "jobdenied",
        jobDir,
      });
      expect(result.artifacts).toEqual([]);
      expect(result.error).toMatch(/not in KR8KAN_BROWSER_ALLOWED_HOSTS/);
    }, 60_000);
  },
);
