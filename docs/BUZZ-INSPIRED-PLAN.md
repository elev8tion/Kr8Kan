# Kr8Kan × Buzz — Harvest & Implementation Plan

Inspiration source: [block/buzz](https://github.com/block/buzz) — Block's self-hosted
workspace where humans and AI agents collaborate as equals on one signed event log.
Harvested 2026-07-24. Grounded against the actual Kr8Kan codebase (post
agents-gap-closure, commit `f9f2500`): pnpm + Turborepo; Drizzle/Postgres (PGlite dev);
tRPC v11 + trpc-to-openapi REST; Pi workers with DB-backed jobs, structured output,
apply loop.

## What Buzz does that's worth stealing

| Buzz concept | What it is there | Kr8Kan translation |
|---|---|---|
| Agents as first-class members | Agents have their own identity, profile, membership, audit trail — "same shape whether the author is a person or a process" | Agent identities as workspace members; agent actions attributed to the *agent*, not the triggering human |
| One event log / hash-chain audit | Every message, review, workflow step is a signed event in one immutable, searchable log (`buzz-audit`) | Workspace-level append-only audit log, hash-chained, covering human + agent actions, with a verify endpoint |
| Branch-as-room | A branch's patches, CI, review, and merge decision live in one channel — "the channel *was* the pull request" | Card-as-conversation: agents participate in card comment threads; runs, results, verifies, and approvals all land on the card |
| Reactions as workflow primitives | Release agent posts draft → human 👍 reaction → workflow ships it | Reactions on comments; a 👍 on an agent proposal comment is the approval gate that fires apply |
| YAML workflows (message/reaction/schedule/webhook triggers) | `buzz-workflow`: triggers → steps → approval gates, every step an auditable event | DB-defined workflows: board-event triggers → steps (run worker / apply preset / comment / webhook) with human gates |
| Agent personas (`buzz-persona`) | Pre-packaged agent identities and capabilities | Workspace-defined custom workers: name, avatar, system prompt, output schema — stored in DB, run through the existing runner |
| Agent-first CLI (JSON in / JSON out) | `buzz-cli` designed for LLM tool calls | `pi-worker.sh --json` machine mode + workflow trigger endpoint |
| Full-text search over the log | Postgres FTS across everything | Postgres FTS across cards, comments, and agent results |
| Mention-driven agent dispatch | Agents watch events and act in-thread (triage agent, review agent, docs agent) | `@worker` mentions in card comments dispatch a run whose result posts back to the thread |

**Deliberately NOT stolen:** Nostr protocol, Schnorr keys/npubs, relay federation,
web-of-trust reputation, chat channels/DMs/huddles, git hosting, canvases,
multi-tenant domain scoping. Kr8Kan is a kanban, not a chat platform; integrity
comes from the DB hash chain, not cryptographic identity. See Non-goals.

Key existing anchors:

| Concern | Where it lives today |
|---|---|
| Worker catalog | `packages/agents/src/registry.ts` (`WorkerDefinition`, `promptVersion`) |
| Runner / queue | `packages/agents/src/runner.ts` (`runWorker`, `JobStore`, FIFO + caps, `onFinish`) |
| Structured output | `packages/agents/src/schemas.ts`, `parse.ts` (fail-closed fenced JSON) |
| Apply loop | `packages/api/src/agentApply.ts` (`applyJobActions`, action union, idempotency) |
| Apply presets | `packages/agents/src/apply-presets.ts` (`buildApplyActions`) |
| Jobs | `agent_job` table, `packages/db/src/repository/agentJob.ts` |
| Activity | `card_activity` table, `cardRepo.recordActivity` (card-scoped only) |
| Comments | `comment` table, `cardRepo.addComment` (no reactions, no threading) |
| Permissions | `packages/shared/src/permissions.ts` (`agent:run`, `agent:manage`) |
| API | `packages/api/src/routers/agent.ts`, `card.ts`, `board.ts` |
| UI | `WorkerRunner.tsx`, `settings/agents.tsx`, board/card views |
| Webhooks (outbound) | `packages/api/src/webhooks.ts`, `webhook` table |

---

## Sprint A — Agent identity + unified audit chain

*Buzz: "Same shape, same identity model, same audit trail, whether the author is a person or a process."*

### A1. Agent members
1. `agent_identity` table in `packages/db/src/schema/core.ts`:
   `id, publicId, workspaceId FK, kind enum(stock|custom), workerName, displayName, avatar (emoji/colour), createdBy, createdAt, deletedAt`. One row auto-provisioned per stock worker per workspace on first run (lazy, in `ensureAgentInfra` path); custom workers (Sprint E) create their own.
2. `createdBy` on comments/activity stays a human FK — add nullable `agentIdentityId` FK to `comment`, `card_activity`, and `agent_job`. When an apply/comment originates from a worker result, stamp **both**: the agent identity (author) and the human (operator who approved). UI renders the agent's name + avatar with an "agent" chip, operator in the tooltip ("applied by @kc").
3. `agentApply.ts`: `performAction` passes `agentIdentityId` through to `addComment` / `recordActivity`. `agent.run.started/completed` activity rows get it too.
4. UI: agent avatar component (deterministic colour from publicId + robot glyph); render in comment list, activity feed, and job rows.

### A2. Workspace-level audit log with hash chain
1. `audit_log` table: `id (bigserial), workspaceId FK, seq (per-workspace monotonic), eventType, entityType, entityPublicId, actorUserId?, actorAgentId?, payload jsonb, prevHash char(64), hash char(64), createdAt`. `hash = sha256(prevHash || seq || eventType || entityPublicId || canonical(payload) || createdAt)`. Unique index `(workspaceId, seq)`.
2. `packages/db/src/repository/auditLog.ts`: `append(db, entry)` (transactionally reads last hash + seq per workspace — `SELECT … FOR UPDATE` on the tail row; PGlite single-writer makes this trivial in dev), `list(filters)`, `verifyChain(workspaceId, fromSeq?)` → recomputes hashes, returns first break or ok.
3. Emit from the existing choke points — do **not** scatter call sites: `cardRepo.recordActivity` (all card events already funnel here), `agentApply.applyJobActions` (apply summary), runner `onFinish` (job terminal states), `board.update`, member add/remove/role change. One helper `audit(db, wsId, …)` with fire-and-forget error handling (audit failure logs, never blocks the mutation).
4. API: `workspace.auditLog` query (admin-only: `workspace:edit`), filters by entity/actor/type/date; `workspace.auditVerify` mutation returning `{ ok, brokenAtSeq? }`.
5. UI: Settings → Audit page — table, filters, "Verify integrity" button with green/red result. Export as JSON.

**Done when:** every board/card/member/agent mutation lands in one per-workspace chain; tampering with any historical row makes `auditVerify` report the exact break; agent-authored comments render under the agent's identity.

---

## Sprint B — Card-as-conversation: reactions + @worker mentions

*Buzz: branch-as-room; agents act in-thread; reactions are protocol.*

### B1. Comment reactions
1. `comment_reaction` table: `id, commentId FK, emoji varchar(16), userId FK, createdAt`, unique `(commentId, emoji, userId)`. Small curated emoji set (👍 👎 🎉 👀 🚀 ❌) — not a full picker.
2. `card.addReaction` / `card.removeReaction` mutations (`card:comment` permission); reactions included in `getCardByPublicId` payload.
3. UI: reaction chips under each comment, tap to toggle, count + tooltip of who. 44px touch targets in the mobile card sheet.
4. Reaction events → `card_activity` + audit log (they become workflow triggers in Sprint C and approval signals in Sprint D — this table is load-bearing, not cosmetic).

### B2. `@worker` mentions dispatch runs
1. Mention grammar in comment bodies: `@draft-card`, `@breakdown-card`, `@custom("prompt…")` — parse server-side in `card.addComment` after insert (regex against registry names + custom workers). Guests can comment but mentions require `agent:run` — a guest's mention posts fine, dispatches nothing, and the UI says why.
2. Dispatch through the existing `agent.run` path (same caps, same lock, same authz — build a shared `dispatchWorker(db, user, {worker, cardPublicId, prompt})` helper both the router and the mention hook call; the mention's remaining comment text becomes the prompt).
3. Result posts back **as a comment on the card** authored by the agent identity, containing the human-readable part plus (when parsed) a compact proposal block: "I propose: move to *Doing*, labels *bug* — react 👍 to apply" (the apply-on-reaction lands in Sprint D; until then the comment carries an "Apply" button that opens WorkerRunner's apply panel pre-loaded with the job).
4. `agent_job` gains `sourceCommentPublicId` so the thread ↔ job link is queryable both ways.
5. UI: autocomplete popover after typing `@` in the comment box (worker names + descriptions); agent replies get the agent avatar + a "view job" link.

**Done when:** typing `@breakdown-card` on a card produces an agent comment with the checklist proposal within one polling cycle of job completion; reactions persist and appear in activity + audit; a guest's mention degrades gracefully.

---

## Sprint C — Workflow engine

*Buzz: `buzz-workflow` — triggers (message/reaction/schedule/webhook) → steps → every step auditable. Workflows coordinate; agents execute.*

### C1. Schema + repo
1. `workflow` table: `id, publicId, workspaceId FK, boardPublicId?, name, enabled bool, trigger jsonb, steps jsonb, createdBy, createdAt, updatedAt, deletedAt`.
   - `trigger`: discriminated union — `card.created {listPublicId?}` · `card.moved {toListPublicId?}` · `label.added {labelPublicId?}` · `card.due {beforeHours}` · `comment.created {contains?}` · `reaction.added {emoji, onAgentComment?}` · `schedule {cron}` · `webhook {slug, secret}`.
   - `steps`: ordered array — `runWorker {worker, promptTemplate?}` · `applyPreset {requireGate: true}` (auto-apply exists ONLY behind a gate or an explicit `autoApply: true` flag defaulting false — the gap-closure plan's "no silent board mutation" guardrail carries over) · `postComment {bodyTemplate}` · `callWebhook {url}` · `gate {emoji, approvers: role|userIds, timeoutHours}` (Sprint D).
   - Template variables: `{{card.title}}`, `{{card.publicId}}`, `{{trigger.*}}`, `{{steps[n].result.*}}` — tiny mustache-subset interpolator in `packages/shared` (no eval, whitelist paths only).
2. `workflow_run` table: `id, publicId, workflowId FK, workspaceId, status enum(running|waiting_gate|completed|failed|cancelled), triggerEvent jsonb, stepResults jsonb, currentStep int, cardPublicId?, startedAt, completedAt, error`. This is the workflow twin of `agent_job`.
3. Zod schemas for trigger/steps in `packages/shared/src/workflow.ts` (client + server validation share them).

### C2. Executor
1. `packages/api/src/workflowEngine.ts`: `fireTrigger(db, event)` called from the same choke points as the audit log (recordActivity wrapper + reaction mutations + webhook route). Matches enabled workflows by workspace/board + trigger shape → creates `workflow_run` → executes steps sequentially in-process.
2. `runWorker` steps go through `dispatchWorker` with a **system operator attribution** (the workflow's `createdBy` is the responsible human — caps and permissions are checked against *them*, so a demoted creator's workflows lose power automatically, mirroring Buzz's "removing a maintainer revokes their agents"). Await job completion via the runner's `onFinish` (register a waiter keyed by jobId — no polling).
3. Loop guards: a workflow run's actions carry a `workflowRunId` marker through activity metadata; `fireTrigger` ignores events whose metadata carries a run id ≥1 hop deep (no workflow-triggers-workflow chains in v1), max 20 runs per workflow per hour, max 10 steps, per-step timeout.
4. Failure honesty: a failed step fails the run with the step index + error; partial `stepResults` preserved; everything audited.

### C3. Workflow UI + API
1. `workflow.list/create/update/delete/runs` router (`workspace:edit` to author — workflows run workers and mutate boards, member-level authoring comes later, if ever).
2. Settings → Workflows page: list with enabled toggle + run history (status, trigger summary, per-step results, link to jobs); builder form — trigger picker → step list with add/remove/reorder. Form-based, not a DAG canvas; ship the boring version.
3. Three starter templates seeded as "create from template": *Auto-triage new cards* (card.created → runWorker triage-card → gate 👍 → applyPreset), *Weekly standup digest* (schedule → runWorker standup → postComment on a target card), *Due-date nudge* (card.due 24h → postComment mention).

**Done when:** creating "on card created in *Inbox* → run triage → wait for 👍 → apply" from the template works end-to-end on a real board; runaway loops are impossible by construction; every run is inspectable step-by-step.

---

## Sprint D — Approval gates: reactions close the loop

*Buzz: "posts for review, gets a 👍 reaction, and ships. Every step signed."*

### D1. Gate step
1. Executor hits a `gate` step → posts an agent-authored comment on the target card ("**Approval needed** — react 👍 to apply: move to *Doing* + label *bug*. Expires in 24h.") → sets run `waiting_gate` with `gateCommentPublicId` + deadline → parks (no process held; state is in the DB, so restarts are safe).
2. `card.addReaction` checks: is this comment a live gate? Reactor must satisfy the gate's `approvers` spec **and** hold the permission the gated actions need (re-checked at fire time, not gate-creation time). 👍 → resume run, execute the gated `applyPreset` through `applyJobActions` attributed to the **approver** (they are the human who authorized the mutation — exactly the operator-apply model, now one reaction away). ❌ → run `completed` with `gateRejected`.
3. Expiry: piggyback on the existing reaper cadence — `ensureAgentInfra` boot pass + a check when any gate-bearing card loads: past-deadline gates → run `failed: "gate expired"`, comment edited to say so.
4. Direct-mention proposals (Sprint B) upgrade to the same mechanism: agent proposal comments carry an implicit single-approver gate, so 👍-to-apply works outside workflows too. One code path.

### D2. Gate UX
1. Gate comments render distinctly (accent border, action summary chips, Approve/Reject buttons that just add the reaction — buttons and reactions are the same signal).
2. Board indicator: cards with pending gates get a small badge; jobs/workflow-runs pages show `waiting_gate` prominently.
3. Notification hook: pending-gate event dispatched to existing outbound webhooks (`webhook` table) so operators can wire Slack/etc. No push infra built.

**Done when:** the full Buzz release-flow shape works in Kr8Kan terms — agent proposes on the card, human reacts 👍, board mutates, and the audit chain shows propose → approve → apply as three linked entries with the right actors.

---

## Sprint E — Personas: workspace-defined custom workers

*Buzz: `buzz-persona` agent packs; agents with distinct identity and capability.*

### E1. Custom worker definitions
1. `custom_worker` table: `id, publicId, workspaceId FK, name (slug, collision-checked against stock registry), title, description, avatar, systemPrompt text, needs enum, outputMode enum(freeform|schema), schemaWorker? (borrow a stock schema: draft-card|triage-card|breakdown-card|standup|summarize-board), promptVersion int (auto-bump on prompt edit), createdBy, deletedAt`. **No `allowTools` — custom workers are advisory-only.** Tool access stays exclusive to the audited stock `dev-task`.
2. Registry becomes two-source: `getWorker(db, workspaceId, name)` resolves stock first, then custom. Runner unchanged — custom workers pass their prompt text instead of a promptFile (add `systemPromptOverride` to `RunWorkerInput`).
3. `outputMode: schema` reuses the borrowed stock parser + apply preset wholesale (a custom "bug-triager" that emits the triage schema gets move+label apply for free). `freeform` behaves like `custom`: comment/copy only.
4. Each custom worker gets its `agent_identity` row (Sprint A) — its comments and applies carry its own name and avatar.
5. `agent.customWorkers` CRUD router (`agent:manage`); prompt length caps; `redactForModel` on stored prompts at run time same as everything else.

### E2. Surfacing
1. WorkerRunner + `@mention` autocomplete list custom workers alongside stock (distinct "custom" chip). Workflows can reference them in `runWorker` steps.
2. Settings → Agents: "Create worker" flow — name, avatar, needs, prompt editor with the schema-contract snippet auto-appended when a schema is borrowed (operator writes personality, the output contract is injected, not hand-copied — prompt/schema drift impossible by construction).
3. Export/import a worker as JSON ("persona pack") for sharing between workspaces/instances.

### E3. Full-text search
1. Postgres FTS: generated `tsvector` columns + GIN indexes on `card (title, description)`, `comment (comment)`, `agent_job (result_raw)`. PGlite supports FTS — same migration works in dev.
2. `search.query` router (`workspace:view`, results filtered to boards the caller can see) returning typed hits (card/comment/agent-result) with headline snippets.
3. UI: search already has a CommandPalette — extend it: query > 2 chars hits the endpoint, grouped results, deep-link (card opens with comment scrolled into view; agent results open the job).

**Done when:** a workspace can create "@release-scribe" with its own face and prompt, mention it on a card, gate-approve its output — all without touching code; searching a phrase finds it whether it lives in a card, a comment, or an old agent result.

---

## Sprint F — Scheduler, JSON CLI, ops

### F1. Schedule triggers for real
1. In-process scheduler in `workflowEngine.ts` (same deployment honesty as the runner: `runnerMode: "in-process"`, one instance): on boot + hourly, scan enabled `schedule` workflows, compute next-due from a minimal 5-field cron parser (`packages/shared/src/cron.ts` — no dependency), fire due ones. `lastFiredAt` on the workflow row makes catch-up idempotent across restarts; misses while down fire once on boot if still within 1h grace, else skip (documented).
2. `card.due` triggers ride the same hourly scan (query cards due within `beforeHours`, dedupe via a `workflow_run` uniqueness check per card+workflow+dueDate).

### F2. CLI + REST parity
1. `pi-worker.sh --json`: machine mode — suppress progress prose, emit exactly one JSON object (job terminal state) on stdout; errors as JSON on stderr. Buzz's "JSON in / JSON out, designed for LLM tool calls" — Kr8Kan's own CLI becomes usable *as an MCP-style tool by other agents*.
2. `POST /api/v1/workflows/{slug}/trigger` (webhook trigger, per-workflow secret header) — external CI/systems can fire workflows, mirroring Buzz's webhook triggers.
3. `scripts/kr8kan-audit.sh`: fetch + verify the audit chain from the CLI (`jq`-based, exit 0/1) — operators can cron an integrity check.

### F3. Ops + docs
1. Metrics in structured logs: workflow runs fired/completed/failed, gates approved/rejected/expired, mention dispatches, search queries.
2. `docs/WORKFLOWS.md`: trigger/step reference, template gallery, loop-guard semantics, the honest single-instance note. `docs/AGENTS-DEPLOYMENT.md` gains the scheduler section.
3. Tests throughout (per-sprint, listed here once): audit chain append/verify + tamper detection; reaction toggling; mention parser (registry + custom + guest degradation); trigger matching + loop guards; template interpolator (whitelist, no injection); gate approve/reject/expire incl. permission re-check; custom-worker resolution + schema borrowing; cron parser; FTS query shapes. Integration: template workflow end-to-end against the mock-pi fixture binary.

---

## Non-goals (guardrails — do not "fix" by accident)

No Nostr/cryptographic identity (hash chain ≠ signatures; integrity yes, non-repudiation no — say so in docs) · no chat channels/DMs/huddles/canvases · no git hosting or patch events · no relay federation/multi-tenant domains · no reputation/web-of-trust · no tools for custom workers · no auto-apply without a gate or explicit default-off flag · no workflow-triggers-workflow chains (v1) · no new AI vendor coupling — everything still runs through the operator's Pi.

## Exit criteria (definition of harvested)

1. Agent actions carry agent identity end-to-end; humans and agents are visually and auditably distinct actors (A).
2. One per-workspace hash-chained audit log covering human + agent mutations, with working tamper detection (A).
3. `@worker` in a card comment → agent replies in-thread with an applyable proposal (B).
4. 👍 reaction applies a gated proposal; the chain shows propose → approve → apply (B/D).
5. A non-programmer can assemble trigger → worker → gate → apply from templates and watch each run step-by-step (C).
6. Workspaces can mint custom advisory workers with borrowed schemas and full apply support, no code (E).
7. FTS finds content across cards, comments, and agent results (E).
8. Schedules fire without external cron; webhooks fire workflows; CLI speaks pure JSON (F).

## Sequencing rationale

A first: identity + audit are substrate — B's agent comments and D's approval provenance are hollow without attribution and the chain. B before C: mentions prove the dispatch-and-reply-in-thread loop that workflow `runWorker` steps and gate comments reuse. C before D: gates are a step type; the executor must exist. E after D: custom workers inherit mention + gate machinery for free, so building them earlier would mean building them twice. F last: scheduler and CLI polish harden a working system.

## Risk notes

- **Executor/runner coupling:** workflow engine lives in `packages/api` beside `agentApply`, driving the runner only through `dispatchWorker` + `onFinish` waiters — `packages/agents` stays db-free and workflow-ignorant.
- **Trigger fan-out cost:** `fireTrigger` on every activity write must be cheap — one indexed query on `(workspaceId, enabled)` with in-memory trigger matching; measure before caching.
- **Gate authority drift:** approver permission is re-checked at reaction time, not gate creation; a demoted member's 👍 does nothing. Test explicitly.
- **Hash-chain write contention:** per-workspace tail lock serializes audit appends; fine at self-host scale, revisit (batch/sequence table) only if it ever shows in logs.
- **Prompt-injection via templates:** interpolator is whitelist-paths-only, output re-passed through `redactForModel`; card content reaching prompts is already the trust model today — no new surface, but state it.
- **Buzz drift:** Buzz is pre-1.0 and moving; we harvest *shapes* (event log, gates-as-reactions, personas), not wire compatibility. Nothing here breaks if Buzz changes.
