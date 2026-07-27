import { describe, expect, it } from "vitest";

import { captureSnapshot, renderSnapshot } from "../snapshot";

interface FakeAxNode {
  nodeId: string;
  role?: { value: string };
  name?: { value: string };
  value?: { value: string };
  backendDOMNodeId?: number;
  childIds?: string[];
  ignored?: boolean;
}

const tree: FakeAxNode[] = [
  { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2", "3"] },
  {
    nodeId: "2",
    role: { value: "heading" },
    name: { value: "Sprint board" },
    backendDOMNodeId: 20,
  },
  {
    nodeId: "3",
    role: { value: "form" },
    name: { value: "Login" },
    childIds: ["4", "5", "6"],
  },
  {
    nodeId: "4",
    role: { value: "textbox" },
    name: { value: "Email" },
    value: { value: "ada@example.com" },
    backendDOMNodeId: 40,
  },
  {
    nodeId: "5",
    role: { value: "button" },
    name: { value: "Sign in" },
    backendDOMNodeId: 50,
  },
  { nodeId: "6", role: { value: "generic" }, name: { value: "wrapper" } },
];

function sender(nodes: FakeAxNode[]) {
  return async () => ({ nodes }) as unknown as Record<string, unknown>;
}

describe("captureSnapshot", () => {
  it("emits interactive nodes with refs mapped to backend node ids", async () => {
    const { snapshot, refs } = await captureSnapshot(sender(tree), {
      url: "http://localhost:3310/",
      title: "Board",
    });
    const button = snapshot.nodes.find((n) => n.role === "button");
    expect(button?.name).toBe("Sign in");
    expect(button?.interactive).toBe(true);
    expect(refs.get(button?.ref ?? "")).toBe(50);
  });

  it("drops generic and roleless nodes", async () => {
    const { snapshot } = await captureSnapshot(sender(tree), {
      url: "http://localhost:3310/",
      title: "Board",
    });
    expect(snapshot.nodes.some((n) => n.role === "generic")).toBe(false);
  });

  it("keeps document order", async () => {
    const { snapshot } = await captureSnapshot(sender(tree), {
      url: "http://localhost:3310/",
      title: "Board",
    });
    expect(snapshot.nodes.map((n) => n.role)).toEqual([
      "heading",
      "form",
      "textbox",
      "button",
    ]);
  });

  it("truncates at maxNodes and says so", async () => {
    const { snapshot } = await captureSnapshot(sender(tree), {
      url: "http://localhost:3310/",
      title: "Board",
      maxNodes: 2,
    });
    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.text).toContain("truncated");
  });

  it("masks names and values when asked", async () => {
    const { snapshot } = await captureSnapshot(sender(tree), {
      url: "http://localhost:3310/",
      title: "Board",
      mask: true,
    });
    const textbox = snapshot.nodes.find((n) => n.role === "textbox");
    expect(textbox?.value).toBe("[redacted-email]");
    expect(snapshot.masked).toBe(true);
  });

  it("survives an empty tree", async () => {
    const { snapshot } = await captureSnapshot(sender([]), {
      url: "http://localhost:3310/",
      title: "Board",
    });
    expect(snapshot.nodes).toEqual([]);
    expect(snapshot.text).toBe("");
  });
});

describe("renderSnapshot", () => {
  it("indents by depth and shows refs only for interactive nodes", () => {
    const text = renderSnapshot([
      { ref: "e1", role: "form", name: "Login", depth: 0, interactive: false },
      {
        ref: "e2",
        role: "button",
        name: "Sign in",
        depth: 1,
        interactive: true,
      },
    ]);
    expect(text).toBe('form "Login"\n  button "Sign in" [e2]');
  });
});
