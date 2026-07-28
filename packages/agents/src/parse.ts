import { WORKER_SCHEMAS } from "./schemas";

export type ParseResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

// Tolerant of formatting variance the model controls (case, whitespace,
// single-line fences) — Zod below stays the real fail-closed gate.
const FENCED_JSON = /```[ \t]*json[ \t]*\r?\n?([\s\S]*?)```/gi;
const FENCED_ANY = /```[a-zA-Z]*[ \t]*\r?\n?([\s\S]*?)```/g;

/** Last balanced {...} object in the text that JSON.parses — rescues bare
 * (unfenced) JSON output. Widens from the last '{' before the last '}'
 * outward until a candidate parses. */
function lastBareJsonObject(text: string): string | null {
  const end = text.lastIndexOf("}");
  if (end === -1) return null;
  for (
    let start = text.lastIndexOf("{", end);
    start !== -1;
    start = start === 0 ? -1 : text.lastIndexOf("{", start - 1)
  ) {
    const candidate = text.slice(start, end + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // keep widening toward the outermost object
    }
  }
  return null;
}

/**
 * Extract + validate the structured payload from a worker's final text.
 * Strategy: last fenced ```json block wins; when no json-tagged fence
 * exists, fall back to the last untagged fenced block that parses, then
 * to the last bare {...} object in the text (formatting variance only —
 * truncated output still fails). Zod-validate against the worker's
 * schema. Fail closed — a completed run with unparseable output gets an
 * explicit parse error and apply stays blocked.
 */
export function parseWorkerResult(worker: string, text: string): ParseResult {
  const schema = WORKER_SCHEMAS[worker];
  if (schema === undefined) {
    return { ok: false, error: `unknown worker: ${worker}` };
  }
  if (schema === null) {
    return { ok: false, error: "worker has no structured-output schema" };
  }

  let lastBlock: string | null = null;
  for (const match of text.matchAll(FENCED_JSON)) {
    lastBlock = match[1] ?? null;
  }

  let payload: unknown;
  if (lastBlock !== null) {
    // A json-tagged fence is the declared contract: bad JSON inside it is
    // bad data, not formatting variance — fail closed, no fallback.
    try {
      payload = JSON.parse(lastBlock);
    } catch (err) {
      return {
        ok: false,
        error: `invalid JSON in fenced block: ${err instanceof Error ? err.message : "parse error"}`,
      };
    }
  } else {
    // No json-tagged fence — rescue order: last untagged fenced block
    // that parses, then last bare {...} object in the text.
    let rescued: string | null = null;
    for (const match of [...text.matchAll(FENCED_ANY)].reverse()) {
      const block = match[1];
      if (!block) continue;
      try {
        JSON.parse(block);
        rescued = block;
        break;
      } catch {
        // not JSON — try the previous block
      }
    }
    rescued ??= lastBareJsonObject(text);
    if (rescued === null) {
      return { ok: false, error: "no fenced ```json block in worker output" };
    }
    payload = JSON.parse(rescued);
  }

  const validated = schema.safeParse(payload);
  if (!validated.success) {
    const issues = validated.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `schema mismatch: ${issues}` };
  }
  return { ok: true, data: validated.data };
}
