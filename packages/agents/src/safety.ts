import { isAbsolute, normalize, resolve, sep } from "node:path";

import { redactSecrets } from "@kr8kan/shared";

/**
 * Safety rails for Pi workers:
 *  - env passed to the pi process is scrubbed of Kr8Kan secrets
 *    (provider API keys the operator configured for pi itself stay,
 *    since pi needs them to reach its models)
 *  - prompt payloads are redacted of secret-looking strings
 *  - job artifacts are confined to the workspace job dir
 *  - workers get no tools by default (pi runs with --no-tools); arbitrary
 *    shell requires the operator to opt in via KR8KAN_PI_ALLOW_TOOLS=true
 */

const SECRET_ENV_KEYS = [
  "BETTER_AUTH_SECRET",
  // NCB_SECRET_KEY is the data-store master credential — full read/write
  // on every table. It must never reach a pi child process (dev-task runs
  // with shell tools inside operator-linked repos).
  "NCB_SECRET_KEY",
  "NCB_INSTANCE",
  "POSTGRES_URL",
  "REDIS_URL",
  "SMTP_PASSWORD",
  "SMTP_USER",
  "S3_SECRET_ACCESS_KEY",
  "S3_ACCESS_KEY_ID",
  "KR8KAN_API_TOKEN",
  "KR8KAN_ADMIN_API_KEY",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_CLIENT_SECRET",
  "OIDC_CLIENT_SECRET",
];

export function scrubEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const out = {} as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(env)) {
    if (SECRET_ENV_KEYS.includes(key)) continue;
    out[key] = value;
  }
  return out;
}

export function redactForModel(text: string): string {
  return redactSecrets(text);
}

export function toolsAllowed(): boolean {
  return process.env.KR8KAN_PI_ALLOW_TOOLS === "true";
}

/**
 * Resolve the job directory and refuse anything that escapes the
 * workspace root. Job artifacts live under <root>/.kr8kan by default.
 */
export function resolveJobDir(root: string): string {
  const configured = process.env.KR8KAN_PI_JOB_DIR ?? ".kr8kan/jobs";
  const abs = isAbsolute(configured)
    ? normalize(configured)
    : resolve(root, configured);
  const rootAbs = resolve(root);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) {
    throw new Error(
      `KR8KAN_PI_JOB_DIR must stay inside the workspace (${rootAbs}); got ${abs}`,
    );
  }
  return abs;
}

/** Hard cap on captured model output. */
export const MAX_OUTPUT_BYTES = 256 * 1024;

/** Wall-clock timeout for a single worker run. */
export const WORKER_TIMEOUT_MS = 180_000;

/** Tool runs do real work in real folders — give them longer. */
export function toolRunTimeoutMs(): number {
  const raw = Number(process.env.KR8KAN_PI_TOOL_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 900_000;
}

/**
 * Project-folder allowlist for tool-enabled workers. The operator names
 * permitted roots via KR8KAN_PI_PROJECT_ROOTS (colon-separated absolute
 * paths). A board may only be linked to a folder inside one of them.
 * Unset ⇒ no project runs at all — deny by default.
 */
export function projectRoots(): string[] {
  return (process.env.KR8KAN_PI_PROJECT_ROOTS ?? "")
    .split(":")
    .map((p) => p.trim())
    .filter((p) => p && isAbsolute(p))
    .map((p) => normalize(p));
}

export function resolveProjectPath(path: string): string {
  if (!isAbsolute(path)) {
    throw new Error("project folder must be an absolute path");
  }
  const abs = normalize(path);
  if (abs.includes("..")) {
    throw new Error("project folder must not contain '..'");
  }
  const roots = projectRoots();
  if (roots.length === 0) {
    throw new Error(
      "no project roots configured — set KR8KAN_PI_PROJECT_ROOTS (colon-separated absolute paths) to allow folder-scoped agent runs",
    );
  }
  const ok = roots.some((root) => abs === root || abs.startsWith(root + sep));
  if (!ok) {
    throw new Error(
      `project folder ${abs} is outside the allowed roots (${roots.join(", ")})`,
    );
  }
  return abs;
}
