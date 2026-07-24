import { afterEach, describe, expect, it } from "vitest";

import { WORKERS, getWorker } from "../registry";
import { resolveJobDir, resolveProjectPath, scrubEnv } from "../safety";

describe("registry", () => {
  it("contains the documented worker set", () => {
    const names = WORKERS.map((w) => w.name);
    expect(names).toEqual([
      "summarize-board",
      "draft-card",
      "triage-card",
      "breakdown-card",
      "standup",
      "dev-task",
      "custom",
    ]);
  });
  it("resolves workers by name", () => {
    expect(getWorker("summarize-board")?.needs).toBe("board");
    expect(getWorker("nope")).toBeUndefined();
  });
});

describe("scrubEnv", () => {
  it("drops Kr8Kan secrets but keeps provider keys", () => {
    const env = scrubEnv({
      BETTER_AUTH_SECRET: "x",
      POSTGRES_URL: "postgres://…",
      SMTP_PASSWORD: "x",
      ANTHROPIC_API_KEY: "provider-key",
      PATH: "/usr/bin",
    });
    expect(env.BETTER_AUTH_SECRET).toBeUndefined();
    expect(env.POSTGRES_URL).toBeUndefined();
    expect(env.SMTP_PASSWORD).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBe("provider-key");
    expect(env.PATH).toBe("/usr/bin");
  });
});

describe("resolveJobDir", () => {
  afterEach(() => {
    delete process.env.KR8KAN_PI_JOB_DIR;
  });

  it("defaults inside the workspace", () => {
    expect(resolveJobDir("/Users/kc/kr8kan")).toBe(
      "/Users/kc/kr8kan/.kr8kan/jobs",
    );
  });

  it("rejects escapes from the workspace", () => {
    process.env.KR8KAN_PI_JOB_DIR = "../outside";
    expect(() => resolveJobDir("/Users/kc/kr8kan")).toThrow(/inside the workspace/);
  });

  it("rejects absolute paths outside the workspace", () => {
    process.env.KR8KAN_PI_JOB_DIR = "/tmp/jobs";
    expect(() => resolveJobDir("/Users/kc/kr8kan")).toThrow(/inside the workspace/);
  });
});

describe("resolveProjectPath", () => {
  afterEach(() => {
    delete process.env.KR8KAN_PI_PROJECT_ROOTS;
  });

  it("denies everything when no roots configured", () => {
    expect(() => resolveProjectPath("/Users/kc/code/x")).toThrow(/no project roots/);
  });

  it("allows paths inside a configured root", () => {
    process.env.KR8KAN_PI_PROJECT_ROOTS = "/Users/kc/code:/Users/kc/projects";
    expect(resolveProjectPath("/Users/kc/code/my-app")).toBe("/Users/kc/code/my-app");
    expect(resolveProjectPath("/Users/kc/projects")).toBe("/Users/kc/projects");
  });

  it("rejects paths outside the roots and traversal tricks", () => {
    process.env.KR8KAN_PI_PROJECT_ROOTS = "/Users/kc/code";
    expect(() => resolveProjectPath("/etc")).toThrow(/outside the allowed roots/);
    expect(() => resolveProjectPath("/Users/kc/code-evil")).toThrow(/outside/);
    expect(() => resolveProjectPath("relative/path")).toThrow(/absolute/);
  });
});
