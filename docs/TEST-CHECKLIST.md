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
- 🔶 Forgot-password: reset request + link-in-log verified live; **reset page rejects VALID tokens** (renders 'Invalid reset link' — Bug S1), so the flow dead-ends
- ✅ Reset with expired/invalid token (error card rendered, 200)
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
- ✅ Workspace rename + description edit (rename + desc round-trip verified; NCB read lag needs the documented 3s retry)
- ✅ Workspace settings: judgeEnabled toggle (enabled live; judge annotation/eval fields appeared on the next proposal job; disabled after)
- ⬜ Workspace soft-delete
- ✅ Multi-workspace: second workspace hy499v3radkq, switcher data via workspace.list, board isolation verified both directions (verifier-confirmed)
- ✅ Member list renders (both users with roles via member.list)
- ✅ Guest email redaction in member list (verified live as guest)
- ✅ Role change member↔guest flips a real permission instantly (card.create allowed/refused; verifier-confirmed)
- ✅ Remove member (admin removal verified; member.list shrank)
- ✅ Last-admin protection: demote blocked (live-tested)
- ✅ Last-admin protection: leave blocked (live-tested)
- 🔶 Last-admin protection: remove blocked
- ✅ Leave workspace as non-admin (API-level; verifier-confirmed)
- ✅ Invite: open link — two accounts joined ws at member + guest roles (live)
- ✅ Invite: email-targeted rejected for the wrong account (live-tested)
- ✅ Invite: email-targeted accepted by the right account (verifier-confirmed)
- 🔶 Invite: already-a-member accept is a no-op (invite not burned)
- 🔶 Invite: deleted-workspace invite rejected
- ⬜ Invite expiry (7 days)
- 🔶 Invite revoke (cross-workspace scoping enforced)
- ⬜ Permissions page renders the role matrix

## 3. Boards, Lists, Cards (core kanban)

- ✅ Board create (default lists appear)
- ✅ Board rename / update (round-trip read-back)
- ✅ Board delete → trash → restore (verifier-confirmed; confirm-dialog UI not exercised)
- ✅ PUBLIC board visibility + anonymous /p/<board> 200; private board publicView refused (verifier-confirmed)
- ✅ List create / rename
- ✅ List reorder (list.reorder API verified; drag gesture itself not exercised)
- ✅ List delete confirm dialog (copy warns about cards)
- ✅ List restore from trash — cards reappeared (verifier-confirmed)
- ✅ Card create
- ✅ Card title/description edit (API round-trip; markdown editor UI not exercised)
- ✅ Card drag between lists (optimistic move)
- ✅ Card reorder within a list (card.move same-list index verified)
- ✅ Cross-board move rejected (API guard)
- ✅ Due date set/clear (API round-trip; overdue badge visual not exercised)
- ✅ Card delete confirm → trash → restore (restore chain re-opens list/board)
- ✅ Labels: create, edit (rename), delete w/ confirm — no ghost chips
- ✅ Label colour edit
- ✅ Card members assign/unassign (avatar stack visual not exercised)
- ✅ Checklists: create, add item, toggle complete, delete item ✕, delete checklist
- ⬜ Attachments: S3-unconfigured message; with S3 → upload/download/delete
- ✅ Comments: add (deep-graph verified)
- ✅ Comment edit / delete
- ✅ Reactions: all six emoji on cards; duplicate-react is a no-op (no trigger replay)
- ✅ Reaction remove (un-react) — live-tested on a gate comment (remove then re-add re-fired the gate)
- ✅ Activity trail records events
- ✅ Card templates: create from card, instantiate, label-name resolution across boards
- ✅ Board note (agent-written via workflow AND human edit via board.updateNote — both verified)
- ✅ Multi-entity trash page (boards/lists/cards/channels/messages listed simultaneously; verifier-confirmed). 30-day window display not exercised
- ✅ Board deep payload (lists→cards→labels/members/badges) renders

## 4. Search (⌘K)

- ✅ Card + comment + message hits, workspace-scoped
- ✅ Agent-result hits with deep-link (verifier-confirmed)
- 🔶 Guest cannot see agent-result snippets
- ✅ Debounced input (300ms)
- ✅ No-match returns empty; 1-char token rejected by validation

## 5. Channels (chat)

- ✅ Channel create
- ✅ Channel archive (posts rejected: 'this channel is archived') + delete → trash → restore: messages returned and channel reopened for posting (verifier-confirmed, channel rtwxnrt9u5h9)
- ✅ Post root message
- ✅ Threaded reply (replyCount + thread view)
- ✅ Message reactions
- ✅ Message edit / delete (editedAt stamped; delete soft-trashes)
- ⬜ @worker mention in a channel message (dispatch + threaded agent reply)
- ✅ /my channel-activity feed — mention + thread-reply rows with deep-link fields (verifier-confirmed). Caveat Bug S8: mentions never match users with an empty display name
- 🔶 Message pagination: cursor pages fetched with no overlap, **but verifier found one 200-posted message missing from every surface incl. trash** (Bug S2 — possible silent write loss)

## 6. Pi AI Workers (the differentiator)

Workers: summarize-board · draft-card · triage-card · breakdown-card · standup · dev-task · diagnostician · judge · eval-reviewer · custom

- ✅ summarize-board end-to-end (owner-dispatched, 19s, real summary, parsed JSON)
- ✅ draft-card (structured proposal in job result verified)
- ✅ triage-card (completed with parsed result; actions applied via workflow applyPreset)
- ✅ breakdown-card — checklist items landed on the card after apply (verifier-confirmed)
- ❌ standup: job completes but **no board note is written** (Bug S9)
- ✅ diagnostician ran via the sentinel chain; **but finding fields render empty** — parseError 'no fenced json block' → template interpolation empty (Bug S5)
- 🔶 **dev-task against a LINKED PROJECT FOLDER** — both modes verified EXCEPT the proposal surface (bug below):
  - ✅ board settings: set Project folder (owner linked /Users/kcdacre8tor/testprojectfolder)
  - ✅ non-git folder: manual dispatch downgraded to live-edit; agent wrote README.md to the real folder (verify: pass)
  - ✅ sandbox worktree run → patch captured (job rdsnp8, '1 file changed, +1 −0'), live files untouched until apply
  - ✅ apply gated behind human action (patch parked, applied_at null until approval)
  - ✅ apply landed CHANGES.md in the live folder (via REST apply-patch; 👍-on-comment path still ⬜)
  - ✅ patch posted as 👍-gated proposal comment on the card — was broken (Bug 1), FIXED this session; proposal with diff preview + "React 👍 to apply" verified live
  - ✅ 👍 on the proposal applied the patch to the live folder (CHANGES.md gained the proposed line); stale-patch conflict path also verified: clean refusal, "⚠️ Patch not applied" follow-up comment, approval honesty fixed (Bug 4)
  - 🔶 apply-failure feedback: stale-patch reason verified honest end-to-end; eval-blocked/truncated variants untested
  - ✅ verify step ran (verify_status: pass on job v6m2bh8dpi)
  - ⬜ browser verification (agent screenshots dev-server URL, console check)
  - ⬜ 256KB patch cap → truncated flag → apply blocked
- 🔶 @mention dispatch from card comment (incl. case-insensitive @Dev-Task) — dispatch verified live (sandboxed job ran, verify pass); **agent thread reply never posted (same stale-read bug)**
- ⬜ mention skip reasons (guest mention, caps) surface as toasts — still blocked
- ✅ judge mode: judgeEnabled toggled live, judge annotation/eval fields present on the next proposal job (verifier-confirmed); eval-gate-blocks-apply variant still ⬜
- ✅ eval-reviewer worker (completed clean)
- ✅ custom worker: created + dispatched by name (lane-e-haiku, completed; enum fix f7666d3); borrowed-schema apply still ⬜
- ❌ cancel a running job: **cancel does not stick** — verifier found the cancelled job persisted as status completed with full result + verify pass (Bug S4, runner finalize overwrites the cancel)
- ⬜ per-user caps: max active jobs (3), hourly cap (30) — friendly errors
- ✅ per-folder lock: second concurrent dev-task on the same folder refused (verifier-confirmed)
- ⬜ orphan reaper marks stale running jobs on boot
- ✅ CLI: scripts/pi-worker.sh dispatch+poll works — **but its `set -a; source .env` clobbers the caller's exported KR8KAN_API_TOKEN with the repo .env empty value (Bug S10, same in kr8kan-audit.sh)**
- ✅ REST: apply-patch via API key (200, patch applied); /agents/jobs listed
- ✅ agent identities: per-worker name/avatar on comments/replies

## 7. Workflow Automation

Triggers (12): card.created · card.moved · label.added · card.due · comment.created · reaction.added · message.posted · schedule · webhook · job.failed · job.verify_failed · workflow.run.failed
Steps (9): runWorker · gate · applyPreset · postComment · postNote · postMessage · callWebhook · checkUrl · captureScreenshot

- ✅ card.created trigger → postNote step (end-to-end incl. {{card.title}} interpolation)
- ✅ card.created trigger → runWorker(triage-card) → 👍 gate → applyPreset: FULL LOOP VERIFIED after the Bug 1/5 fixes (run e7vtabkd9x25: worker ok → waiting_gate + approval comment → 👍 resumed → applyPreset "2 actions" → completed)
- ✅ gate step: approve with 👍 resumes the run (approver recorded); expiry set 24h out; rejection ❌ path still ⬜
- ✅ card.moved (verifier-confirmed), label.added, comment.created, reaction.added triggers all fired their steps
- ⬜ card.due trigger (scheduler scan, beforeHours window, dedupe)
- ⬜ message.posted trigger (channel workflows)
- ⬜ schedule trigger (cron; hourly tick; sub-hourly caveat)
- ✅ webhook trigger: POST /api/v1/workflows/<slug>/trigger with API key started a run (verifier-confirmed)
- ✅ sentinel job.verify_failed → sentinel workflow → diagnostician → finding in board notes, full chain live (verifier-confirmed); job.failed/workflow.run.failed fired as webhook events too. Finding BODY renders empty (Bug S5)
- ✅ runWorker step (advisory verified in a completed run; dev-task-in-workflow still ⬜)
- ✅ gate approve verified live (run e7vtabkd, approved-by recorded); reject-with-reason still ⬜ live (🔶 tested)
- 🔶 gate double-approve race (claim token)
- ⬜ gate expiry (timeoutHours → failed + notices) — untested
- ✅ applyPreset applied 2 actions after gate approval (run e7vtabkd); autoApply variant still ⬜
- ✅ postComment / postMessage steps (with interpolation). Caveats: {{steps.N.result...}} interpolation renders empty even when the job has a result (Bug S11); concurrent postNote appends can lose one update (Bug S12)
- ✅ postNote step
- 🔶 callWebhook step delivered to a live local receiver and completed; checkUrl / captureScreenshot untested (browser env off)
- 🔶 rate cap 20 runs/hr (best-effort re-check)
- 🔶 reaper: no-progress-1h runs failed via failRun (audit + sentinel fire)
- ✅ loop guard no-chains verified live (workflow-caused comment did not trigger comment.created workflows; verifier-confirmed); 10-step cap + sentinel depth untested
- 🔶 workflow CRUD UI: create-from-template ✅ (Auto-triage, board-scoped) · Disable button click had no visible effect (disabled OK via trpc) · runs list showed "No runs yet" although a failed run existed in the store

## 8. Outbound Webhooks

- ✅ Create → one-time secret reveal → masked list
- ✅ Rotate secret — old secret stops validating, new validates (verifier-confirmed)
- ✅ Delete
- ✅ HMAC delivery signature verified independently (timestamp.body recompute)
- ✅ Events fire: card.created, card.moved, card.deleted
- ✅ Events fire: workflow.gate.opened, workflow.run.failed (verifier-confirmed)
- ⬜ Unsigned legacy hook — blocked: create path now requires a secret; legacy-row case not reproducible via API
- ✅ Receiver timeout/blackhole: triggering request returns promptly (one unexplained 31s outlier on first post-enable request, not reproduced)

## 9. Audit Log

- ✅ Events land with hash chain (12+ events, verified intact)
- ✅ verifyChain exact (tamper + gap detection — automated tests)
- ✅ Actor names render in the UI
- ⬜ Filters (event type, entity, actor) in the audit page
- ✅ auditLog beforeSeq pagination walked to chain start, no seq gaps (verifier-confirmed); auditVerify intact
- ❌ scripts/kr8kan-audit.sh exits 1 even with KR8KAN_API_TOKEN exported — `set -a; source .env` clobbers it with the repo's empty value (Bug S10)
- ⬜ Audit page pagination on long histories

## 10. Settings Surfaces

- 🔶 Role-gated settings nav (admin-only pages hidden from members/guests)
- 🔶 Guest browsing: API denials clean+readable (card:create/workspace:edit/webhook:manage all correct); full UI walk pending
- ✅ Integrations page: SMTP/S3 status chips
- ⬜ Send-test-email button (unconfigured message path; configured send path)
- 🔶 API keys page: create key ✅ (one-time reveal, masked list), used via REST with Bearer AND x-api-key ✅; revoke still ⬜
- ⬜ Workspace settings page (name/desc/judge toggle/danger zone)
- ✅ Templates CRUD (API level: create/instantiate/list verified; page UI not exercised)
- ⬜ Agents settings: job history, usage stats, custom worker editor

## 11. REST API (OpenAPI surface)

- ✅ GET /health (liveness) · ✅ GET /ready (probes NCB)
- ✅ API key auth works (/me, /workspaces, /boards/{id} 200; validation + 401s behave); full CRUD sweep still partial
- ✅ RBAC inheritance through API keys (guest key denied card.create via REST, clean message)
- ✅ OpenAPI schema served (/api/v1/openapi.json 200)
- ✅ Rate limit 100 req/min (burst tripped it; clear rejection message)

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

- ✅ Second + third accounts joined via invite links (member + guest in one workspace)
- ⬜ Concurrent card edits/moves (last-write + optimistic UI behavior)
- 🔶 Guest experience: role denials verified live across card/workflow/webhook surfaces; email/snippet redaction automated-only
- ⬜ Two approvers reacting to one gate simultaneously (claim token in anger)
- ✅ Notifications bell across users (admin mention → account-2 notifications; verifier-confirmed)

---

**Suggested order of attack:** fix Bug 1 below first (it dead-ends every agent surface) → §7 gates + sentinels re-test → §14 with a friend → §13 visual pass → the long tail.

---

## Session findings — 2026-07-27 live agent-loop pass (fresh account pi-tester@kr8kan.local, workspace "Pi Test Lab", board "Dev Loop" linked to /Users/kcdacre8tor/testprojectfolder)

**Bug 1 — FIXED this session** (`packages/agents/src/runner.ts`: onFinish now receives the in-memory merged job instead of a store re-read; both the main finalize path and the sandbox-failure path). Verified: audit now records true status, proposal comments post, 👍 apply works, workflow runWorker steps pass. Original description:
All three `agent.run.completed` audit events recorded `payload.status: "running"`. The runner (`packages/agents/src/runner.ts` ~line 799) does `store.update(job.id, patch)` then `store.get(job.id)` and hands that re-read row to `onFinish`; with the NCB-backed store (`packages/api/src/agentStore.ts` → `updateWhere` then `findFirst`) the re-read returns the pre-update row. Because `finished.status === "completed"` is then false (and `result`/`patch` missing), `dispatchWorker`'s branches all skip **silently**: no patch-proposal comment, no @mention agent reply, no eval gate, no `job.failed` sentinel event; workflow `runWorker` steps fail with `job <id> running:` (run xn7vgxuiqav8). Job records themselves are complete and correct in the store afterwards — only the snapshot handed to `onFinish` is stale.
*Fix suggestion:* `updateJob` already returns the updated row from `updateWhere` — return it through `store.update` (or merge `{...job, ...patch}` in memory) instead of re-reading.

**Bug 2 (open): `workflow.run.failed` audit append failed — NCB 500 "Error creating record"** (10:41:10, workspace 7). The audit event was lost; hash-chain gap risk. Other audit appends in the same session succeeded. A second NCB-insert stack trace appeared ~10:53.

**Bug 4 — FIXED this session** (`packages/api/src/workflowEngine.ts` tryApplyProposal): a clean apply refusal (patch conflict, folder lock) returned `proposalApplied: true` to the UI because `applyJobPatch`'s returned `{applied:false, detail}` was ignored — the user would see a success toast on a failed apply. Now the detail becomes the failure reason.

**Bug 5 — FIXED this session** (`packages/api/src/workflowEngine.ts` claimGate): the write-then-reread claim token check is not a CAS on NCB — a stale re-read swallowed legitimate gate approvals AND left a persisted claim that deadlocked the gate forever. Replaced with an in-process per-gate-instance claim set (engine is single-instance by design); persisted token kept as a restart marker. Verified: gate approve now resumes the run.

**Open flake:** one applyPreset step read `resultParsed` as missing seconds after gate resume although the job record had it (run mfvjmwum885e); the identical round-2 run passed. Same NCB stale-read family — worth a retry-once on that read.

**Dev-mode caveat:** every source edit under `next dev` recompiles the API bundle and kills in-flight pi jobs ("pi exited with code null"). Not a production bug; expect job casualties when editing code mid-run.

**Bug 3 (UX): card create silently succeeds without UI update.** Two composer submits (click + Enter) created cards server-side but the board never showed them until a full reload → user re-submits → triple duplicate cards ("Create a README.md…" ×3 on Dev Loop).

**UX nits:** `/settings/agents` renders "Pi runtime unavailable / Workers enabled: no / Project roots (0)" as pre-hydration fallback for 10–15 s before flipping to the real healthy status — reads as an outage. Workflows "Recent runs" shows "No runs yet" while a run exists (slow/failed hydration). NCB round-trips of 2–4 s make many panels (worker picker, card drawer, comments) appear broken before they populate.

**Verified working this session (highlights):** magic-link sign-up → onboarding → board+channel create · project-folder validation UI with verify command + Dev URL fields · live-edit downgrade on non-git folder (banner, real-file write, "live edit" badge) · sandbox worktree run on git folder ("sandboxed" badge, live tree untouched, patch captured) · verify command pass badges on both modes and on apply · REST apply-patch applied the parked sandbox patch to the live folder and re-ran verify · case-insensitive `@Dev-Task` mention dispatch · first-tools-run confirmation gate · job notifications + card deep-link · workflow create-from-template + card.created trigger firing · API keys (one-time reveal; Bearer + x-api-key) · OpenAPI schema · REST card create · unauth 401.

---

## Session findings — 2026-07-27 team sweep (12-agent workflow: 6 domain lanes + 6 adversarial verifiers; verdicts merged above)

Fixed already: custom-worker enum rejection (f7666d3). Open, ranked:

**S1 — reset-password page rejects VALID tokens.** `/reset-password?token=<valid>` renders the "Invalid reset link" card fully hydrated (token present in location.search, no console errors). Password recovery is dead end-to-end. `apps/web/src/pages/reset-password.tsx`.

**S2 — possible silent write loss (data).** One of 55 channel messages posted with a 200 ("pagination filler message number 8") is absent from channel.messages, thread view, AND trash — verifier-confirmed missing. Pattern-matches the NCB-500 audit-append loss (Bug 2). Treat NCB insert acks as suspect until root-caused.

**S3 — job cancel does not stick.** Cancelled job persisted as `completed` with full result + verify pass — the runner finalize path overwrites the operator cancel (`packages/agents/src/runner.ts`; the in-flight guard checks `cancelledJobs` before finalize but the pi process kept running and finalized after).

**S4 — standup worker writes no board note.** Job completes; board.getNote unchanged.

**S5 — sentinel/diagnostician findings render empty.** Diagnostician output had no fenced ```json block → parseError → resultParsed null → the note template's `{{steps.0.result.*}}` all interpolate to "". Chain fires perfectly, the finding is blank.

**S6 — workflow interpolation `{{steps.N.result...}}` renders empty** even when the referenced job has result/resultParsed (reproduced 3×). Related to S5.

**S7 — concurrent postNote appends lose updates.** Two near-simultaneous workflow postNote appends to one board note: one update vanished (read-modify-write race on NCB, no CAS).

**S8 — mentions never match empty-name users.** Channel mention matching is `'@'+user.name`; magic-link accounts start with name "" so they can never be mentioned until they set a display name.

**S9 — settings nav FORBIDDEN leak.** /settings/workflows nav entry shows for all roles but workflow.list is admin-gated → guests get a raw FORBIDDEN page (`SettingsLayout.tsx` missing adminOnly).

**S10 — script env clobber.** `scripts/kr8kan-audit.sh` and `scripts/pi-worker.sh` do `set -a; source .env` AFTER inheriting the caller env, so the repo's empty `KR8KAN_API_TOKEN=` overwrites the caller's exported token → both exit 1 despite correct usage.

**S11 — info disclosure to guests.** agent.listWorkers returns host filesystem project roots + runner config to workspace:view-only guests; tRPC error bodies include full server stack traces (webpack-internal paths) to any authenticated caller.

**S12 — minor.** Gate rejection persists status `completed` + error "gate rejected" instead of a distinct status; one unexplained 31s latency outlier on first request after enabling a blackholed webhook.

Still untested after this sweep: sign-up lock/domain allowlist (need env change + restart), session expiry, invite expiry (7d), attachments/S3, send-test-email, card.due + schedule triggers (need scheduler tick), gate expiry, checkUrl/captureScreenshot + browser verification (browser env off), 256KB patch cap, per-user job caps, orphan reaper + restart/resilience scenarios, NCB-unreachable, §13 visual/responsive pass, concurrent multi-user editing + simultaneous gate approvals.
