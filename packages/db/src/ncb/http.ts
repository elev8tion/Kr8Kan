/**
 * Raw NoCodeBackend data-API client. Server-only: authenticates every
 * request with NCB_SECRET_KEY as a Bearer token. Route shapes (verified
 * against the live instance):
 *   GET    /read/<table>?Instance=...&<col>=<val>&page=&limit=
 *   POST   /create/<table>            → { id }
 *   PUT    /update/<table>/<id>
 *   DELETE /delete/<table>/<id>
 * The API supports equality filters only — no IS NULL, no IN, no
 * operators. Anything richer happens client-side in the gateway.
 */

export interface NcbConfig {
  instance: string;
  secretKey: string;
  dataApiUrl: string;
}

export class NcbError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly table?: string,
  ) {
    super(message);
    this.name = "NcbError";
  }
}

export type DbValue = string | number | null;
export type DbRow = Record<string, DbValue>;

const PAGE_LIMIT = 500;
const MAX_PAGES = 200;

/** Every NCB fetch is bounded by this — an unreachable NCB must not hang
 * request handlers forever. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Delay between retry attempts scales linearly with attempt number
 * (300ms, 600ms, ...) so we never hammer a struggling backend instantly. */
const RETRY_BACKOFF_MS = 300;

const RETRYABLE_METHODS = new Set(["GET", "PUT", "DELETE"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(
  cfg: NcbConfig,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  query?: Record<string, string | number>,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ Instance: cfg.instance });
  for (const [k, v] of Object.entries(query ?? {})) params.set(k, String(v));
  const url = `${cfg.dataApiUrl}/${path}?${params.toString()}`;

  // POST (create) is not idempotent: once the request may have reached the
  // server, a 5xx response doesn't tell us whether the row was committed —
  // NCB has no transactions to unwind it. Retrying risks duplicate rows, so
  // POST gets exactly one attempt. GET/PUT/DELETE are safe to retry (a
  // duplicate DELETE/PUT/read has no observable side effect beyond the
  // first).
  const maxAttempts = RETRYABLE_METHODS.has(method) ? 3 : 1;

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(RETRY_BACKOFF_MS * attempt);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.secretKey}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await res.text();
      if (res.status >= 500) {
        lastErr = new NcbError(`NCB ${res.status}: ${text.slice(0, 200)}`, res.status);
        continue; // retry transient server errors (no-op loop end for POST)
      }
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new NcbError(
          `NCB non-JSON response (${res.status}): ${text.slice(0, 200)}`,
          res.status,
        );
      }
      if (!res.ok || json.status === "error") {
        throw new NcbError(
          `NCB ${method} ${path} failed (${res.status}): ${String(json.error ?? json.message ?? text.slice(0, 200))}`,
          res.status,
        );
      }
      return json;
    } catch (err) {
      if (err instanceof NcbError && err.status < 500) throw err;
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new NcbError("NCB request failed after retries", 0);
}

// Tables we've already warned about truncation for in this process — one
// warning per table is enough signal without spamming logs on every hit.
const truncationWarned = new Set<string>();

/** Read all rows matching equality filters, walking pagination.
 *
 * `extraQuery` forwards additional server-side query params (e.g.
 * sort/order for gateway serverLimit forwarding) alongside the equality
 * filters and pagination params.
 */
export async function listRows(
  cfg: NcbConfig,
  table: string,
  filters: Record<string, DbValue> = {},
  limit?: number,
  extraQuery?: Record<string, string | number>,
): Promise<DbRow[]> {
  const query: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v === null || v === undefined) continue; // null filters unsupported — gateway filters client-side
    query[k] = v;
  }
  if (extraQuery) {
    for (const [k, v] of Object.entries(extraQuery)) query[k] = v;
  }
  const rows: DbRow[] = [];
  const pageLimit = limit && limit < PAGE_LIMIT ? limit : PAGE_LIMIT;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = await request(cfg, "GET", `read/${table}`, {
      ...query,
      page,
      limit: pageLimit,
    });
    const data = (json.data ?? []) as DbRow[];
    rows.push(...data);
    if (limit && rows.length >= limit) return rows.slice(0, limit);
    const meta = json.metadata as { hasMore?: boolean } | undefined;
    if (!meta?.hasMore || data.length === 0) break;
    if (page === MAX_PAGES && meta.hasMore) {
      // Silent truncation is the current behavior and it corrupts audit
      // verification — surface it loudly instead. We still return the
      // partial rows (no error thrown) to preserve existing callers'
      // control flow; callers that need completeness must paginate
      // themselves or raise MAX_PAGES.
      if (!truncationWarned.has(table)) {
        truncationWarned.add(table);
        console.warn(
          `[kr8kan/db] ncb listRows truncated at MAX_PAGES=${MAX_PAGES} (${MAX_PAGES * PAGE_LIMIT} rows) for table "${table}" — more rows exist (hasMore=true). Partial data returned.`,
        );
      }
    }
  }
  return rows;
}

export async function createRow(
  cfg: NcbConfig,
  table: string,
  data: DbRow,
): Promise<number> {
  const json = await request(cfg, "POST", `create/${table}`, undefined, data);
  const id = Number(json.id);
  if (!Number.isFinite(id)) {
    throw new NcbError(`NCB create/${table} returned no id`, 0, table);
  }
  return id;
}

export async function updateRow(
  cfg: NcbConfig,
  table: string,
  id: number,
  data: DbRow,
): Promise<void> {
  await request(cfg, "PUT", `update/${table}/${id}`, undefined, data);
}

export async function deleteRow(
  cfg: NcbConfig,
  table: string,
  id: number,
): Promise<void> {
  await request(cfg, "DELETE", `delete/${table}/${id}`);
}
