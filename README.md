# Kr8Kan

**Self-hosted kanban with local AI workers.** Workspaces → boards → lists →
cards, with members/roles, magic-link or password auth, a tRPC + REST API,
and board/card automation driven by your own [Pi](https://github.com/badlogic/pi-mono)
agent layer (`~/.pi`).

Kr8Kan is a single-operator architecture with a
hard rule: **it is not a SaaS**. No Stripe, no plans, no seats, no trials, no
cloud telemetry. One deployment, yours.

## Quick start (no Docker needed)

```bash
corepack enable && corepack prepare pnpm@9.14.2 --activate
cd /Users/kc/kr8kan

pnpm install
cp .env.example .env        # set BETTER_AUTH_SECRET to something long+random

pnpm db:migrate             # POSTGRES_URL empty → embedded PGLite (.kr8kan/pglite)
pnpm dev                    # → http://localhost:3310
```

Sign up, name a workspace, make a board. Without SMTP configured, magic links
are printed to the server log.

## Quick start (Docker + Postgres)

```bash
cp .env.example .env
# in .env: POSTGRES_URL=postgres://kr8kan:kr8kan@localhost:5433/kr8kan

docker compose up -d postgres     # postgres on localhost:5433
pnpm db:migrate
pnpm dev                          # web on 3310

# or fully containerized:
docker compose up -d              # web on http://localhost:3310

# optional redis (rate limiting):
docker compose --profile redis up -d redis   # localhost:6380
```

## Dedicated ports — parallel-dev friendly

Kr8Kan deliberately avoids 3000/3001/5432/6379 so it never fights your other
local projects. Override via env if anything still collides:

| Service  | Default host port | Env                    |
| -------- | ----------------- | ---------------------- |
| web      | **3310**          | `KR8KAN_WEB_PORT`      |
| docs     | 3311              | `KR8KAN_DOCS_PORT`     |
| postgres | 5433              | `KR8KAN_POSTGRES_PORT` |
| redis    | 6380              | `KR8KAN_REDIS_PORT`    |

## Environment

Only these are required to boot:

| Var | Value |
| --- | --- |
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:3310` |
| `BETTER_AUTH_SECRET`   | long random string |
| `POSTGRES_URL`         | Postgres URL, or **empty** for embedded PGLite |
| `NEXT_PUBLIC_ALLOW_CREDENTIALS` | `true` (email+password on a private box) |

Optional groups (see `.env.example`): SMTP (`SMTP_*`, `EMAIL_FROM`),
S3-compatible storage (`S3_*`), Redis (`REDIS_URL`), social/OIDC login pairs,
domain allowlist / sign-up lock, `KR8KAN_ADMIN_API_KEY`.

## Pi AI workers

Kr8Kan treats your global **Pi** install as its AI runtime — models, providers,
and skills come from `~/.pi`, not from a vendor baked into this app.

```bash
# .env
KR8KAN_PI_WORKERS_ENABLED=true
PI_BIN=pi                    # or absolute path
PI_AGENT_HOME=/Users/kc/.pi
```

Workers: `summarize-board`, `draft-card`, `triage-card`, `breakdown-card`,
`standup`, `dev-task`, `custom`. Run them from any board/card (`AI worker`
menu), from Settings → AI workers, or headless:

```bash
pnpm agents:worker -- --worker=summarize-board --board=<boardPublicId>
```

Jobs + results are file-backed under `.kr8kan/jobs/`. Safety: worker processes
get a secret-scrubbed env, prompts are redacted, and pi runs with `--no-tools`
unless you opt in (`KR8KAN_PI_ALLOW_TOOLS=true`).

### Dev agents in your real project folders

Link a board to a folder on your machine (**board → ⚙ Board settings →
Project folder**), then run the **Dev agent** worker from any card on that
board: pi runs *with* its read/bash/edit/write tools inside that folder,
treats the card (title, description, checklist) as the task, does the work,
and reports back *What I did / How to verify*.

Two env switches gate this, both required:

```bash
KR8KAN_PI_ALLOW_TOOLS=true                  # opt in to tool runs
KR8KAN_PI_PROJECT_ROOTS=/Users/kc/code      # colon-separated allowlist of roots
```

Boards can only be linked to folders inside the allowlisted roots; everything
else is denied. Tool runs get a 15-minute timeout
(`KR8KAN_PI_TOOL_TIMEOUT_MS` to change).

## API

- tRPC (used by the UI): `/api/trpc`
- REST (OpenAPI): `/api/v1/*` — spec at http://localhost:3310/api/v1/openapi.json
- Health: http://localhost:3310/api/v1/health
- Auth: create a key in **Settings → API**, send `Authorization: Bearer <key>`
  or `x-api-key: <key>`
- Optional MCP server: `pnpm -F @kr8kan/mcp start` (uses `KR8KAN_BASE_URL` +
  `KR8KAN_API_TOKEN`)

## Commands

| Goal | Command |
| --- | --- |
| Dev web | `pnpm dev` → http://localhost:3310 |
| Build | `pnpm build` |
| Migrate | `pnpm db:migrate` |
| Lint / types | `pnpm lint` / `pnpm typecheck` |
| Tests | `pnpm test` |
| Worker smoke | `pnpm agents:worker -- --worker=summarize-board --board=<publicId>` |

## Explicitly not here

- ❌ Stripe / billing / plans / seats / trials — removed, do not re-add
- ❌ Cloud product mode / marketing homepage
- ❌ Novu, Axiom, PostHog-as-requirement — notifications are SMTP + webhooks,
  logs are pino to stdout
- ❌ Multi-tenant metering

## License

AGPL-3.0 — see [LICENSE](./LICENSE).
