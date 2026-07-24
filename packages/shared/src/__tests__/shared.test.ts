import { describe, expect, it } from "vitest";

import { roleHasPermission } from "../permissions";
import { computeMove, insertAndRenumber } from "../reorder";
import { redactSecrets } from "../sanitize";
import { slugify } from "../slug";
import { generateUID, isValidUID } from "../uid";

describe("generateUID", () => {
  it("returns 12-char ids from the safe alphabet", () => {
    for (let i = 0; i < 100; i++) {
      const uid = generateUID();
      expect(uid).toHaveLength(12);
      expect(isValidUID(uid)).toBe(true);
    }
  });

  it("does not collide across a small sample", () => {
    const seen = new Set(Array.from({ length: 1000 }, () => generateUID()));
    expect(seen.size).toBe(1000);
  });
});

describe("permissions", () => {
  it("admin can do everything a member can", () => {
    expect(roleHasPermission("admin", "workspace:delete")).toBe(true);
    expect(roleHasPermission("admin", "card:move")).toBe(true);
  });
  it("guest cannot mutate boards", () => {
    expect(roleHasPermission("guest", "board:edit")).toBe(false);
    expect(roleHasPermission("guest", "card:move")).toBe(false);
    expect(roleHasPermission("guest", "card:comment")).toBe(true);
  });
  it("member cannot manage members or delete workspace", () => {
    expect(roleHasPermission("member", "member:manage")).toBe(false);
    expect(roleHasPermission("member", "workspace:delete")).toBe(false);
  });
  it("agent permissions: members run, only admins manage", () => {
    expect(roleHasPermission("member", "agent:run")).toBe(true);
    expect(roleHasPermission("guest", "agent:run")).toBe(false);
    expect(roleHasPermission("admin", "agent:manage")).toBe(true);
    expect(roleHasPermission("member", "agent:manage")).toBe(false);
    expect(roleHasPermission("guest", "agent:manage")).toBe(false);
  });
});

describe("card move / reorder", () => {
  const list = (ids: number[]) => ids.map((id, index) => ({ id, index }));

  it("reorders within a list", () => {
    const { source } = computeMove({ source: list([1, 2, 3, 4]), id: 4, position: 0 });
    const map = Object.fromEntries(source.map((i) => [i.id, i.index]));
    expect(map[4]).toBe(0);
    expect(map[1]).toBe(1);
    expect(map[3]).toBe(3);
  });

  it("moves across lists and renumbers both", () => {
    const { source, target } = computeMove({
      source: list([1, 2, 3]),
      target: list([10, 11]),
      id: 2,
      position: 1,
    });
    expect(source.find((i) => i.id === 3)?.index).toBe(1);
    const t = Object.fromEntries(target.map((i) => [i.id, i.index]));
    expect(t[10]).toBe(0);
    expect(t[2]).toBe(1);
    expect(t[11]).toBe(2);
  });

  it("clamps out-of-range positions", () => {
    const next = insertAndRenumber(list([1, 2]), { id: 9, index: 0 }, 99);
    expect(next.map((i) => i.id)).toEqual([1, 2, 9]);
  });
});

describe("redactSecrets", () => {
  it("redacts env-style secrets and bearer tokens", () => {
    const input = "BETTER_AUTH_SECRET=supersecret123 Authorization: Bearer abc.def.ghi";
    const out = redactSecrets(input);
    expect(out).not.toContain("supersecret123");
    expect(out).not.toContain("abc.def.ghi");
  });
});

describe("slugify", () => {
  it("normalizes to url-safe", () => {
    expect(slugify("Hello  World! Ünicode")).toBe("hello-world-unicode");
  });
});
