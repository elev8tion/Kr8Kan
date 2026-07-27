# NoCodeBackend mirror — `36905_kr8kan_1`

Kr8Kan's 33-table schema mirrored onto NoCodeBackend (MySQL + REST data API).
Auth stays self-hosted Better Auth; NCB is a pure data store. Env vars live in
the repo-root `.env` (`NCB_INSTANCE`, `NCB_SECRET_KEY`, `NCB_*_API_URL`).

## Deviations from the Drizzle/Postgres schema (`packages/db/src/schema/`)

| Postgres | NCB (MySQL) | Why |
|---|---|---|
| `serial id` + `text id` (auth) | `id INT AUTO_INCREMENT` + `auth_id VARCHAR(64)` unique | NCB requires int PK; Better Auth text ids live in `auth_id` |
| pg enums (role, visibility, status, kind) | `VARCHAR` with defaults | no enums; enforced in app code |
| `jsonb` columns | `TEXT` (JSON-serialized) | no JSON type via NCB DDL |
| `boolean` | `TINYINT(1)` (0/1) | MySQL boolean |
| `timestamptz` | `DATETIME` (store UTC) | no tz-aware type |
| `list.index`, `card.index`, etc. | `position` | `index` is reserved in MySQL |
| `workflow.trigger` | `trigger_config` | `trigger` is reserved |
| `apikey.key` | `api_key` | `key` is reserved |
| `attachment.key` | `file_key` | same |
| FK constraints + cascade | none — app-side | soft delete (`deleted_at`) is the pattern anyway |
| `agent_job.patch/result_raw/...` | `MEDIUMTEXT` | 256KB patch cap exceeds TEXT's 64KB |

Swagger/API docs: https://app.nocodebackend.com/swagger?instance=36905_kr8kan_1
Data API shape: `GET/POST /read|create|update|delete/<table>` via server-side
proxy with `Authorization: Bearer $NCB_SECRET_KEY`. There is no committed
`schema.json` — for the live column map, use the MCP `get_schema` tool
(`mcp__nocodebackend__get_schema`) against instance `36905_kr8kan_1`, or read
the table specs in `packages/db/src/ncb/tables.ts`, which is the source of
truth checked into the repo.
