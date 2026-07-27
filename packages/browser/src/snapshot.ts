/**
 * Accessibility snapshot with stable refs.
 *
 * dodis-browser's snapshot walks the DOM in-page and emits tag/class/id
 * tuples with no handle, so the agent has to invent a CSS selector and hope
 * it still matches by the time it acts. Here the snapshot comes from
 * `Accessibility.getFullAXTree` and every emitted node carries a `ref` that
 * maps back to a backend DOM node id — the agent acts on what it saw.
 *
 * Refs are stable for the lifetime of a snapshot. Taking a new snapshot
 * issues new refs; acting on a stale ref fails loudly rather than hitting
 * whatever now occupies that position.
 */

import { maskPageText } from "./safety/mask";
import type { PageSnapshot, SnapshotNode } from "./types";

export type CdpSend = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
]);

/**
 * Text-bearing roles.
 *
 * Without these a snapshot lists the controls and none of the prose, so an
 * agent can see a button called "Sign in" but not the error message next to
 * it — and a verification pass that cannot read the page cannot verify it.
 */
const TEXT_ROLES = new Set([
  "StaticText",
  "caption",
  "cell",
  "columnheader",
  "listitem",
  "paragraph",
  "rowheader",
  "text",
]);

/** Roles kept for orientation even when they cannot be acted on. */
const STRUCTURAL_ROLES = new Set([
  "alert",
  "article",
  "banner",
  "dialog",
  "form",
  "heading",
  "image",
  "list",
  "main",
  "navigation",
  "region",
  "status",
  "table",
]);

interface AxValue {
  value?: unknown;
}

interface AxNode {
  nodeId?: string;
  ignored?: boolean;
  role?: AxValue;
  name?: AxValue;
  value?: AxValue;
  backendDOMNodeId?: number;
  childIds?: string[];
}

function stringValue(v: AxValue | undefined): string {
  const raw = v?.value;
  return typeof raw === "string" ? raw.trim() : "";
}

function collapse(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export interface SnapshotOptions {
  url: string;
  title: string;
  maxNodes?: number;
  /** Apply the mask effect to names and values. */
  mask?: boolean;
}

export interface SnapshotResult {
  snapshot: PageSnapshot;
  /** ref → backend DOM node id, for resolving actions. */
  refs: Map<string, number>;
}

export async function captureSnapshot(
  send: CdpSend,
  options: SnapshotOptions,
): Promise<SnapshotResult> {
  const maxNodes = options.maxNodes ?? 200;
  const result = await send("Accessibility.getFullAXTree");
  const rawNodes = Array.isArray(result.nodes)
    ? (result.nodes as AxNode[])
    : [];

  const byId = new Map<string, AxNode>();
  for (const node of rawNodes) {
    if (node.nodeId) byId.set(node.nodeId, node);
  }

  const nodes: SnapshotNode[] = [];
  const refs = new Map<string, number>();
  const seen = new Set<string>();
  let refCounter = 0;
  let truncated = false;

  const root = rawNodes[0];
  if (root?.nodeId) {
    const stack: Array<{ id: string; depth: number }> = [
      { id: root.nodeId, depth: 0 },
    ];

    while (stack.length > 0) {
      const entry = stack.pop();
      if (!entry) break;
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);

      const node = byId.get(entry.id);
      if (!node) continue;

      const role = stringValue(node.role);
      const name = stringValue(node.name);
      const interactive = INTERACTIVE_ROLES.has(role);
      const keep =
        !node.ignored &&
        role !== "" &&
        role !== "none" &&
        role !== "generic" &&
        (interactive ||
          ((STRUCTURAL_ROLES.has(role) || TEXT_ROLES.has(role)) &&
            name !== ""));

      if (keep) {
        if (nodes.length >= maxNodes) {
          truncated = true;
        } else {
          refCounter += 1;
          const ref = `e${refCounter}`;
          const value = stringValue(node.value);
          nodes.push({
            ref,
            role,
            name: collapse(options.mask ? maskPageText(name) : name),
            value: value
              ? collapse(options.mask ? maskPageText(value) : value)
              : undefined,
            depth: entry.depth,
            interactive,
          });
          if (typeof node.backendDOMNodeId === "number") {
            refs.set(ref, node.backendDOMNodeId);
          }
        }
      }

      const childIds = node.childIds ?? [];
      // Reverse so the stack pops children in document order.
      for (let i = childIds.length - 1; i >= 0; i -= 1) {
        const childId = childIds[i];
        if (childId) {
          stack.push({
            id: childId,
            depth: keep ? entry.depth + 1 : entry.depth,
          });
        }
      }
    }
  }

  const title = options.mask ? maskPageText(options.title) : options.title;
  return {
    snapshot: {
      url: options.url,
      title,
      nodes,
      text: renderSnapshot(nodes, truncated),
      truncated,
      masked: options.mask === true,
    },
    refs,
  };
}

/** Indented text rendering — this is what reaches a prompt. */
export function renderSnapshot(
  nodes: readonly SnapshotNode[],
  truncated = false,
): string {
  const lines = nodes.map((node) => {
    const indent = "  ".repeat(Math.min(node.depth, 12));
    const name = node.name ? ` "${node.name}"` : "";
    const value = node.value ? ` = "${node.value}"` : "";
    const ref = node.interactive ? ` [${node.ref}]` : "";
    return `${indent}${node.role}${name}${value}${ref}`;
  });
  if (truncated) {
    lines.push("… snapshot truncated (raise maxNodes to see more)");
  }
  return lines.join("\n");
}
