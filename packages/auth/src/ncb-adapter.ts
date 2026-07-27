import type { CleanedWhere } from "better-auth/adapters";
import { createAdapterFactory } from "better-auth/adapters";

import type { Database } from "@kr8kan/db";

/**
 * Better Auth adapter over the NoCodeBackend gateway.
 *
 * Better Auth generates text ids; the gateway's auth-table specs map the
 * js `id` onto the `auth_id` column (NCB's int PK stays internal as
 * `_rowId`). Dates/booleans/JSON are converted by the gateway, so the
 * factory is told the backend supports them natively.
 *
 * The NCB data API only filters by equality, so: eq/AND clauses go to
 * the server, everything else (ne/lt/gte/in/contains/OR...) is applied
 * client-side. Auth tables are small on a self-host box — fine.
 */

const MODELS: Record<string, "user" | "session" | "account" | "verification" | "apikey"> = {
  user: "user",
  session: "session",
  account: "account",
  verification: "verification",
  apikey: "apikey",
};

function tableFor(model: string) {
  const t = MODELS[model];
  if (!t) throw new Error(`ncb-adapter: unknown model "${model}"`);
  return t;
}

function matches(row: Record<string, unknown>, w: CleanedWhere): boolean {
  const v = row[w.field];
  const val = w.value as unknown;
  const num = (x: unknown) =>
    x instanceof Date ? x.getTime() : typeof x === "number" ? x : NaN;
  switch (w.operator) {
    case "eq":
      return v instanceof Date && val instanceof Date
        ? v.getTime() === val.getTime()
        : v === val;
    case "ne":
      return v !== val;
    case "lt":
      return num(v) < num(val);
    case "lte":
      return num(v) <= num(val);
    case "gt":
      return num(v) > num(val);
    case "gte":
      return num(v) >= num(val);
    case "in":
      return Array.isArray(val) && (val as unknown[]).includes(v);
    case "not_in":
      return Array.isArray(val) && !(val as unknown[]).includes(v);
    case "contains":
      return typeof v === "string" && v.includes(String(val));
    case "starts_with":
      return typeof v === "string" && v.startsWith(String(val));
    case "ends_with":
      return typeof v === "string" && v.endsWith(String(val));
    default:
      return false;
  }
}

function applyWhere(
  rows: Record<string, unknown>[],
  where: CleanedWhere[],
): Record<string, unknown>[] {
  if (where.length === 0) return rows;
  const ands = where.filter((w) => w.connector !== "OR");
  const ors = where.filter((w) => w.connector === "OR");
  return rows.filter((row) => {
    const andOk = ands.every((w) => matches(row, w));
    const orOk = ors.length === 0 || ors.some((w) => matches(row, w));
    return andOk && orOk;
  });
}

/** Split where into server-side equality filters and a client-side rest. */
function splitWhere(where: CleanedWhere[]): {
  serverEq: Record<string, unknown>;
  rest: CleanedWhere[];
} {
  const hasOr = where.some((w) => w.connector === "OR");
  if (hasOr) return { serverEq: {}, rest: where };
  const serverEq: Record<string, unknown> = {};
  const rest: CleanedWhere[] = [];
  for (const w of where) {
    if (w.operator === "eq" && w.value !== null && !(w.value instanceof Date)) {
      serverEq[w.field] = w.value;
    } else {
      rest.push(w);
    }
  }
  return { serverEq, rest };
}

export function ncbAdapter(db: Database) {
  return createAdapterFactory({
    config: {
      adapterId: "ncb",
      adapterName: "NoCodeBackend Adapter",
      usePlural: false,
      supportsJSON: true,
      supportsDates: true,
      supportsBooleans: true,
      supportsNumericIds: false,
    },
    adapter: () => {
      async function fetchWhere(model: string, where: CleanedWhere[]) {
        const { serverEq, rest } = splitWhere(where);
        const rows = await db.findMany(tableFor(model), { where: serverEq });
        return applyWhere(rows, rest);
      }

      return {
        create: async ({ model, data }) => {
          const row = await db.insert(tableFor(model), data);
          return row as never;
        },
        findOne: async ({ model, where }) => {
          const rows = await fetchWhere(model, where);
          return (rows[0] ?? null) as never;
        },
        findMany: async ({ model, where, limit, sortBy, offset }) => {
          let rows = await fetchWhere(model, where ?? []);
          if (sortBy) {
            const { field, direction } = sortBy;
            rows = [...rows].sort((a, b) => {
              const av = a[field];
              const bv = b[field];
              const cmp =
                av instanceof Date && bv instanceof Date
                  ? av.getTime() - bv.getTime()
                  : typeof av === "number" && typeof bv === "number"
                    ? av - bv
                    : String(av ?? "") < String(bv ?? "")
                      ? -1
                      : String(av ?? "") > String(bv ?? "")
                        ? 1
                        : 0;
              return direction === "desc" ? -cmp : cmp;
            });
          }
          if (offset) rows = rows.slice(offset);
          if (limit) rows = rows.slice(0, limit);
          return rows as never;
        },
        update: async ({ model, where, update }) => {
          const rows = await fetchWhere(model, where);
          if (rows.length === 0) return null;
          const updated = await db.update(
            tableFor(model),
            db.rowId(rows[0]!),
            { ...(update as Record<string, unknown>), updatedAt: new Date() },
          );
          return (updated ?? null) as never;
        },
        updateMany: async ({ model, where, update }) => {
          const rows = await fetchWhere(model, where);
          for (const row of rows) {
            await db.update(tableFor(model), db.rowId(row), {
              ...(update as Record<string, unknown>),
              updatedAt: new Date(),
            });
          }
          return rows.length;
        },
        delete: async ({ model, where }) => {
          const rows = await fetchWhere(model, where);
          if (rows[0]) await db.hardDelete(tableFor(model), db.rowId(rows[0]));
        },
        deleteMany: async ({ model, where }) => {
          const rows = await fetchWhere(model, where);
          for (const row of rows) {
            await db.hardDelete(tableFor(model), db.rowId(row));
          }
          return rows.length;
        },
        count: async ({ model, where }) => {
          const rows = await fetchWhere(model, where ?? []);
          return rows.length;
        },
      };
    },
  });
}
