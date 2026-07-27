# Recreation Prompt: Kr8Kan (v3 — frontend + mobile)

Build **Kr8Kan** — a **self-hosted-only**, single-operator rebrand of the open-source
Kan (Trello-style) kanban app. Target workspace:

```
/Users/kc/kr8kan
```

This prompt is self-contained. A coding agent should implement **only** what is
specified here. **Intentional divergences from upstream Kan are required** (see
§h and §i). Do not reintroduce SaaS/cloud/billing features.

**Brand**: Kr8Kan (display name). Package/scope names may use `@kr8kan/*`.
**Prompt version**: 3 — adds design system, visual polish, mobile-first responsive UI (§d2).
**Origin fidelity**: architecture, domain model, tRPC+Drizzle patterns from Kan;
product mode is **local self-host forever**, not multi-tenant SaaS.

---

## (a) Project Overview

### What to build
A monorepo web application **Kr8Kan** that runs entirely on the operator’s machine
(or their private server) with:

- Workspaces, boards, lists, cards (kanban core)
- Members/roles/permissions (for multi-user **on one self-hosted instance**, not
  cloud multi-tenancy billing)
- Magic-link and/or credentials auth via Better Auth (**no Stripe, no cloud plans**)
- tRPC + OpenAPI REST API
- Local `pnpm dev` with **dedicated fixed ports** so Kr8Kan
  never collides with other local projects
- **Pi agent integration**: AI “workers” driven by the operator’s global `~/.pi`
  agent layer (subagents/quests/skills) for board/card automation — not a SaaS AI
  vendor lock-in
- Optional S3-compatible storage, SMTP, Redis (all optional for boot)
- Optional MCP tools that talk to **local** Kr8Kan REST API
- **Polished, mobile-responsive UI** with a cohesive design system (tokens, dark/light),
  touch-safe board interactions, bottom navigation on small screens, and elevated
  visual hierarchy (see §d2)
- Docs app optional (self-hosting only; no marketing/pricing site)

### Primary users
- **You (solo / small private team)** self-hosting on localhost or a private VPS
- Other local dev stacks run in parallel without port fights

### Non-goals (hard)
- **No Stripe / billing / plans / seats / trials / partner licenses**
- **No `NEXT_PUBLIC_KAN_ENV=cloud` product mode**, no cloud marketing home, no
  PostHog/Umami/Axiom as required paths (optional analytics only if you add later)
- **No Novu cloud notification product** as a dependency (use SMTP + optional local hooks)
- **No Railway “deploy SaaS” template** as a first-class path (plain self-host OK)
- **No multi-tenant SaaS metering**
- Do not invent mobile apps, sprints/epics, or features not in the domain model

### Intentional rebrand deltas from Kan
| Upstream Kan | Kr8Kan |
|--------------|--------|
| Name Kan / @kan/* | Kr8Kan / @kr8kan/* |
| Cloud + self-host dual mode | Self-host only |
| Stripe + better-auth stripe plugin | **Removed** |
| Novu / Discord cloud notify | SMTP + optional local webhook hooks |
| Axiom cloud logs | pino to stdout/file only |
| Port 3000 default | **Dedicated ports** (see §g) |
| No AI workers | **Pi agent workers** via `~/.pi` |
| Target any clone path | **Build in `/Users/kc/kr8kan`** |

---

## (b) Tech Stack & Versions

Same core stack as analyzed Kan, **minus SaaS packages**:

| Area | Choice | Version / notes |
|------|--------|-----------------|
| Runtime | Node.js | ≥ 20.18.1 (`.nvmrc` = 20.18) |
| Package manager | pnpm | 9.14.2 |
| Monorepo | pnpm workspaces + Turborepo | turbo ^2.3.1 |
| Language | TypeScript | ^5.6.3 |
| Web | Next.js **Pages Router** | 15.5.9 |
| UI | React 18.3.1, Tailwind 3.4, Headless UI | |
| API | tRPC 11 + SuperJSON + Zod | |
| ORM | Drizzle + drizzle-kit | ^0.42 / ^0.28 |
| DB | PostgreSQL 15 (external) or PGLite fallback | |
| Auth | better-auth ^1.4.6 | **No `@better-auth/stripe`** |
| Redis | ioredis optional | rate limit |
| Email | react-email + nodemailer | SMTP only |
| Storage | AWS S3 SDK optional | MinIO/local S3 OK |
| OpenAPI | trpc-to-openapi | |
| i18n | Lingui 5 | English first |
| Editor | TipTap | |
| DnD | react-beautiful-dnd | |
| Logging | pino | no Axiom required |
| Env | @t3-oss/env-nextjs + next-runtime-env | |
| Tests | vitest | |
| AI workers | **Pi** (`~/.pi` agent, subagents, quests, skills) | see §d Pi integration |
| MCP (optional) | @modelcontextprotocol/sdk | points at local REST |

**Removed packages vs Kan**:
- `packages/stripe` — **do not create**
- `@better-auth/stripe`, `stripe` npm dep — **do not add**
- Cloud-only Novu as hard dependency — optional stub only if needed for compile; prefer delete call sites
- Partner license flows — delete

**pnpm workspace**:
```yaml
packages:
  - apps/*
  - packages/*
  - tooling/*
catalog:
  "@tanstack/react-query": ^5.59.15
  "@trpc/client": ^11.4.3
  "@trpc/react-query": ^11.4.3
  "@trpc/server": ^11.4.3
  eslint: ^9.12.0
  prettier: ^3.3.3
  tailwindcss: ^3.4.14
  typescript: ^5.6.3
  zod: ^3.23.8
catalogs:
  react18:
    react: 18.3.1
    react-dom: 18.3.1
    "@types/react": ^18.3.11
    "@types/react-dom": ^18.3.1
```

`.npmrc` (same hoist settings as Kan):
```
node-linker=hoisted
link-workspace-packages=true
shamefully-hoist=true
hoist=true
```

---

## (c) Complete Directory Tree

Root: `/Users/kc/kr8kan`

Create monorepo structure below. Rename `@kan/*` → `@kr8kan/*` and `apps/web`
branding strings to Kr8Kan. **Omit** SaaS-only paths.

```
kr8kan/
├── .github/                          # optional CI
├── .vscode/
├── apps/
│   ├── docs/                         # optional Mintlify self-host docs only
│   └── web/                          # Next.js product
│       ├── next.config.js
│       ├── package.json
│       ├── lingui.config.ts
│       ├── tailwind.config.ts
│       ├── postcss.config.cjs
│       ├── tsconfig.json
│       ├── public/
│       └── src/
│           ├── env.ts
│           ├── middleware.ts
│           ├── pages/                # Pages Router
│           │   ├── _app.tsx
│           │   ├── index.tsx         # → redirect /boards or /login (no marketing SaaS home)
│           │   ├── login/
│           │   ├── signup/
│           │   ├── boards/
│           │   ├── cards/
│           │   ├── members/
│           │   ├── templates/
│           │   ├── settings/         # account, api, integrations, permissions, webhooks, workspace
│           │   │                     # NO billing settings page
│           │   ├── onboarding/
│           │   ├── invite/
│           │   ├── api/
│           │   │   ├── auth/[...all].ts
│           │   │   ├── trpc/[trpc].ts
│           │   │   ├── v1/[...trpc].ts
│           │   │   ├── v1/openapi.json.ts
│           │   │   ├── upload/
│           │   │   ├── download/
│           │   │   ├── trello/       # optional import
│           │   │   ├── agents/       # NEW: Pi worker HTTP bridge
│           │   │   │   ├── run.ts
│           │   │   │   ├── status.ts
│           │   │   │   └── health.ts
│           │   │   └── unsubscribe.ts  # optional
│           │   └── [workspaceSlug]/
│           ├── views/                # thick UI (board, card, settings, …)
│           ├── components/           # + BottomTabBar, MobileSheet, FAB, EmptyState, Skeleton, WorkerRunner
│           ├── hooks/                # + useIsMobile
│           ├── providers/
│           ├── styles/               # globals.css design tokens + safe-area
│           ├── utils/                # api.ts tRPC client, helpers, i18n
│           ├── locales/
│           ├── server/
│           │   └── pi/               # NEW: Pi worker adapter
│           │       ├── client.ts
│           │       ├── workers.ts
│           │       └── types.ts
│           └── styles/
├── packages/
│   ├── api/                          # @kr8kan/api — tRPC routers (no stripe usage)
│   ├── auth/                         # @kr8kan/auth — better-auth WITHOUT stripe plugin
│   ├── db/                           # @kr8kan/db — schema, repos, redis, migrations
│   ├── shared/                       # @kr8kan/shared — permissions, UID, s3 utils
│   ├── email/                        # @kr8kan/email — SMTP templates only
│   ├── logger/                       # @kr8kan/logger — pino only
│   ├── mcp/                          # @kr8kan/mcp — optional local MCP
│   └── agents/                       # NEW @kr8kan/agents — Pi worker orchestration
│       ├── package.json
│       ├── src/
│       │   ├── index.ts
│       │   ├── registry.ts           # worker types: summarize-board, draft-card, triage, …
│       │   ├── runner.ts             # invoke pi CLI / session API
│       │   ├── prompts/              # system prompts per worker
│       │   └── safety.ts             # path allowlist, no secrets to model
│       └── tsconfig.json
├── tooling/                          # eslint, prettier, tailwind, typescript
├── turbo/
├── scripts/
│   ├── dev.sh                        # starts stack on dedicated ports
│   └── pi-worker.sh                  # helper to call pi non-interactively
├── .env.example
├── .nvmrc
├── .npmrc
├── .gitignore
├── AGENTS.md                         # Kr8Kan + Pi worker conventions
├── README.md
├── CONTRIBUTING.md
├── LICENSE                           # AGPL-3.0 or your choice; state clearly
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

**Do not create**:
- `packages/stripe/`
- `apps/web/src/pages/settings/billing.tsx` or pricing/upgrade SaaS pages
- Stripe webhook/checkout API routes
- Partner activate SaaS routes (unless you later refine)

**Reference tree density**: upstream Kan had ~476 catalogued source files. Kr8Kan
should be similar in board/card UI surface, **minus** billing/cloud/marketing and
**plus** `packages/agents` + `api/agents/*` + `server/pi/*`.

---

## (d) File-by-File Build Instructions

### Root package.json
- `name`: `kr8kan`, private, engines node≥20.18.1, packageManager pnpm@9.14.2
- Scripts: `build`, `dev`, `dev:next`, `db:migrate`, `db:push`, `db:studio`,
  `lint`, `format:fix`, `typecheck`, `agents:worker` (runs pi worker helper)
- **No** stripe-related env in turbo globalEnv

### turbo.json
- Same task graph as Kan (build/dev/lint/typecheck/…)
- `globalEnv`: self-host set only (see §f) — **exclude** all `STRIPE_*`,
  `AXIOM_*`, `NOVU_*`, `NEXT_PUBLIC_KAN_ENV`, partner vars
- Add: `KR8KAN_WEB_PORT`, `KR8KAN_DOCS_PORT`, `KR8KAN_POSTGRES_PORT`,
  `KR8KAN_REDIS_PORT`, `PI_BIN`, `PI_AGENT_HOME`, `KR8KAN_PI_WORKERS_ENABLED`

### Dedicated ports
Bind **host ports that avoid common 3000/5432 clashes**:

| Service | Host port (default) | Env override |
|---------|---------------------|--------------|
| web | **3310** | `KR8KAN_WEB_PORT` |
| postgres (external, optional) | **5433** | `KR8KAN_POSTGRES_PORT` |
| redis (external, optional) | **6380** | `KR8KAN_REDIS_PORT` |
| docs (optional) | **3311** | `KR8KAN_DOCS_PORT` |

**Local dev** (`scripts/dev.sh` / package scripts):
- `next dev -p ${KR8KAN_WEB_PORT:-3310}`
- `POSTGRES_URL` empty → embedded PGLite (`.kr8kan/pglite`); set it to use an
  external Postgres instance
- Never hardcode 3000 as the only option

### packages/shared (`@kr8kan/shared`)
Copy Kan patterns:
- `permissions.ts` — roles admin/member/guest, permission strings, defaults
- `generateUID` (12-char publicId), slug helpers, sanitize, mentions, optional S3 helpers
- **Remove** any subscription/seat helpers that exist only for Stripe SaaS
  (`utils/subscriptions.ts` → delete or gut to no-ops / plan always "selfhost")

### packages/db (`@kr8kan/db`)
Keep domain schema from Kan analysis:
- user, session, account, verification, apiKey
- workspace, workspace_members, roles, permissions, invite links
- board, list, card, comments, activities, attachments, labels, checklists
- integrations, imports, webhooks, notifications, feedback

**Schema changes for self-host**:
- `workspace.plan` enum: simplify to single value `selfhost` **or** keep free/team/pro
  enums but **never gate features on Stripe** — all features unlocked for self-host
- `subscription` table: **omit** or leave unused (prefer omit in greenfield)
- Soft delete, publicId, indices, `.enableRLS()` as upstream
- Repositories for all entities; no stripe customer sync

**client.ts**: Postgres via `POSTGRES_URL`; PGLite fallback if empty.

**redis.ts**: optional from `REDIS_URL`.

### packages/auth (`@kr8kan/auth`)
`initAuth(db)` with better-auth:
- drizzle adapter, cookiePrefix `kr8kan`
- magic link + optional email/password (`NEXT_PUBLIC_ALLOW_CREDENTIALS`)
- apiKey plugin (Bearer / x-api-key)
- social providers only if env pairs set
- optional OIDC
- **NO stripe plugin**, no createCustomerOnSignUp, no trial hooks
- databaseHooks: domain allowlist / disable sign-up still OK for private instance
- **Remove** Novu user-signup hard dependency; log + optional SMTP welcome only

Client: magicLink + apiKey + oauth — **no stripeClient**.

### packages/api (`@kr8kan/api`)
`appRouter` namespaces (from Kan, minus billing coupling):
```
attachment, board, card, checklist, feedback, health, label, list,
member, import, permission, user, webhook, workspace, integration,
agent   # NEW
```

Implement routers as in Kan analysis (OpenAPI paths under `/api/v1/...`).

**agent router (NEW)**:
- `agent.listWorkers` — list registered worker types
- `agent.run` — `{ worker, boardPublicId?, cardPublicId?, prompt?, options? }` → job id
- `agent.status` — job status/result
- `agent.cancel` — optional
- Auth: protectedProcedure; also allow API key
- Side effect: calls `@kr8kan/agents` runner which shells to Pi

**permissions utils**: keep assert membership + permission checks.
**rateLimit**: Redis or memory; 100/min defaults.
**webhook**: keep workspace webhooks for card events.
**Remove** any stripe/subscription procedure coupling (`hasAvailablePartnerSlot` etc.).

### packages/email
Templates: MAGIC_LINK, JOIN_WORKSPACE, RESET_PASSWORD, MENTION only.
SMTP via nodemailer. Brand strings “Kr8Kan”.

### packages/logger
pino only. Pretty in dev. File transport optional via `LOG_FILE`.

### packages/mcp (optional)
`kr8kan-mcp` bin → local `KR8KAN_BASE_URL` (default http://localhost:3310) + API token.

### packages/agents (`@kr8kan/agents`) — NEW (Pi workers)

Purpose: treat Pi as the **AI worker runtime** for board automation.

**`src/registry.ts`** — worker catalog, e.g.:
- `summarize-board` — read board lists/cards → markdown summary
- `draft-card` — natural language → title/description/checklist draft
- `triage-card` — suggest list/label moves
- `breakdown-card` — split card into checklist items
- `standup` — activity-based standup blurb
- `custom` — freeform prompt with board/card context

**`src/runner.ts`**:
- Resolve `PI_BIN` (default `pi` on PATH) and `PI_AGENT_HOME` (default `~/.pi`)
- Prefer non-interactive invocation patterns available on the machine, e.g.:
  - `pi --print "…"` / headless prompt if supported
  - or spawn a short-lived pi session with a skill/prompt file
  - or call a small local HTTP bridge if you add one under `scripts/`
- Pass **structured context** (board JSON subset, card fields) + worker system prompt
- Never pass secrets (SMTP passwords, BETTER_AUTH_SECRET, API keys) into prompts
- Write job records under `.kr8kan/jobs/<id>.json` (status, stdout, result, timestamps)
- Timeout + max output size

**`src/safety.ts`**:
- Allowlist tools the worker may suggest (no arbitrary shell unless user opts in)
- Redact env-like strings in logs
- Workspace path confinement: only read/write under `/Users/kc/kr8kan` job artifacts

**`src/prompts/*.md`**: system prompts per worker; mention Kr8Kan domain language
(publicId, list index, labels).

Integration with global Pi:
- Document that operator already has sovereign `~/.pi` (skills, models, subagents)
- Workers should **reuse** existing Pi skills when useful (`/think`, explore-style
  summarization) but must not require network SaaS
- Optional: enqueue durable work via fairy-tales **quest** tool if available in
  the environment — otherwise file-based jobs are enough

### apps/web

**next.config.js**:
- transpilePackages: `@kr8kan/api`, `db`, `shared`, `auth`, `agents`, …
- **dev server port** from env (3310)
- No cloud-only image exceptions required

**middleware.ts**:
- Self-host: `/` → `/boards` if session else `/login` (no cloud marketing branch)
- Remove `NEXT_PUBLIC_KAN_ENV === "cloud"` branching entirely

**_app.tsx**:
- Brand Kr8Kan; theme + lingui + modal/popup + tRPC
- PostHog/Umami: only if env set (optional); default off

**Pages to implement** (self-host product):
- login, signup, boards, board detail, card, members, templates, settings
  (account, api keys, integrations, permissions, webhooks, workspace)
- onboarding (workspace create only — **no select-plan**)
- invite accept
- **No** pricing, upgrade, billing, oss-friends marketing requirements

**API routes**:
- auth, trpc, v1 openapi, upload/download
- **NEW** `api/agents/run.ts`, `status.ts`, `health.ts` as thin wrappers if needed
  outside tRPC (or pure tRPC only — prefer tRPC `agent.*`)
- **No** stripe/* routes
- Optional trello import routes

**UI for workers**:
- On board/card views: “Run AI worker” menu → pick worker → show job status
- Settings → Agents: enable/disable workers, show `PI_BIN` health, last jobs
- Full visual + mobile specs: **§d2**

**UI shell (summary — details in §d2)**:
- Design tokens (`--kr8-*`), dark/light, Plus Jakarta Sans
- Desktop: collapsible side nav; Mobile: bottom tab bar + sheets + FAB
- Board: snap-scroll lists on mobile; card = full-screen sheet mobile / right drawer desktop
- Touch DnD or Move action sheet fallback; 44px targets; safe-area insets

### AGENTS.md (project)
Document:
- Stack, publicId, soft-delete, repo→router layering
- Self-host only
- Dedicated ports table
- How to run Pi workers safely
- `pnpm dev` uses 3310

### README.md
- What is Kr8Kan
- Quick start with ports 3310 / 5433
- Env table (self-host)
- Pi workers setup (`pi` on PATH, models configured in `~/.pi`)
- Explicit “not a SaaS; no Stripe”

---



---

## (d2) Frontend Design System, Visual Polish & Mobile

> **Kr8Kan intentional upgrade** over stock Kan UI: higher visual density control,
> clearer hierarchy, motion with restraint, and **mobile-first responsive** shells.
> Do not ship a desktop-only board that merely shrinks. Mark divergences from
> upstream Kan as intentional design upgrades (not SaaS features).

### Design principles
1. **Calm industrial editorial** — dark-capable, high contrast, not neon SaaS candy
2. **Board is the product** — chrome (nav, settings) stays thin; canvas breathes
3. **Touch-first targets** — min 44×44px interactive hit areas on mobile
4. **One accent** — brand accent used sparingly for primary CTAs and focus rings
5. **Motion with purpose** — 150–250ms ease for panels; no endless decorative loops
6. **Readable density** — comfortable type scale; avoid 11px UI chrome

### Brand tokens (implement as CSS variables + Tailwind theme extension)

```css
:root {
  /* Light */
  --kr8-bg: #f6f5f2;
  --kr8-bg-elevated: #ffffff;
  --kr8-bg-muted: #eceae4;
  --kr8-fg: #141414;
  --kr8-fg-muted: #5c5a55;
  --kr8-border: #ddd8ce;
  --kr8-accent: #0f6b5c;          /* deep teal — primary */
  --kr8-accent-fg: #f4fffc;
  --kr8-danger: #b42318;
  --kr8-warning: #b54708;
  --kr8-success: #067647;
  --kr8-radius-sm: 8px;
  --kr8-radius-md: 12px;
  --kr8-radius-lg: 16px;
  --kr8-shadow-sm: 0 1px 2px rgb(20 20 20 / 6%);
  --kr8-shadow-md: 0 8px 24px rgb(20 20 20 / 8%);
  --kr8-font-sans: "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;
  --kr8-font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}

:root.dark, .dark {
  --kr8-bg: #0e0f10;
  --kr8-bg-elevated: #16181a;
  --kr8-bg-muted: #1e2124;
  --kr8-fg: #f2f1ee;
  --kr8-fg-muted: #a3a29b;
  --kr8-border: #2a2e33;
  --kr8-accent: #3ecfbc;
  --kr8-accent-fg: #04221d;
  --kr8-danger: #f97066;
  --kr8-warning: #fdb022;
  --kr8-success: #47cd89;
  --kr8-shadow-sm: 0 1px 2px rgb(0 0 0 / 40%);
  --kr8-shadow-md: 0 12px 32px rgb(0 0 0 / 45%);
}
```

Tailwind: extend `colors` (`kr8.bg`, `kr8.accent`, …), `borderRadius`, `boxShadow`,
`fontFamily`. Use `class` dark mode (`next-themes`). Prefer semantic classes:
`bg-kr8-bg`, `text-kr8-fg-muted`, `border-kr8-border`, `bg-kr8-accent text-kr8-accent-fg`.

### Typography scale
| Token | Size / line | Use |
|-------|-------------|-----|
| display | 28–32 / 1.15 | rare empty states |
| title | 20–22 / 1.25 | page titles |
| subtitle | 16–18 / 1.35 | board name in chrome |
| body | 14–15 / 1.5 | default UI |
| caption | 12–13 / 1.4 | meta, timestamps |
| mono | 12–13 | publicIds, API keys |

Font: Plus Jakarta Sans (already in stack). **No** ultra-light weights for body.

### Layout breakpoints (mobile-first)
| Name | Min width | Shell behavior |
|------|-----------|----------------|
| `base` | 0 | single column; bottom tab bar; board = horizontal scroll lists |
| `sm` | 640px | wider cards; side sheet for card detail |
| `md` | 768px | collapsible left nav (icon rail ↔ expanded) |
| `lg` | 1024px | persistent side nav; card detail as right drawer or modal |
| `xl` | 1280px | max content width for settings (~960–1040px centered) |

**Mandatory mobile behaviors**
- **Navigation**: bottom tab bar on `<md` — Boards · Search/Command · AI Workers · Settings; hide desktop SideNavigation or collapse to hamburger + drawer
- **Board view**: lists as horizontal snap-scroll columns; each list full viewport height minus chrome; sticky list header; card tap opens **full-screen sheet** (not tiny modal)
- **DnD on touch**: use touch-friendly drag handles (visible grip on mobile); if react-beautiful-dnd touch is weak, add `@hello-pangea/dnd` (maintained fork) or explicit “Move” action sheet as fallback — **must work on iOS Safari**
- **Safe areas**: `env(safe-area-inset-*)` padding on bottom tabs and full-screen sheets
- **No hover-only actions** — every card/list action available via long-press menu or overflow `⋯`
- **Inputs**: `font-size ≥ 16px` on mobile form fields to prevent iOS zoom
- **Tables** (members/settings): cardified rows on mobile, not horizontal-cramped tables

### App chrome

**Desktop (`md+`)**
- Left `SideNavigation` ~240px expanded / 64px rail collapsed (persist preference in localStorage)
- Top bar optional thin: workspace switcher, command palette (`⌘K` / `Ctrl+K`), theme toggle, user menu, “AI worker” button
- Main: `min-h-screen bg-kr8-bg`; elevated panels use `bg-kr8-bg-elevated shadow-kr8-sm border border-kr8-border rounded-kr8-md`

**Mobile (`<md`)**
- Top: compact bar — workspace avatar/name, board title, overflow menu
- Bottom: 4–5 tab bar with icons + labels (labels can hide on very small widths if needed, prefer keep)
- Floating action button (FAB) bottom-right above tab bar for “New card” / “New board” contextual

### Screens — visual + responsive requirements

#### Auth (login / signup)
- Centered card max-w-md on desktop; full-bleed form on mobile with brand mark top
- Magic link primary; credentials secondary if enabled
- Subtle patterned or soft gradient background (CSS only; no heavy Lottie required)
- Clear error states; disabled submit while pending

#### Boards index
- Responsive grid: 1 col mobile → 2 sm → 3 lg
- Board tiles: cover accent strip or soft gradient, name, list/card counts, visibility badge, favorite star
- Empty state illustration (simple SVG) + CTA “Create board”
- Filters/search sticky under top bar

#### Board (kanban) — visual centerpiece
- Background: subtle dot/grid pattern optional (`PatternedBackground` upgraded, low contrast)
- Lists: elevated columns width ~280–300px desktop; ~85vw mobile snap
- List header: name (inline edit), count badge, `⋯` menu (rename, delete, AI summarize list)
- Cards: rounded-md, title 1–3 lines clamp, label chips (max 3 +N), assignee avatars stack, due date pill (overdue = danger tone), comment/attachment counts as quiet icons
- Card hover (desktop): slight lift shadow + border accent
- Drag preview: translucent card clone
- Column “+ Add card” composer expands inline
- **Mobile card open**: full-screen sheet with drag-to-dismiss; sections as accordions (Description, Checklist, Comments, Activity, Attachments)
- **Desktop card open**: right drawer (~420–480px) or centered modal ≥640px — pick one and stay consistent (prefer **right drawer** for board context retention)

#### Card detail content
- TipTap editor with comfortable padding, typography plugin, link + mention
- Checklist progress bar under title
- Activity feed timeline (left rail line) — not a flat dump
- Attachment grid with file type icons; image thumbnails
- Member / label pickers as accessible listboxes (Headless UI)

#### Settings
- Desktop: secondary left subnav inside settings layout
- Mobile: settings hub list → push subpages (no cramped multi-column)
- API keys: monospace reveal/copy; dangerous actions confirm modals
- Agents settings: worker cards with enable toggle, last run status, “Test worker”

#### AI Workers UI
- Board/card overflow → “Run AI worker” → bottom sheet (mobile) / popover (desktop)
- Steps: select worker → optional prompt → Run → progress → result markdown panel → actions “Create cards from result” / “Copy” / “Dismiss”
- Job history drawer

### Component upgrade checklist (`apps/web/src/components`)
Implement/enhance with tokens above:
- `Button` — variants: primary (accent), secondary (muted border), ghost, danger; sizes sm/md/lg; loading spinner; full-width mobile option
- `Input`, `Textarea` — focus ring accent; error text; label always visible
- `Modal` / `Sheet` — Sheet is mobile-first bottom drawer; Modal centered desktop
- `Dropdown` / `CheckboxDropdown` — keyboard + touch
- `Badge`, `Avatar` (stack), `Tooltip` (desktop only; mobile uses explicit labels)
- `SideNavigation`, `Dashboard` shell, `SettingsLayout` responsive split
- `ThemeToggle`, `LanguageSelector`, `CommandPallette` (command palette)
- `Editor` TipTap theme matching kr8 tokens
- `LottieIcon` optional; prefer lightweight CSS/SVG icons (react-icons OK)
- `StrictModeDroppable` / dnd wrapper touch-safe
- New: `BottomTabBar`, `MobileSheet`, `FAB`, `EmptyState`, `Skeleton` loaders, `ProgressBar`

### Motion & feedback
- Page/panel: opacity + translateY 8px, 180ms
- Toast/popup: top-center mobile, bottom-right desktop
- Optimistic card moves with rollback toast on error
- Skeletons for board load (list placeholders), not spinners-only

### Accessibility
- Focus visible rings (`:focus-visible`) using accent
- `prefers-reduced-motion: reduce` disables nonessential transitions
- Color is not the only status signal (icons + text)
- Dialogs trap focus; Escape closes
- Landmark roles: `nav`, `main`, `complementary` for card drawer

### Performance (frontend)
- Avoid layout thrash on drag
- Virtualize activity/comments if lists grow long (optional simple windowing)
- Next/Image for remote avatars when domains configured
- Keep Lottie off critical path

### Files to add/adjust (tree deltas for v3)
```
apps/web/src/
  styles/
    globals.css          # CSS variables, base resets, safe-area, pattern utils
    components.css       # optional component layers
  components/
    BottomTabBar.tsx
    MobileSheet.tsx
    FAB.tsx
    EmptyState.tsx
    Skeleton.tsx
    WorkerRunner.tsx
  hooks/
    useMediaQuery.ts     # already exists — use for shell switches
    useIsMobile.ts       # convenience wrapper < md
  providers/
    theme.tsx            # next-themes already via _app — ensure class on <html>
```

### Visual QA checklist (must pass before “UI done”)
- [ ] iPhone-width (390px): login, boards grid, board horizontal lists, card full sheet, settings hub, worker sheet
- [ ] Tablet (768px): nav rail + board usable
- [ ] Desktop (1280px): side nav + board + card drawer
- [ ] Dark + light themes both readable (contrast)
- [ ] Touch drag or explicit move works on card between lists
- [ ] No horizontal page scroll except intentional list canvas
- [ ] Bottom tab bar clear of iOS home indicator (safe-area)
- [ ] Primary CTA contrast on accent in light and dark


---

## (e) Dependencies & Installation

```bash
# Node 20.18+, pnpm 9.14.2, Pi CLI available as `pi`
corepack enable && corepack prepare pnpm@9.14.2 --activate

# Build location (required)
cd /Users/kc/kr8kan
# (scaffold files into this empty directory)

pnpm install
cp .env.example .env
# set BETTER_AUTH_SECRET, NEXT_PUBLIC_BASE_URL=http://localhost:3310
# POSTGRES_URL=postgres://kr8kan:kr8kan@localhost:5433/kr8kan  # if using external Postgres
# leave POSTGRES_URL empty for embedded PGLite

# DB
pnpm db:migrate

# App
pnpm dev
# → http://localhost:3310
```

Workspace packages:
`@kr8kan/web`, `@kr8kan/docs?`, `@kr8kan/api`, `@kr8kan/auth`, `@kr8kan/db`,
`@kr8kan/shared`, `@kr8kan/email`, `@kr8kan/logger`, `@kr8kan/mcp?`, `@kr8kan/agents`

---

## (f) Environment Setup

`.env.example` — **names only**:

### Required
- `NEXT_PUBLIC_BASE_URL` = `http://localhost:3310`
- `BETTER_AUTH_SECRET`
- `POSTGRES_URL` (or empty for PGLite)
- `NEXT_PUBLIC_ALLOW_CREDENTIALS` = `true` (recommended self-host)

### Dedicated ports
- `KR8KAN_WEB_PORT` = `3310`
- `KR8KAN_DOCS_PORT` = `3311`
- `KR8KAN_POSTGRES_PORT` = `5433`
- `KR8KAN_REDIS_PORT` = `6380`

### Auth (optional)
- `BETTER_AUTH_TRUSTED_ORIGINS`
- `BETTER_AUTH_ALLOWED_DOMAINS`
- `NEXT_PUBLIC_DISABLE_SIGN_UP`
- Social `*_CLIENT_ID` / `*_CLIENT_SECRET` pairs as needed
- `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_DISCOVERY_URL`
- `KR8KAN_ADMIN_API_KEY` (rename from KAN_ADMIN_API_KEY)

### Email / storage / redis (optional)
- SMTP_*, EMAIL_FROM, NEXT_PUBLIC_DISABLE_EMAIL
- S3_* and NEXT_PUBLIC_STORAGE_* / bucket names
- REDIS_URL = `redis://localhost:6380` if using compose redis

### Pi workers
- `KR8KAN_PI_WORKERS_ENABLED` = `true`
- `PI_BIN` = `pi` (or absolute path)
- `PI_AGENT_HOME` = `/Users/kc/.pi`
- `KR8KAN_PI_MODEL` optional model override string if your pi CLI supports it
- `KR8KAN_PI_JOB_DIR` = `.kr8kan/jobs`

### MCP (optional)
- `KR8KAN_BASE_URL` = `http://localhost:3310`
- `KR8KAN_API_TOKEN`

### Explicitly excluded (do not document as required)
- All `STRIPE_*`
- `NEXT_PUBLIC_KAN_ENV`
- `NOVU_API_KEY`, `AXIOM_TOKEN`, `AXIOM_DATASET`
- Partner license keys
- SaaS analytics keys (optional only)

---

## (g) Run & Test Instructions

| Goal | Command / URL |
|------|----------------|
| Dev web | `pnpm dev` → **http://localhost:3310** |
| Docs | `pnpm -F @kr8kan/docs dev` → **http://localhost:3311** |
| Postgres | host **localhost:5433** |
| Redis | host **localhost:6380** (profile) |
| Build | `pnpm build` |
| Migrate | `pnpm db:migrate` |
| Lint / types | `pnpm lint` / `pnpm typecheck` |
| API tests | `pnpm -F @kr8kan/api test` |
| Worker smoke | UI “summarize-board” or `pnpm agents:worker -- --worker=summarize-board --board=<publicId>` |
| OpenAPI | http://localhost:3310/api/v1/openapi.json |
| Health | http://localhost:3310/api/v1/health |

### Parallel local dev guarantee
- Defaults chosen to avoid 3000/3001/5432/6379 used by other projects
- Document in README: change `KR8KAN_*_PORT` if still conflicting
- Compose binds only Kr8Kan’s host ports; container-internal ports stay standard

### Smoke test
1. Open http://localhost:3310 → login/signup
2. Create workspace → board → lists → cards; drag reorder
3. Comment, label, checklist, due date
4. Create API key; REST call with Bearer
5. Enable Pi workers; run `summarize-board`; see job result
6. Confirm **no** billing/upgrade UI exists
7. Resize to 390px width: bottom tabs work; board lists scroll horizontally; card opens full sheet
8. Toggle dark mode: contrast OK on board + settings
9. Touch or Move-action moves a card across lists on a narrow viewport

---

## (h) Design Decisions & Conventions

1. **Self-host only** — single deployment for the operator; no cloud plan matrix.
2. **Rebrand** — Kr8Kan / `@kr8kan/*` / cookie prefix `kr8kan` / ports 3310+.
3. **Dedicated ports** — first-class env vars; never assume free 3000.
4. **No SaaS surface** — strip Stripe, Novu-required paths, Axiom-required paths,
   pricing/upgrade/billing, partner licensing.
5. **Domain model stays Kan-like** — workspace→board→list→card, publicId, soft
   delete, activity log, RBAC permissions.
6. **Layers** — schema → repository → tRPC router → Next pages/views.
7. **Authz** — membership + permission strings; all features unlocked (no plan gates).
8. **Pi workers** — AI side-car via local `~/.pi`; jobs on disk; no vendor AI SaaS.
9. **Optional infra** — Redis/S3/SMTP/OAuth enhance but app boots without them.
10. **Pages Router + tRPC + OpenAPI** retained for fidelity to analyzed architecture.
11. **Logging** — pino to stdout; structured `createLogger(module)`.
12. **Safety** — never send secrets to Pi; job artifacts under `.kr8kan/`.
13. **Intentional divergence** — when this prompt conflicts with upstream Kan
    README/cloud docs, **this prompt wins**.
14. **Mobile is required** — desktop-only board UI is incomplete.
15. **Design tokens over one-off hex** — all colors/radii/shadows via `--kr8-*` / Tailwind theme.
16. **Touch parity** — no hover-only critical actions; visible affordances on small screens.
17. **Visual upgrade is in-scope** — prettier than stock Kan is expected for Kr8Kan.

---

## (i) Out of Scope / Do Not Invent

### Removed from upstream (do not re-add)
- Stripe packages, webhooks, checkout, seats, trials, pro/team paywalls
- `NEXT_PUBLIC_KAN_ENV=cloud` marketing homepage behavior
- Novu as required notification bus
- Axiom as required log sink
- Partner license / activate SaaS flows
- Billing settings UI, pricing page, upgrade onboarding step

### Still optional / stub-ok
- Full multi-locale message catalogs (English enough)
- Lottie marketing animations
- Perfect legal pages
- Full Trello/GitHub import edge-case parity
- Mintlify docs app
- Historical drizzle migration chain (one initial migration OK)

### Pi integration uncertainties (implement pragmatically)
- Exact `pi` CLI flags differ by install — detect `pi --help` / document the
  chosen invocation in `packages/agents/src/runner.ts` comments
- If non-interactive pi is awkward, implement a **local worker daemon** script
  that uses the same models config under `~/.pi` rather than inventing a new
  hosted AI API
- Do not invent a second agent framework when `~/.pi` already exists

### Frontend notes
- Visual polish and mobile responsiveness **are in scope** for Kr8Kan (see §d2)
- Do not ship unstyled default browser controls for primary flows
- Stock upstream Kan look is a baseline to **surpass**, not copy pixel-for-pixel

### Do not
- Scaffold outside `/Users/kc/kr8kan` unless asked
- Bind host 3000/5432 by default
- Reintroduce `@kan/stripe` under a new name
- Call external paid AI HTTP APIs as the primary worker path
- Copy real secrets into the repo

---

## Implementation order

1. Scaffold monorepo in `/Users/kc/kr8kan` (package.json, workspace, turbo, tooling)
2. `@kr8kan/shared` permissions + UID
3. `@kr8kan/db` schema (no subscription billing) + client + repos + initial migration
4. `@kr8kan/logger`, `@kr8kan/email`
5. `@kr8kan/auth` without Stripe
6. `@kr8kan/api` routers + OpenAPI + agent router stubs
7. `@kr8kan/agents` Pi runner + worker prompts
8. `apps/web` on port **3310**, self-host middleware, auth pages
9. **Design system** (`globals.css` tokens, Button/Input/Sheet/TabBar) + responsive Dashboard shell
10. Board/card UI with mobile snap lists, card sheet/drawer, touch-safe dnd
11. Agents UI (WorkerRunner) + settings
12. Dedicated ports; README/AGENTS.md
13. Visual QA checklist (§d2) + vitest (board move / permissions / agent jobs)

End of recreation prompt: Kr8Kan v3 (frontend + mobile).
