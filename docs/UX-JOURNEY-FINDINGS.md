# User-Journey Walkthroughs — Findings

Date: 2026-07-24, against `main` @ `e4edf71`. Method: walked every major
journey (new user → boards → cards → conversations → agents → workflows →
gates → search → settings → CLI) against the actual code, not the docs.
Three buckets: **overlooked** (broken or dead-ends today), **enhance**
(works, but friction), **new opportunities** (features the substrate now
makes cheap).

---

## 🔴 Overlooked — broken or dead-end paths

### O1. The "Weekly standup digest" workflow template cannot succeed
Journey: Settings → Workflows → template → create → wait for Monday 09:00.
Two compounding gaps:
1. The builder never asks for a **board** — every workflow is created
   workspace-wide (`boardPublicId: null`). A `schedule`-triggered `runWorker
   standup` step then dispatches with neither board nor card and fails with
   "provide boardPublicId or cardPublicId".
2. Even with a board, the template's `postComment` step requires a
   **card-scoped** run; schedule events have no card. It would fail at step 2.

Fix path: add a board picker to the builder (required for `schedule` +
`card.due` triggers), and give `postComment` a target — either a designated
"digest card" picker or a new board-level notes surface (see N2).
*The other two templates (auto-triage, due-nudge) are card-scoped and work.*

### O2. "Public" board visibility is a dead toggle
`board.visibility = public` exists in schema, API, and shows a badge on the
boards index — but there is no unauthenticated route that renders a public
board. A user flipping a board public gets nothing. Either ship a read-only
public view (`/p/[boardPublicId]`) or remove the toggle until it does
something.

### O3. Attachments are a stub behind a real-looking schema
`attachment` table, S3 env vars, and an `attachmentRouter` exist — but the
router only reports `storageStatus`; there is no upload endpoint and no UI.
A card journey that reaches "attach the screenshot" dead-ends silently.
Ship presigned-URL upload + gallery on CardDetail, or hide the concept.

### O4. Comments cannot be edited or deleted from the UI
`card.updateComment` / delete exist in the API and repo; CardDetail renders
no edit/delete affordance. Typo in a comment = permanent. (Also relevant for
agents: a noisy agent reply can't be removed by the operator.)

### O5. Mention replies skip the audit chain
`postMentionReply` writes through `cardRepo.addComment` directly — activity
row yes, `audit_log` entry no. Every other agent surface audits. One-line fix
in `dispatchWorker.postMentionReply`; matters because the audit page claims
completeness.

### O6. Search deep link opens the card but not the comment
FTS comment hits navigate to `/boards/x?card=y` — the card opens, but the
matched comment isn't scrolled to or highlighted. On a card with 40 comments
the "find" journey ends with manual scanning. Pass `?comment=` and scroll +
flash-highlight.

### O7. No workflow edit — only create, toggle, delete
`workflow.update` accepts name/trigger/steps, but the settings page offers no
edit affordance. Journey: fix a typo in a prompt template → forced to delete
and rebuild the whole workflow (losing run history). Wire the builder modal
to load an existing workflow.

### O8. Persona export with no import
The exported `*.persona.json` has nowhere to go on another instance — the
create form is manual-only. Round-trip is half-shipped; add an "Import"
button that reads the file into the create form.

---

## 🟡 Enhance — works, but friction

### E1. No in-app signal for anything asynchronous
The platform's whole promise is now async (agent replies, gate approvals,
workflow completions) but the only notification channel is outbound webhooks.
A user who @mentions a worker and closes the card never learns the reply
arrived; a pending gate waits silently until it expires. Minimum viable: a
bell with an unread list fed from existing activity rows (`agent.run.completed`,
`workflow.gate.opened`) — the data is already being written.

### E2. Gate expiry is silent on the card
An expired gate fails the run and shows in Settings → Workflows, but the gate
comment on the card still says "React 👍 to approve" forever. Post a
follow-up comment (or edit the gate comment) on expiry so the card tells the
truth.

### E3. Jobs list has filters in the API, none in the UI
`agent.jobs` supports board/worker/status filters; the settings page shows a
flat latest-20. After a week of workflow runs, finding "that failed dev-task
from Tuesday" means scrolling. Add three dropdowns; the backend is done.

### E4. Reaction toggles feel slow
Every reaction round-trips and refetches the whole card. Optimistic update
(tRPC `onMutate` cache patch) would make the approve-with-👍 flow feel
instant — important since reactions are now a *control* surface, not
decoration.

### E5. Board-scoped worker results are copy-only dead ends
Run `summarize-board` from the board view: result renders, but with no card
in scope the only actions are Copy/Dismiss. Cheap wins: "save as card in
<list>", or post to the board notes surface (N2).

### E6. `card.due` under one hour never fires usefully
The scheduler ticks hourly; `beforeHours: 1` can fire after the due time or
not at all. Either enforce `beforeHours >= 2` in the schema with a UI hint,
or tick the due-scan every 10 minutes (cheap query).

### E7. Workflow run history lacks drill-through
Run rows show step traces but nothing is clickable — no link from a
`runWorker` step to its job, from a run to its card, or from a gate to its
comment. All the ids are in `stepResults`/`cardPublicId` already.

### E8. Custom worker editing exists in API only
Create/delete have UI; `updateCustomWorker` (incl. the prompt-version bump
logic) has no edit button. Prompt iteration — the core persona loop — forces
delete/recreate, which also orphans the old agent identity.

### E9. Mobile: comment box vs. mention popover
The autocomplete popover anchors above the input; inside the full-height
mobile sheet with the keyboard up this can clip off-screen. Needs a
viewport-aware flip (render below when space above is short).

---

## 🟢 New feature opportunities (the substrate makes these cheap now)

### N1. "My work" view
`card_member` assignments + due dates exist; there is no page answering "what
is mine, what's due". A `/my` view (assigned cards across boards, due-soon
first, pending gates I can approve) would be the highest-leverage nav
addition. The pending-gates slice doubles as the E1 notification surface.

### N2. Board notes / digest surface
Recurring need across O1, E5: board-scoped agent output has no home. A
lightweight `board_note` (one markdown doc per board, agent-writable via a
new `postNote` workflow step) gives standup digests, summaries, and release
notes a landing place — Buzz's "canvas" idea at 5% of the cost.

### N3. Workflow dry-run
The builder validates shapes but the first real execution is live. A "Test"
button that runs the trigger match + template interpolation against a chosen
card and shows what *would* happen (steps, prompts, gate text — no
mutations) would de-risk authoring enormously. The interpolator and
validators are pure functions already.

### N4. Digest webhook → Slack-ready payloads
`workflow.gate.pending` and job events already dispatch to outbound webhooks,
but payloads are raw JSON. A per-webhook "format: slack" option emitting
Block Kit would make gates approvable-from-Slack-visible in an afternoon.

### N5. Agent leaderboard / usage panel
`agent_job` now carries identity, duration, status, verify results, and
apply counts. A small panel on Settings → AI workers (runs per worker,
success rate, median duration, applies accepted vs. expired gates) turns the
audit exhaust into an operator dashboard — and surfaces which custom
personas actually earn their keep.

### N6. Card templates (beyond board templates)
`/templates` seeds board *structures* only. Teams repeat card shapes (bug
report, release checklist). A "save card as template" + template picker in
the composer reuses the existing checklist/description machinery; pairs
naturally with `draft-card` (the worker could emit `templateName`).

### N7. Trash / undo for soft deletes
Everything soft-deletes (`deletedAt`) but nothing un-deletes. A workspace
Trash page (cards/lists/boards, 30-day retention, restore button) is almost
free given the schema — and converts the scariest journeys (accidental
delete) from support incidents into self-service.

### N8. Public read-only board (completes O2)
If O2 is resolved by building rather than removing: a tokenless read-only
render is also the natural "share the roadmap" feature — plus an
`Accept: application/json` variant for embedding.

---

## Suggested ordering

1. **O1 + O7** (workflow board picker, edit, digest target) — the flagship
   feature's advertised template must work.
2. **O5, O6, E2, E3, E7** — small honesty/navigation fixes, each < an hour.
3. **E1 + N1** together — one "attention" surface (bell + My-work) covering
   mentions, gates, due dates.
4. **O4, E4, E8, O8** — edit/optimistic/import polish.
5. **O2/N8, O3** — decide build-or-remove for public boards and attachments;
   dead toggles erode trust fastest.
6. **N2, N3, N5** — next feature wave, in that order.
