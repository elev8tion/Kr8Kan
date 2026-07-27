# Kr8Kan — User-Journey State Report v2

Re-audit of all 8 journey domains, 2026-07-27, after: the NoCodeBackend
data-store swap, the backend-features band, the band-2 safety fixes, the
docs alignment, and Docker removal. Eight parallel read-only auditors, one
per domain, each verifying the 2026-07-26 findings against current code
and hunting for regressions the swap could have introduced.

## Verdict

Everything the three bands claimed to fix is confirmed fixed in code, with
file-level evidence. The swap itself is functionally correct — no data
leaks across workspaces, RBAC reads stay fresh, the audit chain's
UNIQUE(workspace_id, seq) guard is live on the NCB instance (verified by a
rejected duplicate insert). The new risk surface clusters in three themes:

1. **Secrets & resilience (one CRITICAL, fixed same-day):** the NCB master
   key was missing from the Pi worker env scrub — fixed in this commit.
   The HTTP layer has no timeouts and retries non-idempotent writes.
2. **No-transaction races:** gate double-fire, rate-cap overshoot,
   read-merge-write on applied actions, last-admin check-then-act.
3. **Whole-table REST reads on hot paths:** card/board/channel views and
   ⌘K search fetch entire instance-wide tables through paginated REST;
   the gateway never forwards `limit` to the server; everything silently
   truncates at 100k rows.

## Status of the original findings (per domain)

### 1. Auth & Onboarding
- FIXED: forgot-password flow (pages + middleware + login link, verified endpoints exist in better-auth 1.4.22).
- INTENTIONAL: social/OIDC UI skipped (owner decision; server code dormant, nothing broken); onboarding creates workspace only.
- STILL OPEN: middleware checks cookie presence only (cosmetic — server validates); quick-login double-flag drift; no-SMTP magic-link logging (now at least disclosed in UI copy).

### 2. Core Kanban
- FIXED: label edit/delete UI; checklist-item delete; list/card delete confirms; Trello removed with zero dangling refs.
- STILL OPEN: list delete hides (not soft-deletes) its cards — now disclosed in the confirm copy; gate-marker regex sniffing in comment UI (cosmetic only — server is authoritative).

### 3. Members, Roles & Permissions
- FIXED: last-admin protection (demote + remove); invite email enforcement; RBAC confirmed fresh-read per request under NCB.
- STILL OPEN: settings nav shows admin pages to members/guests (raw FORBIDDEN); guests enumerate roster incl. emails; no leave-workspace flow; per-procedure enforcement by convention.

### 4. Comments, Mentions & Reactions
- FIXED: 👎/🚀 on the card quick-react bar (channels already had them).
- STILL OPEN: mention regex lowercase-only; tryApplyProposal silent no-op (👍 records, nothing applies, no feedback); guest-mention skip toast-only; judge-mode ~200s synchronous wait; no unit tests for handleCommentMentions.

### 5. Pi AI Workers
- FIXED: README worker list; job-store dual-mode footgun (ensureAgentInfra on every dispatch path).
- STILL OPEN: CLI 10-min poll vs 15-min timeout; pi-CLI quirk dependence (documented); cancel = SIGKILL; manual-dispatch silent live-edit downgrade (documented asymmetry, no UI warning).
- CONFIRMED INTACT: 256KB patch cap end-to-end (capture → flag → gate → apply block).

### 6. Workflow Automation
- FIXED: docs counts (12 triggers / 9 steps, spot-checked field-by-field); dev-task claim; scheduler eager install; reaper exists (but see NEW — the v1 reaper is unsafe).
- PARTIAL: sub-hourly cron warned in docs, still no UI hint.
- STILL OPEN: checkUrl/captureScreenshot no engine-level timeout (bounded ~2 min by CDP 30s caps — downgraded to LOW); applyPreset structural-not-causal validation.

### 7. Search, Audit & Settings
- OBSOLETE→REPLACED: Postgres FTS → in-process token match. Workspace scoping correct, no cross-workspace leak. Gaps: no board/channel/member/workflow-name search; crude ranking; archived items surface.
- MOSTLY FIXED: audit chain under NCB — retry-on-unique append, second-precision truncation, exact verifyChain, MemoryGateway tests, cron script works over HTTP. UNIQUE key verified live.
- STILL OPEN: audit admin-only + no actor column in UI; export = current page only; SMTP/S3 env-only no test-send; audit() fire-and-forget.

### 8. API, Deployment & Dev-Run
- OBSOLETE: Docker (removed, zero remnants); PGLite auto-migrate (code path gone).
- STILL OPEN: many routers tRPC-only (no REST); webhooks 3 events / no HMAC / no retries / gate.opened-vs-pending naming split; in-memory per-process rate limiting (x-forwarded-for spoofable); single-instance constraint.
- RESIDUE: turbo.json still declares POSTGRES_URL/REDIS_URL/KR8KAN_DOCS_PORT/KR8KAN_ADMIN_API_KEY and misses NCB_*; CONTRIBUTING.md/AGENTS.md still say `pnpm db:migrate`; scripts/dev.sh prints a Postgres banner; next.config.js externalizes removed pglite; macapp runs `next dev` not a prod build.

## NEW findings from the swap (ranked)

### Critical
- **[FIXED in this commit] NCB_SECRET_KEY + NCB_INSTANCE missing from the Pi env scrub list** (`packages/agents/src/safety.ts`) — dev-task runs with shell tools inherited the DB master key. Added to SECRET_ENV_KEYS + coverage test.

### High
1. **No timeout on NCB HTTP requests; instant retries; retries on non-idempotent POST/PUT/DELETE** (`packages/db/src/ncb/http.ts`) — an unreachable NCB hangs every request handler; a 5xx-after-commit duplicates rows with no transaction to unwind.
2. **Gate double-fire race** (`workflowEngine.ts` handleGateReaction) — read-check-write with no compare-and-set; two concurrent approvals run post-gate steps twice.
3. **Reaper v1 unsafe** — keys off `startedAt` (gate-parked runs resume with old startedAt → reaped mid-execution); 2h threshold < legit 10×20-min worker steps; writes status directly, bypassing failRun (no audit event, sentinel blind).
4. **Whole-table hot-path reads** — card open fetches ALL commentReactions/workspaceMembers/checklistItems instance-wide; board open ~9 unfiltered table walks incl. all cards; channel views fetch all messageReactions/users; ⌘K fetches every list/card/comment/message per keystroke with no debounce; gateway `findMany` never forwards `limit` server-side (audit append reads the whole chain to get the tail; job lists pull MEDIUMTEXT patches to show 20 rows).

### Medium
- `member.revokeInvite` un-scoped publicId (same class as the fixed updateRole/remove bug); `card.removeMember`/`removeLabel` asymmetric scope checks.
- `acceptInvite`: silently keeps existing role while burning the invite + writing a false `member.joined` audit row; also joins soft-deleted workspaces.
- Last-admin guard is check-then-act (structural without transactions).
- Duplicate reaction replays triggers/audit/apply (router ignores the `created` signal); `insertIfAbsent` is read-then-write with unique keys existing for reactions… enforced only where the DDL has them.
- Rate caps racy: workflow 20/hr and per-user job caps are count-then-create.
- `appendAppliedActions` read-merge-write can lose applied indices → double-apply window; `tryApplyProposal` same class.
- expireGate races an in-flight approval; stepResults whole-array rewrites lose updates under any double-execution.
- Gateway `insert` has no read-after-write retry (update overlays, create throws) — a lagging read 500s sign-in/session creation.
- better-auth non-eq where clauses (expired-key sweep lt/ne) scan the full apikey table every ~10s on the verify path.
- `/api/v1/health` never probes NCB — LB sees healthy while every route 500s; NcbError uncaught anywhere (raw NCB body leaks into client errors).
- Silent truncation at 100k rows (PAGE_LIMIT 500 × MAX_PAGES 200) — partial data with no error; audit verifyChain would false-pass beyond it.
- Board card badges count soft-deleted checklists; deleted labels ghost on cards (unremovable chip); trash lists truncate globally before workspace filtering; cross-board card moves orphan labels (REST-reachable).
- Search exposes agent resultRaw snippets to guests (workspace:view).
- moveCard renumbering non-atomic (concurrent DnD can tear indices).

### Low (selection)
- Sign-up lock blocks invite redemption entirely (invites need an existing account).
- Reaction quick-bar `emoji as "👍"` casts; CommandPalette stale "(FTS)" comment; agent-result hits un-navigable (jobId unused).
- Zero test coverage: ncbAdapter, member/invite guards, schedulerTick/reaper/rate caps, mentions case-sensitivity.
- macapp.json → `next dev`; turbo strict-env misses NCB_*; `packages/db/ncb/README.md` references a schema.json that isn't committed.

## Suggested fix waves

- **Wave A — resilience & security (High 1-3 + revokeInvite + health probe):**
  timeouts/backoff/idempotent-retry policy in http.ts, gate/reaper CAS-style
  guards (status-conditional update + updatedAt column on workflow_run,
  reap via failRun), scope revokeInvite, real health check.
- **Wave B — hot-path data access:** forward limit/filters server-side,
  per-parent filtered fetches for card/board/channel assemblies, search
  debounce + per-table scoping, audit tail read with server limit.
- **Wave C — correctness niceties:** duplicate-reaction created-signal,
  acceptInvite role/burn semantics + deleted-workspace check, label ghosts,
  badge counts, trash scoping, config residue (turbo.json, CONTRIBUTING,
  AGENTS.md, dev.sh, next.config), tests for the new guards.

---

## Addendum — backlog closure (same day, commits 9a19dba + ffb4667)

Waves A/B/C shipped (see 9a19dba), then the STILL OPEN backlog itself
(ffb4667): signed webhooks (HMAC + rotate + one-time reveal, gate event
naming unified, card.deleted/workflow.run.failed added), settings nav
role-gated, guest email redaction, leave-workspace flow, audit actor
column + full-chain export, 👍-apply failure reasons surfaced, 90s
browser-step timeouts, invite exception to the sign-up lock, CLI poll
window fix, SMTP/S3 status + test-send, agent-result deep links, and 24
new guard tests. Items intentionally left as-is are listed in ffb4667's
commit message.
