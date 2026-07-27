# Kr8Kan — Complete Test Checklist

Every testable behavior in the system. Status legend:
✅ verified live through the running app · 🔶 covered by automated tests only · ⬜ never exercised

Last updated: 2026-07-27 (second pass — live agent-loop session; see Session findings at the bottom).

## 1. Auth & Session

- ✅ Sign-up with email + password (browser form → onboarding)
- ✅ Sign-up from 127.0.0.1 origin (Mac app) — trusted-origin fix
- ✅ Sign-in with email + password
- ✅ Magic-link sign-in (logged link followed → 302 → session minted)
- ✅ Magic-link sign-UP (first link created pi-tester@kr8kan.local)
- ⬜ Forgot-password → email/log link → reset page → sign in with new password
- ⬜ Reset with expired/invalid token (error card renders)
- ✅ Sign-out (button) — works even with a dead session
- ✅ Ghost/stale cookie: auto-clean at middleware, public pages still render
- ✅ Middleware validates sessions (not just cookie presence)
- ✅ Dead-session mid-visit self-heal (provider redirects to /login)
- ✅ Session persists across reloads
- ⬜ Sign-up lock (NEXT_PUBLIC_DISABLE_SIGN_UP=true) blocks strangers
- 🔶 Sign-up lock EXCEPTION: invited email may still create an account
- ⬜ Domain allowlist (BETTER_AUTH_ALLOWED_DOMAINS) rejects other domains
- ✅ Account page: display-name update persists
- ✅ Email field locked by design
- ⬜ Session expiry after its natural lifetime

## 2. Workspace & Members

- ✅ Onboarding creates first workspace
- ⬜ Workspace rename + description edit
- ⬜ Workspace settings: judgeEnabled toggle (gates the eval layer)
- ⬜ Workspace soft-delete
- ⬜ Multi-workspace: create second, switcher, per-workspace isolation
- ⬜ Member list renders (roles, avatars)
- 🔶 Guest email redaction in member list
- ⬜ Role change admin↔member↔guest (instant permission change)
- ⬜ Remove member
- ✅ Last-admin protection: demote blocked (live-tested)
- ✅ Last-admin protection: leave blocked (live-tested)
- 🔶 Last-admin protection: remove blocked
- ⬜ Leave workspace as non-admin (button → back to /boards)
- ⬜ Invite: open link (no email) — second account joins at set role
- ✅ Invite: email-targeted rejected for the wrong account (live-tested)
- ⬜ Invite: email-targeted accepted by the right account
- 🔶 Invite: already-a-member accept is a no-op (invite not burned)
- 🔶 Invite: deleted-workspace invite rejected
- ⬜ Invite expiry (7 days)
- 🔶 Invite revoke (cross-workspace scoping enforced)
- ⬜ Permissions page renders the role matrix

## 3. Boards, Lists, Cards (core kanban)

- ✅ Board create (default lists appear)
- ⬜ Board rename / update
- ⬜ Board delete (confirm) → trash → restore
- ⬜ PUBLIC board visibility + anonymous /p/<board> page
- ⬜ List create / rename
- ⬜ List drag-reorder
- ✅ List delete confirm dialog (copy warns about cards)
- ⬜ List restore from trash (cards reappear)
- ✅ Card create
- ⬜ Card title/description edit (markdown editor)
- ✅ Card drag between lists (optimistic move)
- ⬜ Card drag within a list (reorder)
- ✅ Cross-board move rejected (API guard)
- ⬜ Due date set/clear + overdue badge
- ✅ Card delete confirm → trash → restore (restore chain re-opens list/board)
- ✅ Labels: create, edit (rename), delete w/ confirm — no ghost chips
- ⬜ Label colour edit
- ⬜ Card members assign/unassign (avatar stack)
- ✅ Checklists: create, add item, toggle complete, delete item ✕, delete checklist
- ⬜ Attachments: S3-unconfigured message; with S3 → upload/download/delete
- ✅ Comments: add (deep-graph verified)
- ⬜ Comment edit / delete
- ✅ Reactions: all six emoji on cards; duplicate-react is a no-op (no trigger replay)
- ✅ Reaction remove (un-react) — live-tested on a gate comment (remove then re-add re-fired the gate)
- ✅ Activity trail records events
- ⬜ Card templates: save card as template, instantiate from composer, label-name resolution
- ✅ Board note (agent-written via workflow verified; ⬜ human edit)
- ⬜ Trash 30-day window display; multi-entity trash page
- ✅ Board deep payload (lists→cards→labels/members/badges) renders

## 4. Search (⌘K)

- ✅ Card + comment + message hits, workspace-scoped
- ⬜ Agent-result hits (needs jobs with results; deep-link to /settings/agents?job=)
- 🔶 Guest cannot see agent-result snippets
- ✅ Debounced input (300ms)
- ⬜ No-match / short-token behavior

## 5. Channels (chat)

- ✅ Channel create
- ⬜ Channel topic/rename, archive, delete → trash → restore (message restore re-opens channel)
- ✅ Post root message
- ✅ Threaded reply (replyCount + thread view)
- ✅ Message reactions
- ⬜ Message edit / delete
- ⬜ @worker mention in a channel message (dispatch + threaded agent reply)
- ⬜ /my channel-activity feed (mentions of you, replies in your threads)
- ⬜ Message pagination (cursor, older pages)

## 6. Pi AI Workers (the differentiator)

Workers: summarize-board · draft-card · triage-card · breakdown-card · standup · dev-task · diagnostician · judge · eval-reviewer · custom

- ✅ summarize-board end-to-end (owner-dispatched, 19s, real summary, parsed JSON)
- ⬜ draft-card (proposes a card; apply creates it)
- ⬜ triage-card (labels/priority proposal + 👍 apply)
- ⬜ breakdown-card (checklist proposal + 👍 apply)
- ⬜ standup (board digest → board note)
- ⬜ diagnostician (read-only investigation in linked repo)
- 🔶 **dev-task against a LINKED PROJECT FOLDER** — both modes verified EXCEPT the proposal surface (bug below):
  - ✅ board settings: set Project folder (owner linked /Users/kcdacre8tor/testprojectfolder)
  - ✅ non-git folder: manual dispatch downgraded to live-edit; agent wrote README.md to the real folder (verify: pass)
  - ✅ sandbox worktree run → patch captured (job rdsnp8, '1 file changed, +1 −0'), live files untouched until apply
  - ✅ apply gated behind human action (patch parked, applied_at null until approval)
  - ✅ apply landed CHANGES.md in the live folder (via REST apply-patch; 👍-on-comment path still ⬜)
  - ✅ patch posted as 👍-gated proposal comment on the card — was broken (Bug 1), FIXED this session; proposal with diff preview + "React 👍 to apply" verified live
  - ✅ 👍 on the proposal applied the patch to the live folder (CHANGES.md gained the proposed line); stale-patch conflict path also verified: clean refusal, "⚠️ Patch not applied" follow-up comment, approval honesty fixed (Bug 4)
  - ⬜ apply-failure feedback (toast reason: stale/eval-blocked/truncated)
  - ✅ verify step ran (verify_status: pass on job v6m2bh8dpi)
  - ⬜ browser verification (agent screenshots dev-server URL, console check)
  - ⬜ 256KB patch cap → truncated flag → apply blocked
- 🔶 @mention dispatch from card comment (incl. case-insensitive @Dev-Task) — dispatch verified live (sandboxed job ran, verify pass); **agent thread reply never posted (same stale-read bug)**
- ⬜ mention skip reasons (guest mention, caps) surface as toasts
- ⬜ judge mode (workspace judgeEnabled): judge annotation on results, eval gate blocks bad applies
- ⬜ eval-reviewer worker
- ⬜ custom worker: create persona in settings/agents, dispatch it, borrowed schema apply
- ⬜ cancel a running job (SIGKILL; sandbox discarded)
- ⬜ per-user caps: max active jobs (3), hourly cap (30) — friendly errors
- ⬜ per-folder lock (two dev-tasks on one folder queue/refuse)
- ⬜ orphan reaper marks stale running jobs on boot
- ⬜ CLI: scripts/pi-worker.sh dispatch + 16-min poll window
- ✅ REST: apply-patch via API key (200, patch applied); /agents/jobs listed
- ⬜ agent identities: per-worker avatar/name rendered on comments/replies

## 7. Workflow Automation

Triggers (12): card.created · card.moved · label.added · card.due · comment.created · reaction.added · message.posted · schedule · webhook · job.failed · job.verify_failed · workflow.run.failed
Steps (9): runWorker · gate · applyPreset · postComment · postNote · postMessage · callWebhook · checkUrl · captureScreenshot

- ✅ card.created trigger → postNote step (end-to-end incl. {{card.title}} interpolation)
- ✅ card.created trigger → runWorker(triage-card) → 👍 gate → applyPreset: FULL LOOP VERIFIED after the Bug 1/5 fixes (run e7vtabkd9x25: worker ok → waiting_gate + approval comment → 👍 resumed → applyPreset "2 actions" → completed)
- ✅ gate step: approve with 👍 resumes the run (approver recorded); expiry set 24h out; rejection ❌ path still ⬜
- ⬜ card.moved / label.added / comment.created / reaction.added triggers
- ⬜ card.due trigger (scheduler scan, beforeHours window, dedupe)
- ⬜ message.posted trigger (channel workflows)
- ⬜ schedule trigger (cron; hourly tick; sub-hourly caveat)
- ⬜ webhook trigger (REST slug endpoint fires a workflow)
- ⬜ sentinel triggers: job.failed / job.verify_failed / workflow.run.failed (self-healing loop)
- ⬜ runWorker step (advisory + dev-task sandbox-mandatory)
- ⬜ gate step: approve with configured emoji / reject with ❌ (+ reason comment)
- 🔶 gate double-approve race (claim token)
- ⬜ gate expiry (timeoutHours → failed + notices)
- ⬜ applyPreset step (autoApply true/false)
- ⬜ postComment / postMessage steps
- ✅ postNote step
- ⬜ callWebhook / checkUrl / captureScreenshot steps (90s step timeout)
- 🔶 rate cap 20 runs/hr (best-effort re-check)
- 🔶 reaper: no-progress-1h runs failed via failRun (audit + sentinel fire)
- ⬜ loop guards: no chains, 10-step cap, sentinel depth-1
- 🔶 workflow CRUD UI: create-from-template ✅ (Auto-triage, board-scoped) · Disable button click had no visible effect (disabled OK via trpc) · runs list showed "No runs yet" although a failed run existed in the store

## 8. Outbound Webhooks

- ✅ Create → one-time secret reveal → masked list
- ⬜ Rotate secret (UI button)
- ✅ Delete
- ✅ HMAC delivery signature verified independently (timestamp.body recompute)
- ✅ Events fire: card.created, card.moved, card.deleted
- ⬜ Events fire: workflow.gate.opened, workflow.run.failed
- ⬜ Unsigned legacy hook (no secret) still delivers
- ⬜ Receiver timeout/failure doesn't block the app (fire-and-forget)

## 9. Audit Log

- ✅ Events land with hash chain (12+ events, verified intact)
- ✅ verifyChain exact (tamper + gap detection — automated tests)
- ✅ Actor names render in the UI
- ⬜ Filters (event type, entity, actor) in the audit page
- ⬜ Export JSON walks the FULL chain (beforeSeq pagination)
- ⬜ scripts/kr8kan-audit.sh cron verify (exit codes) with an API key
- ⬜ Audit page pagination on long histories

## 10. Settings Surfaces

- 🔶 Role-gated settings nav (admin-only pages hidden from members/guests)
- ⬜ Guest/member actually browsing settings (no raw FORBIDDEN anywhere)
- ✅ Integrations page: SMTP/S3 status chips
- ⬜ Send-test-email button (unconfigured message path; configured send path)
- 🔶 API keys page: create key ✅ (one-time reveal, masked list), used via REST with Bearer AND x-api-key ✅; revoke still ⬜
- ⬜ Workspace settings page (name/desc/judge toggle/danger zone)
- ⬜ Templates page CRUD
- ⬜ Agents settings: job history, usage stats, custom worker editor

## 11. REST API (OpenAPI surface)

- ✅ GET /health (liveness) · ✅ GET /ready (probes NCB)
- ✅ API key auth works (/me, /workspaces, /boards/{id} 200; validation + 401s behave); full CRUD sweep still partial
- ⬜ RBAC inheritance through API keys (guest key can't write)
- ✅ OpenAPI schema served (/api/v1/openapi.json 200)
- ⬜ Rate limit 100 req/min behavior

## 12. Infrastructure & Resilience

- ✅ NCB data store round-trip (all 33 tables in production use)
- ✅ Read-after-write overlay on updates; insert read-retry
- 🔶 Idempotent create retry on NCB 5xx (probe-by-unique-key)
- ⬜ NCB fully unreachable: requests fail fast (15s cap), /ready flips, UI shows sanitized "data store unavailable"
- 🔶 Silent-truncation warning at 100k rows
- ✅ Secrets: NCB_SECRET_KEY never in browser; scrubbed from pi env (test-enforced)
- ⬜ Server restart mid-workflow → reaper + scheduler recovery (partially 🔶)
- ✅ Mac app launches (icon fixed); ⬜ macapp serves correctly after reboot
- ⬜ Dev-server restart while user is active (session survives)

## 13. Responsive / UI Quality

- ✅ Modal viewport containment (root fix — Run button reachable; owner-confirmed)
- ⬜ Every overlay at 320×568 (worker runner, palette, dropdowns, sheets)
- ⬜ Phone-size pass: board DnD, card drawer→sheet, channels, settings tables
- ⬜ No horizontal page scroll at any width ≥320px (sweep applied 🔶, visual pass pending)
- ⬜ Dark/light theme parity on all new surfaces
- ⬜ Keyboard: ⌘K, Esc closes overlays, form Enter submits
- ⬜ Empty states (fresh board, no jobs, no webhooks, empty trash)
- ⬜ Long-content stress: 100-card list, 50-comment card, giant paste in a comment

## 14. Multi-User (needs a second human/browser)

- ⬜ Second account joins via invite link, sees shared board
- ⬜ Concurrent card edits/moves (last-write + optimistic UI behavior)
- ⬜ Guest experience end-to-end (read-only-ish surface, no emails, no agent snippets)
- ⬜ Two approvers reacting to one gate simultaneously (claim token in anger)
- ⬜ Notifications bell across users

---

**Suggested order of attack:** fix Bug 1 below first (it dead-ends every agent surface) → §7 gates + sentinels re-test → §14 with a friend → §13 visual pass → the long tail.

---

## Session findings — 2026-07-27 live agent-loop pass (fresh account pi-tester@kr8kan.local, workspace "Pi Test Lab", board "Dev Loop" linked to /Users/kcdacre8tor/testprojectfolder)

**Bug 1 — FIXED this session** (`packages/agents/src/runner.ts`: onFinish now receives the in-memory merged job instead of a store re-read; both the main finalize path and the sandbox-failure path). Verified: audit now records true status, proposal comments post, 👍 apply works, workflow runWorker steps pass. Original description:
All three `agent.run.completed` audit events recorded `payload.status: "running"`. The runner (`packages/agents/src/runner.ts` ~line 799) does `store.update(job.id, patch)` then `store.get(job.id)` and hands that re-read row to `onFinish`; with the NCB-backed store (`packages/api/src/agentStore.ts` → `updateWhere` then `findFirst`) the re-read returns the pre-update row. Because `finished.status === "completed"` is then false (and `result`/`patch` missing), `dispatchWorker`'s branches all skip **silently**: no patch-proposal comment, no @mention agent reply, no eval gate, no `job.failed` sentinel event; workflow `runWorker` steps fail with `job <id> running:` (run xn7vgxuiqav8). Job records themselves are complete and correct in the store afterwards — only the snapshot handed to `onFinish` is stale.
*Fix suggestion:* `updateJob` already returns the updated row from `updateWhere` — return it through `store.update` (or merge `{...job, ...patch}` in memory) instead of re-reading.

**Bug 2: `workflow.run.failed` audit append failed — NCB 500 "Error creating record"** (10:41:10, workspace 7). The audit event was lost; hash-chain gap risk. Other audit appends in the same session succeeded.

**Bug 3 (UX): card create silently succeeds without UI update.** Two composer submits (click + Enter) created cards server-side but the board never showed them until a full reload → user re-submits → triple duplicate cards ("Create a README.md…" ×3 on Dev Loop).

**UX nits:** `/settings/agents` renders "Pi runtime unavailable / Workers enabled: no / Project roots (0)" as pre-hydration fallback for 10–15 s before flipping to the real healthy status — reads as an outage. Workflows "Recent runs" shows "No runs yet" while a run exists (slow/failed hydration). NCB round-trips of 2–4 s make many panels (worker picker, card drawer, comments) appear broken before they populate.

**Verified working this session (highlights):** magic-link sign-up → onboarding → board+channel create · project-folder validation UI with verify command + Dev URL fields · live-edit downgrade on non-git folder (banner, real-file write, "live edit" badge) · sandbox worktree run on git folder ("sandboxed" badge, live tree untouched, patch captured) · verify command pass badges on both modes and on apply · REST apply-patch applied the parked sandbox patch to the live folder and re-ran verify · case-insensitive `@Dev-Task` mention dispatch · first-tools-run confirmation gate · job notifications + card deep-link · workflow create-from-template + card.created trigger firing · API keys (one-time reveal; Bearer + x-api-key) · OpenAPI schema · REST card create · unauth 401.
