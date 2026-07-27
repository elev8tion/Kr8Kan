import { describe, expect, it } from "vitest";

import {
  assertNavigable,
  isPrivateAddress,
  parseAllowedHost,
  parseAllowedHosts,
  parseNavigationTarget,
} from "../safety/url";

const localOnly = parseAllowedHosts(["localhost:3310"]);
const publicHost = parseAllowedHosts(["example.com"]);

describe("parseAllowedHost", () => {
  it("splits host and port", () => {
    expect(parseAllowedHost("localhost:3310")).toEqual({
      hostname: "localhost",
      port: 3310,
      local: true,
    });
  });

  it("keeps bracketed IPv6 intact", () => {
    expect(parseAllowedHost("[::1]:3310")).toEqual({
      hostname: "[::1]",
      port: 3310,
      local: true,
    });
  });

  it("marks public domains as non-local", () => {
    expect(parseAllowedHost("example.com")?.local).toBe(false);
  });

  it("marks private literals as local", () => {
    expect(parseAllowedHost("192.168.1.10")?.local).toBe(true);
  });

  it("rejects an out-of-range port", () => {
    expect(parseAllowedHost("example.com:99999")).toBeNull();
  });
});

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
  ])("flags %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "93.184.216.34", "2606:2800:220:1::"])(
    "permits %s",
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );

  it("treats a non-address as unsafe", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
  });
});

describe("parseNavigationTarget", () => {
  it("assumes http for a bare host", () => {
    expect(parseNavigationTarget("localhost:3310")?.toString()).toBe(
      "http://localhost:3310/",
    );
  });

  it("keeps an explicit scheme", () => {
    expect(parseNavigationTarget("https://example.com/x")?.protocol).toBe(
      "https:",
    );
  });
});

describe("assertNavigable", () => {
  it("allows an allowlisted local host", async () => {
    await expect(
      assertNavigable("http://localhost:3310/board", {
        allowedHosts: localOnly,
      }),
    ).resolves.toBe("http://localhost:3310/board");
  });

  it("denies file://", async () => {
    await expect(
      assertNavigable("file:///etc/passwd", { allowedHosts: localOnly }),
    ).rejects.toThrow(/not navigable/);
  });

  it("denies a host that is not allowlisted", async () => {
    await expect(
      assertNavigable("http://evil.test/", { allowedHosts: localOnly }),
    ).rejects.toThrow(/not in KR8KAN_BROWSER_ALLOWED_HOSTS/);
  });

  it("denies a mismatched port", async () => {
    await expect(
      assertNavigable("http://localhost:9999/", { allowedHosts: localOnly }),
    ).rejects.toThrow(/not in KR8KAN_BROWSER_ALLOWED_HOSTS/);
  });

  it("denies everything when nothing is allowlisted", async () => {
    await expect(
      assertNavigable("http://localhost:3310/", { allowedHosts: [] }),
    ).rejects.toThrow(/no hosts are allowlisted/);
  });

  it("denies credentials in the URL", async () => {
    await expect(
      assertNavigable("http://user:pw@localhost:3310/", {
        allowedHosts: localOnly,
      }),
    ).rejects.toThrow(/credentials/);
  });

  it("denies an allowlisted domain that resolves to link-local metadata", async () => {
    await expect(
      assertNavigable("https://example.com/", {
        allowedHosts: publicHost,
        resolveHost: async () => ["169.254.169.254"],
      }),
    ).rejects.toThrow(/non-public address/);
  });

  it("denies when any resolved address is private", async () => {
    await expect(
      assertNavigable("https://example.com/", {
        allowedHosts: publicHost,
        resolveHost: async () => ["93.184.216.34", "10.0.0.5"],
      }),
    ).rejects.toThrow(/non-public address/);
  });

  it("allows a public domain resolving publicly", async () => {
    await expect(
      assertNavigable("https://example.com/x", {
        allowedHosts: publicHost,
        resolveHost: async () => ["93.184.216.34"],
      }),
    ).resolves.toBe("https://example.com/x");
  });

  it("skips the address check for a deliberately local entry", async () => {
    let resolved = false;
    await assertNavigable("http://localhost:3310/", {
      allowedHosts: localOnly,
      resolveHost: async () => {
        resolved = true;
        return ["127.0.0.1"];
      },
    });
    expect(resolved).toBe(false);
  });

  it("matches subdomains of an allowlisted domain", async () => {
    await expect(
      assertNavigable("https://docs.example.com/", {
        allowedHosts: publicHost,
        resolveHost: async () => ["93.184.216.34"],
      }),
    ).resolves.toContain("docs.example.com");
  });
});
