import { WORKER_SCHEMAS } from "./schemas";

export type ParseResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

const FENCED_JSON = /```json\s*\n([\s\S]*?)```/g;

/**
 * Extract + validate the structured payload from a worker's final text.
 * Strategy: last fenced ```json block wins; Zod-validate against the
 * worker's schema. Fail closed — a completed run with unparseable output
 * gets an explicit parse error and apply stays blocked.
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
  if (lastBlock === null) {
    return { ok: false, error: "no fenced ```json block in worker output" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(lastBlock);
  } catch (err) {
    return {
      ok: false,
      error: `invalid JSON in fenced block: ${err instanceof Error ? err.message : "parse error"}`,
    };
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
