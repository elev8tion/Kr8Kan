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

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.secretKey}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (res.status >= 500) {
        lastErr = new NcbError(`NCB ${res.status}: ${text.slice(0, 200)}`, res.status);
        continue; // retry transient server errors
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

/** Read all rows matching equality filters, walking pagination. */
export async function listRows(
  cfg: NcbConfig,
  table: string,
  filters: Record<string, DbValue> = {},
  limit?: number,
): Promise<DbRow[]> {
  const query: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v === null || v === undefined) continue; // null filters unsupported — gateway filters client-side
    query[k] = v;
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
