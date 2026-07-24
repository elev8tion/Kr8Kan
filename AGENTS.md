# AGENTS.md — Kr8Kan conventions

Kr8Kan is a **self-host only** kanban app (Kan-style architecture, rebranded).
No Stripe, no billing, no cloud product mode. If guidance here conflicts with
upstream Kan docs, **this file and RECREATION-PROMPT.md win**.

## Stack

- pnpm 9 workspaces + Turborepo; TypeScript everywhere
- Next.js 15 **Pages Router** (`apps/web`), React 18, Tailwind 3 + `--kr8-*` tokens
- tRPC 11 + SuperJSON + Zod; REST via trpc-to-openapi under `/api/v1`
- Drizzle ORM → Postgres (`POSTGRES_URL`) or embedded **PGLite** when unset
- better-auth (magic link, credentials, API keys) — **no stripe plugin**
- pino logging to stdout (`LOG_FILE` optional). No Axiom, no Novu.

## Layering

```
schema (packages/db/src/schema)
  → repository (packages/db/src/repository)   # all SQL lives here
    → tRPC router (packages/api/src/routers)  # authz + zod + orchestration
      → Next pages/views (apps/web/src)       # UI only, talks tRPC
```

Conventions:

- Every URL-addressable entity has a 12-char `publicId` (`generateUID`); serial
  ids never leave the db layer.
- Soft delete via `deletedAt`; repositories filter `isNull(deletedAt)`.
- Every card mutation records a `card_activity` row.
- Authz = `assertPermission(db, userId, workspaceId, permission)`; roles
  admin/member/guest in `@kr8kan/shared`. **Never** gate on plan — plan is
  always `selfhost`.

## Dedicated ports

| Service  | Host port | Env override          |
| -------- | --------- | --------------------- |
| web      | **3310**  | `KR8KAN_WEB_PORT`     |
| docs     | 3311      | `KR8KAN_DOCS_PORT`    |
| postgres | 5433      | `KR8KAN_POSTGRES_PORT`|
| redis    | 6380      | `KR8KAN_REDIS_PORT`   |

`pnpm dev` serves on **3310**. Never hardcode 3000/5432 — other local stacks
own those.

## Pi workers (AI)

- Runtime is the operator's global `~/.pi` agent layer (`PI_BIN`,
  `PI_AGENT_HOME`). Kr8Kan ships **no** AI vendor.
- Invocation: `pi --print --no-session --mode text [--no-tools] --system-prompt … "context"`
  (see `packages/agents/src/runner.ts`).
- Workers get structured JSON context (board/card subsets), never secrets:
  `scrubEnv` strips Kr8Kan secrets from env, `redactForModel` scrubs prompt
  payloads, and tools stay disabled unless `KR8KAN_PI_ALLOW_TOOLS=true`.
- Jobs are file-backed under `.kr8kan/jobs/<id>.json` (gitignored). Job dir is
  confined to the workspace root.
- Add a worker: prompt file in `packages/agents/src/prompts/`, entry in
  `registry.ts`. Do not invent a second agent framework.
- **Dev agents in real folders** (`dev-task` worker): a board can be linked to
  a local project folder (Board settings → Project folder). The worker then
  runs pi WITH tools inside that folder, taking the card as its task, and
  reports What I did / How to verify. Requires BOTH
  `KR8KAN_PI_ALLOW_TOOLS=true` and the folder being inside
  `KR8KAN_PI_PROJECT_ROOTS` (colon-separated allowlist; unset = deny all).
  Tool runs get a longer timeout (`KR8KAN_PI_TOOL_TIMEOUT_MS`, default 15 min).
- Runner quirk: the installed pi CLI does not exit after `--print` (a child
  keeps stdio open), so the runner uses `--mode json`, finalizes on the
  `agent_settled` event, and SIGKILLs the process itself. Don't "simplify"
  this back to text mode.

## Safety rails

- Never commit `.env` or write secrets into the repo.
- Never send `BETTER_AUTH_SECRET`, SMTP/S3 credentials, or API keys to models.
- Job artifacts stay under `/Users/kc/kr8kan/.kr8kan/`.

## Commands

| Goal      | Command                                             |
| --------- | --------------------------------------------------- |
| Dev       | `pnpm dev` → http://localhost:3310                  |
| Migrate   | `pnpm db:migrate` (works for Postgres **and** PGLite) |
| Typecheck | `pnpm typecheck`                                    |
| Tests     | `pnpm test`                                         |
| Worker    | `pnpm agents:worker -- --worker=summarize-board --board=<publicId>` |
