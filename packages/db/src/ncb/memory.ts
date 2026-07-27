/**
 * In-memory NcbGateway for tests: same public API, same serialization
 * round-trip (rows are stored as serialized DbRows and re-hydrated via
 * fromDb, so DATETIME second-precision and JSON-as-text behave exactly
 * like the live NCB instance). Tests can reach into `raw(table)` to
 * tamper with stored rows the way SQL used to.
 */
import { getTableColumns } from "drizzle-orm";

import type { DbRow } from "./http";
import type { FindOptions, Row } from "./gateway";
import { fromDb, toDb } from "./gateway";
import type { TableName, TableSpec } from "./tables";
import { specs } from "./tables";
import * as schema from "../schema";

const camelToSnake = (s: string) =>
  s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Physical column list per table, derived from the Drizzle schema (the
 * type source of truth) — real NCB reads return every column, nulls
 * included, so inserts here materialize the full set too. */
function physicalColumns(name: TableName): string[] {
  const spec = specs[name];
  const table = (schema as Record<string, unknown>)[name];
  if (!table) return [];
  const jsNames = Object.keys(getTableColumns(table as never));
  return jsNames.map((js) => spec.renames?.[js] ?? camelToSnake(js));
}

/** Unique keys enforced in memory — the ones repo logic relies on. */
const UNIQUE_KEYS: Partial<Record<TableName, string[][]>> = {
  auditLog: [["workspace_id", "seq"]],
  workspaces: [["public_id"], ["slug"]],
  cardLabels: [["card_id", "label_id"]],
  cardMembers: [["card_id", "member_id"]],
  commentReactions: [["comment_id", "emoji", "user_id"]],
  messageReactions: [["message_id", "emoji", "user_id"]],
  agentIdentities: [["workspace_id", "worker_name"]],
};

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
}

export class MemoryGateway {
  private stores = new Map<string, Map<number, DbRow>>();
  private counters = new Map<string, number>();

  spec(name: TableName): TableSpec {
    return specs[name];
  }

  /** Raw serialized rows for a physical table — test tampering hook. */
  raw(table: string): Map<number, DbRow> {
    if (!this.stores.has(table)) this.stores.set(table, new Map());
    return this.stores.get(table)!;
  }

  private hydrate(name: TableName): Row[] {
    const spec = specs[name];
    return [...this.raw(spec.table).values()].map((r) => fromDb(spec, r));
  }

  async findMany(name: TableName, opts: FindOptions = {}): Promise<Row[]> {
    const spec = specs[name];
    let rows = this.hydrate(name);
    for (const [js, v] of Object.entries(opts.where ?? {})) {
      rows = rows.filter((r) => {
        const rv = r[js];
        if (v === null) return rv === null;
        if (rv instanceof Date) {
          const other = v instanceof Date ? v : new Date(String(v));
          return rv.getTime() === other.getTime();
        }
        return rv === v;
      });
    }
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

  async findFirst(
    name: TableName,
    opts: FindOptions = {},
  ): Promise<Row | undefined> {
    return (await this.findMany(name, opts))[0];
  }

  async findById(name: TableName, id: number): Promise<Row | undefined> {
    const spec = specs[name];
    const raw = this.raw(spec.table).get(id);
    return raw ? fromDb(spec, raw) : undefined;
  }

  rowId(row: Row): number {
    const v = row._rowId ?? row.id;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error("memory: row has no numeric row id");
    return n;
  }

  private assertUnique(name: TableName, body: DbRow, ignoreId?: number): void {
    const keys = UNIQUE_KEYS[name];
    if (!keys) return;
    const spec = specs[name];
    for (const cols of keys) {
      if (!cols.every((c) => body[c] !== undefined && body[c] !== null)) continue;
      for (const [id, existing] of this.raw(spec.table)) {
        if (id === ignoreId) continue;
        if (cols.every((c) => existing[c] === body[c])) {
          throw new Error(
            `memory: duplicate key on ${spec.table} (${cols.join(",")})`,
          );
        }
      }
    }
  }

  async insert(name: TableName, values: Record<string, unknown>): Promise<Row> {
    const spec = specs[name];
    const withDefaults: Record<string, unknown> = { ...values };
    for (const js of spec.autoNow ?? []) {
      if (withDefaults[js] === undefined) withDefaults[js] = new Date();
    }
    const body = toDb(spec, withDefaults);
    this.assertUnique(name, body);
    const id = (this.counters.get(spec.table) ?? 0) + 1;
    this.counters.set(spec.table, id);
    const base: DbRow = {};
    for (const col of physicalColumns(name)) base[col] = null;
    this.raw(spec.table).set(id, { ...base, ...body, id });
    return (await this.findById(name, id))!;
  }

  async update(
    name: TableName,
    id: number,
    patch: Record<string, unknown>,
  ): Promise<Row | undefined> {
    const spec = specs[name];
    const existing = this.raw(spec.table).get(id);
    if (!existing) return undefined;
    const body = toDb(spec, patch);
    for (const [js, v] of Object.entries(patch)) {
      if (v === null) {
        const col = spec.renames?.[js] ?? js.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
        body[col] = null;
      }
    }
    const merged = { ...existing, ...body, id };
    this.assertUnique(name, merged, id);
    this.raw(spec.table).set(id, merged);
    return this.findById(name, id);
  }

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
    this.raw(spec.table).delete(id);
  }

  async hardDeleteWhere(
    name: TableName,
    where: Record<string, unknown>,
  ): Promise<number> {
    const rows = await this.findMany(name, { where, includeDeleted: true });
    for (const row of rows) await this.hardDelete(name, this.rowId(row));
    return rows.length;
  }

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

  async transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

/** Typed as the production Database for handing to repositories. */
export function createMemoryDb(): MemoryGateway {
  return new MemoryGateway();
}
