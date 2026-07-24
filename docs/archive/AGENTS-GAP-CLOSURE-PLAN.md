> **ARCHIVED — COMPLETED 2026-07-24** (commit `f9f2500`). All six sprints
> shipped and verified. Living references: `docs/AGENTS-DEPLOYMENT.md`.

# Kr8Kan Agents — Gap-Closure Implementation Plan

Grounded against the actual codebase (2026-07-24). Monorepo: pnpm + Turborepo; Drizzle/Postgres (PGlite dev); tRPC v11 + trpc-to-openapi REST; Vitest per package.

Key existing anchors:

| Concern | Where it lives today |
|---|---|
| Worker catalog | `packages/agents/src/registry.ts` (7 workers, `WorkerDefinition`) |
| Runner / spawn | `packages/agents/src/runner.ts` (`runWorker`, `execute`, `inFlight` Map, flat JSON jobs in `.kr8kan/jobs/<id>.json`) |
| Safety | `packages/agents/src/safety.ts` (`scrubEnv`, `projectRoots`, `toolsAllowed`, timeouts, 256KB cap) |
| Agent API | `packages/api/src/routers/agent.ts` (`listWorkers/health/run/status/jobs/cancel`) |
| Permissions | `packages/api/src/permissions.ts` (`assertPermission`), `packages/shared/src/permissions.ts` (role map, `agent:run`) |
| Board/card writes | `packages/db/src/repository/card.ts`, `board.ts` (incl. `recordActivity`) |
| UI | `apps/web/src/components/WorkerRunner.tsx`, `apps/web/src/pages/settings/agents.tsx` |
| REST bridges | `apps/web/src/pages/api/agents/{run,status,health}.ts` |
| CLI | `scripts/pi-worker.sh` |
| DB schema | `packages/db/src/schema/core.ts` + `packages/db/migrations/` |

---

## Sprint A — Ownership, authz, cancel persistence (0.1, 0.3, 3.1)

### A1. Durable job store (DB table)
1. Add `agent_job` table in `packages/db/src/schema/core.ts`:
   `id (publicId), workspaceId FK, boardPublicId?, cardPublicId?, worker, status enum(pending|running|completed|failed|cancelled), createdBy FK user, prompt, resultRaw, resultParsed jsonb, error, projectPath, piModel, toolsUsed bool, promptVersion, progress, verifyStatus, verifyLog, createdAt, startedAt, completedAt`. Generate Drizzle migration.
2. New `packages/db/src/repository/agentJob.ts`: `createJob`, `updateJob`, `getJobByPublicId`, `listJobsForWorkspace(filters)`, `markOrphans`.
3. Rewrite `runner.ts` `writeJob/getJob/listJobs` to use the repo (runner receives a db handle via `runWorker` args or a small injected store interface so `packages/agents` stays db-agnostic — inject `JobStore` from `packages/api`). Keep `inFlight` Map for process handles only; it is no longer the source of truth for status.
4. Reaper: on web-server boot (e.g. in `apps/web` server init or first router touch via a `once()` guard), mark jobs `running` with `startedAt < now - timeout` as `failed`, `error: "orphaned"`.

### A2. Authz on every agent procedure
In `packages/api/src/routers/agent.ts`:
- `status` / `cancel`: load job → `assertPermission(db, user, job.workspaceId, "agent:run")`; 404 via `notFound()` on cross-workspace ids (no existence leak).
- `jobs`: require `workspaceId` input; `assertPermission`; list only that workspace's jobs. Filters: board, worker, status.
- `cancel`: additionally require `job.createdBy === userId` OR `agent:manage`.
- New permission `agent:manage` in `packages/shared/src/permissions.ts` → `ADMIN_PERMISSIONS` only. Extend the existing permission-map test in `packages/shared/src/__tests__/shared.test.ts`.
- `run`: reject unknown workers via `z.enum(WORKERS.map(w => w.name))` built from the registry, not free string.
- Rate limit `run` per user: reuse the rate-limit middleware in `packages/api/src/trpc.ts`; caps: N concurrent (query DB for user's running jobs), M/hour.

### A3. Health hardening
`apps/web/src/pages/api/agents/health.ts`: unauth response becomes `{ ok, enabled }` only. Full detail (PI_BIN path, agent home, roots) only when the request authenticates (session or API key via `callerFor`). Mirror in tRPC `health`.

### A4. Cancel that always persists
- `cancelJob` in `runner.ts`: write `cancelled` status to DB **first**, then SIGKILL if process alive; dead-process cancel still flips status.
- Cancel button in `WorkerRunner.tsx` (while polling) and per-row in `settings/agents.tsx` jobs list.

**Done when:** restart mid-run cannot leave permanent `running`; a guest or other-workspace member cannot read/cancel a job by id; unauth health leaks nothing.

---

## Sprint B — Structured output contract (0.2)

### B1. Schemas + parsers in `packages/agents`
- New `packages/agents/src/schemas.ts`: per-worker Zod schemas —
  `draft-card` {title, description, checklist[], suggestedListPublicId?}; `triage-card` {listPublicId, labelPublicIds[]}; `breakdown-card` {checklistName, items[]}; `standup` {sections}; `summarize-board` {summary, highlights[]}; `dev-task` {what, howToVerify, notes, checklistItemsDone?[]}; `custom` → no schema (raw only).
- New `packages/agents/src/parse.ts`: `parseWorkerResult(worker, text)` → `{ ok: true, data } | { ok: false, error }`. Strategy: **fenced JSON block** (```json … ```), last block wins; Zod-validate. Fail closed.
- Prompts in `packages/agents/src/prompts/*.md`: rewrite each to demand exactly one fenced JSON block matching its schema, keep a short human-readable summary above it. Add negative examples ("do not invent publicIds"). Add `promptVersion` constant per worker in registry; stamp on job.

### B2. Wire-through
- `execute()` in `runner.ts`: on completion, run parser, store `resultRaw` + `resultParsed` (+ parse error into `error`-adjacent field, job still `completed` — parse failure is not run failure, but apply is blocked).
- Export `parseWorkerResult` from `packages/agents/src/index.ts` for API + UI reuse.

### B3. Tests
- `packages/agents/src/__tests__/parse.test.ts`: golden fixtures per worker (captured from real outputs into `__tests__/fixtures/`), plus malformed cases asserting fail-closed.

**Done when:** every catalog worker has parser + golden tests; bad output yields explicit parse error, never silent.

---

## Sprint C — Apply-back loop (1.1, 1.2, 1.3)

### C1. `agent.apply` mutation
New procedure in `packages/api/src/routers/agent.ts` (or split `agentApply.ts`):
- Input: `{ jobId, actions: Action[] }`, discriminated union:
  `createCard {listPublicId, title, description?, checklist?}` · `updateCard {cardPublicId, title?, description?}` · `moveCard {cardPublicId, listPublicId}` · `setLabels {cardPublicId, labelPublicIds[]}` · `replaceChecklist | appendChecklistItems {cardPublicId, name?, items[]}` · `addComment {cardPublicId, body}`.
- Each action: resolve entity → `assertPermission` with the same permission the equivalent UI mutation uses (`card:create/edit/move/comment`) → call existing `cardRepo`/`boardRepo` functions → `recordActivity` with new activity type `agent.applied` carrying `{worker, jobId, actionIndex}`.
- Validate all referenced publicIds belong to the job's workspace/board before mutating anything (all-or-nothing precheck; then apply sequentially).
- Idempotency: `applied_actions` recorded on the job row (jsonb array of `{index, entityPublicId, at}`); re-apply of an already-applied index is a no-op returning the prior result.

### C2. Per-worker apply presets
New `packages/agents/src/apply-presets.ts`: `buildApplyActions(worker, parsedData, context)` → `Action[]` + preset label:
- `draft-card` → "Create card" (list picker, prefilled)
- `breakdown-card` → "Add checklist to card"
- `triage-card` → "Move + set labels" (confirm chips)
- `standup` / `summarize-board` → "Post as comment" or copy-only
- `dev-task` → "Post report as card comment" + optional check-off of mapped checklist items
- `custom` → copy + "post as comment" only

### C3. WorkerRunner apply UI
`apps/web/src/components/WorkerRunner.tsx`:
- On complete: parsed preview panel (editable fields) when `resultParsed` present; raw markdown fallback.
- CTAs: primary = preset apply → `api.agent.apply`; secondary = copy; tertiary = post comment.
- Parse failed → apply disabled, show raw + "retry parse" (re-run `parseWorkerResult` after manual edit of raw).
- After apply: invalidate `board.getBoardWithContents` / card queries via tRPC utils, toast, link to created entity.
- Same actions in the MobileSheet variant (44px+ touch targets).

**Done when:** draft/breakdown/triage apply into real board entities from the modal, with `agent.applied` activity rows; double-click cannot duplicate.

---

## Sprint D — Dev-agent reliability (2.1, 2.2, 2.3)

### D1. Project folder lock
- New `agent_lock` DB row (or unique partial index: one `running` dev job per `projectPath`) — DB beats file lock since jobs are now DB-backed. Acquire in `run` before spawn; conflict → `TRPCError PRECONDITION_FAILED` with running jobId.
- Release on complete/fail/cancel/reaper (reaper from Sprint A also frees locks).
- UI: `WorkerRunner` surfaces "folder in use" with link to the running job.

### D2. Richer coding context (secret-free)
In `packages/api/src/routers/agent.ts` context builder:
- Sibling cards in same list (title + publicId), board list names, last N `card_activity` rows (small N, e.g. 10).
- Raise description cap for `dev-task` (full card, drop the 500-char truncate).
- Checklist completion state explicit in prompt JSON.
- Optional git snapshot: when `toolsAllowed`, runner pre-spawn executes `git status --short` + `git rev-parse --abbrev-ref HEAD` inside `projectPath` (scrubbed env), injects as a context block. Guarded, best-effort, never fatal.

### D3. Live progress
- `runner.ts` already parses the pi JSON event stream — on `tool_execution_*` / `message_end` events, update job `progress` (bounded string: last tool name + truncated last assistant text; ring-buffer, respect 256KB cap overall).
- `status` returns `progress`; `WorkerRunner` shows it under the spinner during polling.

**Done when:** two dev-tasks on one path is impossible; a 10-min tools run shows live progress; dev-task prompt includes board position + optional git snapshot.

---

## Sprint E — Concurrency, ops, tests (3.3, 3.4, 5.x)

### E1. Concurrency & queue
- `KR8KAN_PI_MAX_CONCURRENT` (global), per-user cap, lower cap for tools workers (1–2). Enforce in `runWorker`: over cap → job stays `pending`, in-process FIFO queue drains as slots free (statuses already persist, so a crash leaves clean `pending` rows the reaper can re-queue or fail).
- Spamming Run cannot fork-bomb: covered by caps + Sprint A rate limit.

### E2. Multi-instance honesty
- `health` reports `runnerMode: "in-process"`; docs note agents require a long-lived Node process (no serverless multi-instance). Sidecar extraction stays a documented future option, not built now.

### E3. Logging / audit
- Structured logs (`packages/logger`) on job completion: `duration_ms, worker, tools, bytes_out, apply_count`.
- Every board/card-scoped run writes an activity row (run started/completed), not just applies.
- Audit `SECRET_ENV_KEYS` list in `safety.ts` stays complete; add test asserting known-sensitive keys are covered.

### E4. Settings → Agents completeness
`apps/web/src/pages/settings/agents.tsx`: show tools-allowed flag, project roots (count + paths — auth'd view only), max concurrent, job store mode; "Test worker" uses a real board picker; link "how to enable dev-task" env checklist.

### E5. CLI parity
`scripts/pi-worker.sh`: build JSON with `jq` (kill printf injection); exit codes 0 complete / 2 failed / 3 timeout; `--apply` flag later hitting the same `agent.apply` REST path (exit 4 on apply failure).

### E6. Tests
- Unit: `safety` (scrub, roots), parsers (Sprint B), lock, reaper.
- Integration (`packages/api`, first test file there): `agent.run` → complete against a mock `pi` fixture binary (shell script emitting canned JSON events); `agent.apply` hits repos and writes activity; cross-workspace access returns 404.
- Component test: WorkerRunner apply happy path.

---

## Sprint F — Verify command + worker polish (2.4, 2.5, 4.x)

### F1. Post-run verification
- Board setting `verifyCommand` (schema addition on board or board settings jsonb). After dev-task completes, runner executes it inside `projectPath` with tools timeout budget; capture exit code + stdout tail into `verifyStatus`/`verifyLog`. Failure never overwrites the agent result. UI pass/fail badge on the job.

### F2. Safer tool policy
- Settings UI documents the required env combo (roots + allow flag + PI_BIN).
- Prompt-level deny list appended for tools runs (`git push`, `rm -rf /`, network installers) with an honest "tools remain powerful" note.
- First tools run per session → confirm dialog in WorkerRunner.
- `projectPath` + `piModel` already on the job row (Sprint A) → audit complete.

### F3. Worker quality (4.1/4.2)
- Prompts match schemas exactly (single format — done in Sprint B; this sprint tightens from real-world outputs).
- `triage-card`: parser rejects labels/lists absent from context. `breakdown-card`: default checklist name "Breakdown", skip existing item titles (apply-time dedupe). `draft-card`: suggested list when board context present. `standup`: optional per-board target list names.
- New workers (`acceptance-criteria`, `risk-review`, `rename-normalize`) only after the apply loop has been in use — end of this sprint at earliest.

---

## Non-goals (guardrails — do not "fix" by accident)
No vendor SDK/API keys shipped in Kr8Kan · no auto-commit/push from dev-task · no tools without allowlisted roots · no plan/billing gates · no multi-tenant agent mesh · no silent board mutation without operator apply (auto-apply only ever as a future explicit flag, default off).

## Exit criteria (definition of gaps-closed)
1. Jobs workspace-scoped, owned, recoverable after crash (A).
2. Every stock worker parseable, fail-closed (B).
3. One-click apply for draft/breakdown/triage with activity rows (C).
4. Same-folder dev-task collision impossible (D).
5. Tools runs show progress + audit trail; verify optional (D/F).
6. No cross-workspace job read/cancel/list (A).
7. Concurrency capped; deploy model documented (E).
8. CLI and UI share the same apply-capable path (E).

## Sequencing rationale
A before everything: B/C write parsed results and apply records onto the job row — pointless against flat files with no tenancy. B before C: apply consumes parsed output. D independent after A (needs DB lock rows). E hardens what exists; F is opt-in polish on a working loop.

## Risk notes
- **Runner/db coupling:** `packages/agents` currently has no db dependency. Inject a `JobStore` interface from `packages/api` rather than importing `@kr8kan/db` into agents — keeps the package spawnable/testable standalone.
- **Migration of in-flight flat jobs:** one-time import script (or accept loss — jobs are ephemeral; recommend accept loss, note in changelog).
- **Prompt/schema drift:** `promptVersion` on the job lets old results keep parsing under their original parser version if a schema changes.
