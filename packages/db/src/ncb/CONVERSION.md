# Repository conversion contract (Drizzle → NCB gateway)

Convert repository files in `packages/db/src/repository/` from Drizzle
queries to the NCB gateway. HARD RULES:

1. **Exported function names, parameters, and return SHAPES must not change.**
   `packages/api` depends on them exactly as-is (camelCase fields, `Date`
   objects, nested relation objects identical to the old drizzle `with:`
   shapes, `undefined` for not-found from findFirst-style getters).
2. `db: Database` is now the NCB gateway (`import type { Database } from "../client"`).
   Call methods ON the passed `db`, never import a singleton.
3. Keep Row types derived from the Drizzle schema (`typeof cards.$inferSelect`)
   — the schema files still exist as the type source. Cast gateway results:
   `const row = (await db.findFirst(...)) as CardRow | undefined;`
4. Table names for the gateway are the Drizzle export names (keys of `T` in
   `packages/db/src/ncb/tables.ts`): `"workspaces"`, `"cards"`, `"lists"`,
   `"activities"`, `"auditLog"`, `"user"`, etc. Field names in `where`/
   `orderBy`/values are the **camelCase js names** (`publicId`, `listId`,
   `index`, `dueDate`, `trigger`, `key`) — the gateway maps renames
   (index→position, trigger→trigger_config, key→file_key/api_key,
   user id→auth_id) and converts Dates/booleans/JSON automatically.

## Gateway API (class NcbGateway)

```ts
db.findMany(name, { where?, includeDeleted?, onlyDeleted?, orderBy?: {field, dir?}, limit? }) → Row[]
db.findFirst(name, opts) → Row | undefined
db.findById(name, id) → Row | undefined            // includes deleted
db.insert(name, values) → Row                       // fills createdAt/updatedAt automatically
db.update(name, id, patch) → Row | undefined        // pass null to clear a column
db.updateWhere(name, where, patch, {includeDeleted?}) → Row[]   // default includes deleted
db.softDelete(name, id)                             // sets deletedAt=now
db.hardDelete(name, id)
db.hardDeleteWhere(name, where) → count
db.insertIfAbsent(name, values, conflictKeys) → {row, created}  // replaces onConflictDoNothing
db.transaction(fn) → fn(db)                         // sequential, NOT atomic
```

`where` supports equality only, including `null` (matched client-side).
`findMany`/`findFirst` exclude soft-deleted rows by default on tables with
`deleted_at`; pass `includeDeleted: true` for the drizzle queries that did
NOT filter `isNull(deletedAt)` (e.g. `findFirst({ where: eq(id) })` alone),
and `onlyDeleted: true` for `isNotNull(deletedAt)` queries.

## Translation patterns

- `isNull(t.deletedAt)` in where → default behavior (omit).
- No `isNull` filter present → add `includeDeleted: true`.
- `orderBy: asc(t.index)` → `orderBy: { field: "index" }`;
  `desc(x)` → `{ field: "x", dir: "desc" }`.
- Range predicates (`gt`, `lte` on dates) → fetch then filter in JS
  (self-host scale; the old code already JS-filters heavily).
- `with: { relation: true }` → separate `findMany` on the related table
  filtered by the FK, then attach: build lookup `Map`s and nest objects so
  the returned shape matches the old drizzle result exactly (including
  nested `list.board.workspace` chains). Batch: collect ids, fetch each
  related table ONCE with no server filter when multiple ids are needed
  (equality-only API — no IN), then join in JS.
- `.onConflictDoNothing()` → `insertIfAbsent(name, values, [...keys])`.
- `db.transaction(async tx => ...)` → `db.transaction(async (tx) => ...)`
  (sequential; keep the code inside identical where possible).
- `.returning()` → gateway insert/update already return the fresh row.
- `new Date()` timestamps for updatedAt: keep passing them in patches.

## Nullability

Gateway rows use `null` (never `undefined`) for empty columns, matching
drizzle. Not-found single-row lookups return `undefined`, matching drizzle.
