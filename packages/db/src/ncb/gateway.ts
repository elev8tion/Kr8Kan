/**
 * Generic table gateway over the NCB data API. Repositories talk to this
 * instead of Drizzle. Semantics preserved from the Postgres layer:
 *  - rows come back camelCase with Date objects, parsed JSON, booleans
 *  - soft-deleted rows are excluded by default on softDelete tables
 *  - equality `where` goes to the server; null-matching, ordering and
 *    everything richer happens client-side (self-host scale)
 *  - `transaction` is sequential execution — the NCB REST API has no
 *    transactions, and the unique keys guard the invariants that matter
 */
import type { DbRow, DbValue, NcbConfig } from "./http";
import { createRow, deleteRow, listRows, updateRow } from "./http";
import type { TableName, TableSpec } from "./tables";
import { specs } from "./tables";

export type Row = Record<string, unknown>;

export interface FindOptions {
  /** Equality filters, jsNames. `null` values are matched client-side. */
  where?: Record<string, unknown>;
  /** Include soft-deleted rows (default false on softDelete tables). */
  includeDeleted?: boolean;
  /** Only soft-deleted rows. */
  onlyDeleted?: boolean;
  orderBy?: { field: string; dir?: "asc" | "desc" };
  limit?: number;
  /**
   * Forward `limit` (and `orderBy` as sort/order) to NCB server-side
   * instead of fetching every row and slicing client-side. Only safe when
   * client-side filtering cannot remove rows that the server already
   * excluded from the page: no `where` field with a `null` value (those
   * are matched client-side and would be silently under-counted), and on
   * softDelete tables the caller must either pass `includeDeleted: true`
   * or otherwise be aware that a page of `serverLimit` rows may contain
   * fewer non-deleted rows than expected after the client-side
   * soft-delete filter runs. Combining serverLimit with a null-valued
   * where field throws.
   */
  serverLimit?: number;
}

/** Insert read-after-write retry: NCB reads can lag a just-committed
 * write by several seconds, so `insert` gives the read-back a few
 * widening chances (~4s total) before giving up. One entry per retry
 * wait; the first read happens immediately. */
const INSERT_READ_RETRY_DELAYS_MS = [250, 1000, 2750];

/** Ambiguous-create probe waits: a 5xx on POST /create may or may not
 * have committed the row. Before risking a duplicate re-create, probe
 * for the row by its unique business key across ~4s (the documented
 * NCB read lag window). One entry per probe; each probe is preceded by
 * its wait. */
const AMBIGUOUS_CREATE_PROBE_DELAYS_MS = [500, 1500, 2000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const camelToSnake = (s: string) =>
  s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function colName(spec: TableSpec, js: string): string {
  return spec.renames?.[js] ?? camelToSnake(js);
}

function jsNameFor(spec: TableSpec, col: string): string {
  for (const [js, c] of Object.entries(spec.renames ?? {})) {
    if (c === col) return js;
  }
  return col.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Date → MySQL DATETIME string (UTC). */
function toDbDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** MySQL DATETIME string → Date (interpreted as UTC). */
function fromDbDate(s: string): Date {
  return new Date(`${s.replace(" ", "T")}Z`);
}

function toDbValue(spec: TableSpec, js: string, value: unknown): DbValue {
  if (value === null || value === undefined) return null;
  if (spec.date?.includes(js)) {
    return toDbDate(value instanceof Date ? value : new Date(value as string));
  }
  if (spec.bool?.includes(js)) return value ? 1 : 0;
  if (spec.json?.includes(js)) return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return JSON.stringify(value);
}

export function toDb(spec: TableSpec, values: Record<string, unknown>): DbRow {
  const out: DbRow = {};
  for (const [js, v] of Object.entries(values)) {
    if (v === undefined) continue;
    out[colName(spec, js)] = toDbValue(spec, js, v);
  }
  return out;
}

export function fromDb(spec: TableSpec, row: DbRow): Row {
  const out: Row = {};
  // jsNames claimed by renames — a physical column whose default camel
  // name collides with one (e.g. int PK `id` vs `auth_id`→id) is shadowed;
  // the physical PK stays reachable as `_rowId` for update/delete paths.
  const claimed = new Set(Object.keys(spec.renames ?? {}));
  for (const [col, v] of Object.entries(row)) {
    const defaultJs = col.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (claimed.has(defaultJs) && !Object.values(spec.renames ?? {}).includes(col)) {
      if (col === "id") out._rowId = v === null ? null : Number(v);
      continue;
    }
    const js = jsNameFor(spec, col);
    if (v === null || v === undefined) {
      out[js] = null;
    } else if (spec.date?.includes(js)) {
      out[js] = fromDbDate(String(v));
    } else if (spec.bool?.includes(js)) {
      out[js] = Boolean(Number(v));
    } else if (spec.json?.includes(js)) {
      try {
        out[js] = JSON.parse(String(v));
      } catch {
        out[js] = null;
      }
    } else {
      out[js] = v;
    }
  }
  return out;
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
}

export class NcbGateway {
  constructor(private readonly cfg: NcbConfig) {}

  spec(name: TableName): TableSpec {
    return specs[name];
  }

  async findMany(name: TableName, opts: FindOptions = {}): Promise<Row[]> {
    const spec = specs[name];
    const serverFilters: Record<string, DbValue> = {};
    const nullFields: string[] = [];
    for (const [js, v] of Object.entries(opts.where ?? {})) {
      if (v === null) nullFields.push(js);
      else serverFilters[colName(spec, js)] = toDbValue(spec, js, v);
    }
    if (opts.serverLimit !== undefined && nullFields.length > 0) {
      throw new Error(
        `ncb findMany: serverLimit is incompatible with null-valued where fields (${nullFields.join(", ")}) — ` +
          "those matches happen client-side after the server page is fetched, so a server-side limit can " +
          "silently drop rows that would have matched. Remove serverLimit or the null filter(s).",
      );
    }
    let extraQuery: Record<string, string | number> | undefined;
    if (opts.serverLimit !== undefined && opts.orderBy) {
      const { field, dir = "asc" } = opts.orderBy;
      extraQuery = { sort: colName(spec, field), order: dir };
    }
    const raw = await listRows(
      this.cfg,
      spec.table,
      serverFilters,
      opts.serverLimit,
      extraQuery,
    );
    let rows = raw.map((r) => fromDb(spec, r));
    for (const f of nullFields) rows = rows.filter((r) => r[f] === null);
    if (spec.softDelete && !opts.includeDeleted && !opts.onlyDeleted) {
      rows = rows.filter((r) => r.deletedAt === null || r.deletedAt === undefined);
    }
    if (opts.onlyDeleted) {
      rows = rows.filter((r) => r.deletedAt !== null && r.deletedAt !== undefined);
    }
    if (opts.orderBy) {
      const { field, dir = "asc" } = opts.orderBy;
      rows.sort((a, b) =>
        dir === "asc" ? compare(a[field], b[field]) : compare(b[field], a[field]),
      );
    }
    if (opts.limit !== undefined) rows = rows.slice(0, opts.limit);
    return rows;
  }

  async findFirst(name: TableName, opts: FindOptions = {}): Promise<Row | undefined> {
    const rows = await this.findMany(name, opts);
    return rows[0];
  }

  /** Lookup by the physical NCB int PK (bypasses renames — on tables
   * where `id` is renamed, e.g. auth tables, `where: { id }` would hit
   * the text auth_id instead). */
  async findById(name: TableName, id: number): Promise<Row | undefined> {
    const spec = specs[name];
    const raw = await listRows(this.cfg, spec.table, { id }, 1);
    if (raw.length === 0) return undefined;
    return fromDb(spec, raw[0]!);
  }

  /** Physical row id for update/delete: `_rowId` when the jsName `id` is
   * a renamed text id (auth tables), the plain `id` otherwise. */
  rowId(row: Row): number {
    const v = row._rowId ?? row.id;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error("ncb: row has no numeric row id");
    return n;
  }

  /** Unique-business-key equality filter for probing whether an insert
   * landed: the spec's composite `probeKeys` when every key value is
   * present, else the first caller-provided unique string field
   * (publicId; text id / email on auth tables). Undefined when the
   * insert carries no probeable key. */
  private probeWhereFor(
    name: TableName,
    values: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    const spec = specs[name];
    if (spec.probeKeys?.every((k) => values[k] !== undefined && values[k] !== null)) {
      const where: Record<string, unknown> = {};
      for (const k of spec.probeKeys) where[k] = values[k];
      return where;
    }
    const probeField = ["publicId", "id", "email"].find(
      (f) => typeof values[f] === "string",
    );
    return probeField ? { [probeField]: values[probeField] } : undefined;
  }

  /** Whether a probed row is attributable to THIS insert: every plain
   * scalar (string/number outside date/json/bool round-trip territory)
   * we sent must match the row. A caller-generated publicId matches
   * trivially; on composite keys (e.g. auditLog workspace_id+seq) this
   * is what tells our committed row apart from a racing writer that won
   * the same unique slot. */
  private matchesInsert(
    spec: TableSpec,
    sent: Record<string, unknown>,
    row: Row,
  ): boolean {
    for (const [js, v] of Object.entries(sent)) {
      if (typeof v !== "string" && typeof v !== "number") continue;
      if (spec.date?.includes(js) || spec.json?.includes(js) || spec.bool?.includes(js))
        continue;
      const got = row[js];
      if (got === v) continue;
      // NCB can hand numeric columns back as strings (rowId() already
      // compensates elsewhere) — compare numbers loosely.
      if (typeof v === "number" && got != null && Number(got) === v) continue;
      return false;
    }
    return true;
  }

  /**
   * Insert and return the created row. Invariant: a returned row is
   * always one that was read back from NCB and attributed to this
   * insert — an unconfirmable insert throws, it never fabricates
   * success. Ambiguous failures (5xx create) are resolved by probing
   * the unique business key across the read-lag window before a single
   * bounded re-create.
   */
  async insert(name: TableName, values: Record<string, unknown>): Promise<Row> {
    const spec = specs[name];
    const withDefaults: Record<string, unknown> = { ...values };
    for (const js of spec.autoNow ?? []) {
      if (withDefaults[js] === undefined) withDefaults[js] = new Date();
    }
    const body = toDb(spec, withDefaults);
    const probeWhere = this.probeWhereFor(name, withDefaults);
    let id: number;
    try {
      id = await createRow(this.cfg, spec.table, body);
    } catch (err) {
      // NCB 5xx on create is ambiguous: the row may or may not have
      // committed, and blind retry risks duplicates. Nearly every insert
      // carries a unique business key — probe for the row across the
      // multi-second read-lag window, and only re-create when the probes
      // prove the first attempt never landed.
      if (!probeWhere) throw err;
      let found: Row | undefined;
      for (const delayMs of AMBIGUOUS_CREATE_PROBE_DELAYS_MS) {
        await sleep(delayMs);
        found = await this.findFirst(name, {
          where: probeWhere,
          includeDeleted: true,
        });
        if (found) break;
      }
      if (found) {
        if (this.matchesInsert(spec, withDefaults, found)) return found;
        // The unique slot is held by a DIFFERENT row (racing writer won),
        // so our create definitively failed — surface the original error
        // rather than return someone else's row.
        throw err;
      }
      id = await createRow(this.cfg, spec.table, body);
    }
    // Read-back verification: NCB reads can lag a just-committed write
    // (update() already compensates on the read-after-patch path); give
    // the read widening chances across the lag window. findById is the
    // cheap primary; the unique-key probe is the fallback in case the
    // NCB-returned numeric id does not read back (id/read mismatch).
    let row: Row | undefined;
    for (let attempt = 0; ; attempt++) {
      // A row fetched by the create-returned id IS our row — no content
      // match needed (server-side normalization like VARCHAR truncation
      // must not turn a landed insert into a thrown error). matchesInsert
      // only guards the unique-key probe fallback, where attribution is
      // genuinely uncertain.
      row = await this.findById(name, id);
      if (row) break;
      if (probeWhere) {
        row = await this.findFirst(name, {
          where: probeWhere,
          includeDeleted: true,
        });
        if (row && !this.matchesInsert(spec, withDefaults, row)) {
          row = undefined; // not our row — keep retrying, never misattribute
        }
        if (row) break;
      }
      if (attempt >= INSERT_READ_RETRY_DELAYS_MS.length) break;
      await sleep(INSERT_READ_RETRY_DELAYS_MS[attempt]!);
    }
    if (!row) throw new Error(`ncb: created ${spec.table} row ${id} not readable`);
    return row;
  }

  /** Update by NCB numeric id and return the fresh row. */
  async update(
    name: TableName,
    id: number,
    patch: Record<string, unknown>,
  ): Promise<Row | undefined> {
    const spec = specs[name];
    const body = toDb(spec, patch);
    // explicit nulls must be sent to clear columns
    for (const [js, v] of Object.entries(patch)) {
      if (v === null) body[colName(spec, js)] = null;
    }
    if (Object.keys(body).length > 0) {
      await updateRow(this.cfg, spec.table, id, body);
    }
    const fresh = await this.findById(name, id);
    if (!fresh) return undefined;
    // NCB reads can lag a just-committed update; overlay the patch (run
    // through the serialization round-trip so types match a real read).
    const overlay = fromDb(spec, body);
    return { ...fresh, ...overlay };
  }

  /** Update every row matching `where`; returns updated rows. */
  async updateWhere(
    name: TableName,
    where: Record<string, unknown>,
    patch: Record<string, unknown>,
    opts: { includeDeleted?: boolean } = {},
  ): Promise<Row[]> {
    const rows = await this.findMany(name, {
      where,
      includeDeleted: opts.includeDeleted ?? true,
    });
    const out: Row[] = [];
    for (const row of rows) {
      const updated = await this.update(name, this.rowId(row), patch);
      if (updated) out.push(updated);
    }
    return out;
  }

  async softDelete(name: TableName, id: number): Promise<void> {
    await this.update(name, id, { deletedAt: new Date() });
  }

  async hardDelete(name: TableName, id: number): Promise<void> {
    const spec = specs[name];
    await deleteRow(this.cfg, spec.table, id);
  }

  async hardDeleteWhere(
    name: TableName,
    where: Record<string, unknown>,
  ): Promise<number> {
    const rows = await this.findMany(name, { where, includeDeleted: true });
    for (const row of rows) await this.hardDelete(name, this.rowId(row));
    return rows.length;
  }

  /**
   * Insert unless a row with the same `conflictKeys` values exists
   * (replacement for Postgres onConflictDoNothing). Returns the existing
   * row or the new one; `created` distinguishes them.
   */
  async insertIfAbsent(
    name: TableName,
    values: Record<string, unknown>,
    conflictKeys: string[],
  ): Promise<{ row: Row; created: boolean }> {
    const where: Record<string, unknown> = {};
    for (const k of conflictKeys) where[k] = values[k];
    const existing = await this.findFirst(name, { where, includeDeleted: true });
    if (existing) return { row: existing, created: false };
    return { row: await this.insert(name, values), created: true };
  }

  /**
   * Sequential pseudo-transaction. NCB has no multi-statement atomicity;
   * callers get best-effort ordering, and DB unique keys keep the
   * critical invariants (publicId, audit seq) safe under races.
   */
  async transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

export function createGatewayFromEnv(): NcbGateway {
  const instance = process.env.NCB_INSTANCE;
  const secretKey = process.env.NCB_SECRET_KEY;
  const dataApiUrl =
    process.env.NCB_DATA_API_URL ?? "https://app.nocodebackend.com/api/data";
  if (!instance || !secretKey) {
    throw new Error(
      "[kr8kan/db] NCB_INSTANCE and NCB_SECRET_KEY must be set (repo-root .env) — the NoCodeBackend data store is the only backend",
    );
  }
  return new NcbGateway({ instance, secretKey, dataApiUrl });
}
