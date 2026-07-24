/**
 * Tiny mustache-subset interpolator for workflow templates. Whitelist
 * paths only — `{{card.title}}`, `{{trigger.emoji}}`,
 * `{{steps.0.result.summary}}` — no expressions, no eval, unknown paths
 * render as empty string. Values are stringified plainly; objects render
 * as compact JSON capped in length.
 */

const PATH_RE = /\{\{\s*([a-zA-Z0-9_.[\]]+)\s*\}\}/g;
const ALLOWED_ROOTS = new Set(["card", "board", "trigger", "steps", "workflow"]);
const VALUE_MAX = 2000;

function lookup(scope: Record<string, unknown>, path: string): unknown {
  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  if (parts.length === 0 || !ALLOWED_ROOTS.has(parts[0]!)) return undefined;
  let current: unknown = scope;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function render(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.slice(0, VALUE_MAX);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value).slice(0, VALUE_MAX);
  } catch {
    return "";
  }
}

export function interpolate(
  template: string,
  scope: Record<string, unknown>,
): string {
  return template.replace(PATH_RE, (_, path: string) =>
    render(lookup(scope, path)),
  );
}
