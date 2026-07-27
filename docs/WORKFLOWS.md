# Workflows, agents-as-members, and the audit chain

Buzz-inspired (github.com/block/buzz) collaboration layer. This documents what
shipped from `docs/BUZZ-INSPIRED-PLAN.md`.

## Agents as first-class members

Every worker acts under an **agent identity** (name + emoji avatar, per
workspace). Agent-authored comments and applied changes render under the
agent's identity with an "agent" chip; the human operator who triggered or
approved the action is recorded alongside ("via <name>") — both are stamped on
the row (`agentIdentityId` + `createdBy`).

## @worker mentions

Type `@triage-card fix this properly` in any card comment:

- The comment posts normally; the mention dispatches the worker through the
  exact same path as the UI runner (permissions, caps, folder locks all apply).
- The rest of the comment becomes the prompt.
- The agent replies **in the thread** when done. Parsed results include a
  `job:<id>` marker — react 👍 on the agent's reply to apply its proposal
  (move/labels/checklist/card), permission-checked against *you* at that
  moment.
- Guests can mention; nothing dispatches, and the UI says why. Max 2 worker
  mentions per comment. Custom workers are mentionable by their slug.

## Reactions

Curated set (👍 👎 🎉 👀 🚀 ❌) on comments. Reactions are workflow signals,
not just decoration: they resolve approval gates and fire `reaction.added`
triggers.

## Workflows

Settings → Workflows. A workflow = **trigger** + ordered **steps** (max 10).
Authoring requires `workspace:edit`. Runs are attributed and rate-capped
against the workflow's creator — demote the creator and their workflows lose
power with them.

### Triggers

| Type | Fires when | Options |
|---|---|---|
| `card.created` | a card is created | optional list filter (`listPublicId`) |
| `card.moved` | a card changes list | optional target-list filter (`toListPublicId`) |
| `label.added` | a label lands on a card | optional label filter (`labelPublicId`) |
| `card.due` | a card is due within N hours (hourly scan) | `beforeHours` (1–336) |
| `comment.created` | a comment posts | optional substring filter (`contains`) |
| `reaction.added` | a reaction lands | `emoji`, optional `onAgentComment` |
| `message.posted` | a **human** posts a channel message — agent-authored messages never fire this (reply-loop guard) | optional `channelPublicId`, optional `contains` |
| `schedule` | cron (5-field: `min hour day month weekday`) | `cron` |
| `webhook` | `POST /api/v1/workflows/{slug}/trigger` (API-key auth) | `slug` |

**System-event triggers** (the sentinel loop): the app's own failures fire
these, so a workflow can dispatch a diagnostician instead of waiting for a
human to notice a dead job. Runs started by them never fire further system
events (depth-1 guard — a failing diagnostician must not summon another
diagnostician), and a workflow never reacts to its own failed run.

| Type | Fires when | Options |
|---|---|---|
| `job.failed` | an agent job fails | optional `worker` filter |
| `job.verify_failed` | an agent job's verification fails | optional `worker` filter |
| `workflow.run.failed` | any other workflow's run fails | — |

When a `job.failed`/`job.verify_failed` run hits a `runWorker` step, the
failed job's id is handed to the worker as evidence (`diagnoseJobId`).

### Steps

| Type | Does | Notes |
|---|---|---|
| `runWorker` | dispatches a worker, waits for completion (20 min cap) | `dev-task` **is allowed** — workflow-triggered tools runs are sandbox-mandatory (non-git folders rejected at dispatch) and their output is a 👍-gated patch proposal, never a live edit; `promptTemplate` supports templates |
| `gate` | posts an approval comment on the card (or a channel message in the triggering thread), parks the run | react the gate's `emoji` (default 👍) to approve or ❌ to reject; expires after `timeoutHours` (default 24); approver spec `member`/`admin`, re-checked at reaction time |
| `applyPreset` | applies the last worker's parsed result | requires a gate immediately before it unless `autoApply: true` (default **false** — no silent board mutation, ever); needs a `runWorker` earlier in the steps |
| `postComment` | comments on the card as the ⚙️ Workflow agent | `bodyTemplate`; card-less triggers (schedule/webhook) need `targetCardPublicId` |
| `postNote` | writes the board's notes doc — board-scoped, needs no card | `bodyTemplate`; `mode: append` (default, dated separator block) or `replace` |
| `postMessage` | posts to a channel as the ⚙️ Workflow agent | `bodyTemplate`; `message.posted` runs may omit `channelPublicId` and reply in the triggering thread; every other trigger needs an explicit channel |
| `callWebhook` | POSTs run metadata to a URL | 10s timeout; non-2xx fails the run |
| `checkUrl` | opens the page in the agent browser and asserts it's healthy | fails on navigation error, missing `expectText`, or console errors (unless `allowConsoleErrors`); cron + this step = uptime/smoke monitoring |
| `captureScreenshot` | screenshots a page, attaches it to the run's artifacts | `url`, optional viewport `preset` (`mobile-s`…`desktop`), `fullPage` (default true); cron + this step = visual-regression monitoring |

Templates: `{{card.title}}`, `{{card.publicId}}`, `{{trigger.*}}`,
`{{steps.0.result.summary}}`, `{{workflow.name}}` — whitelist paths only, no
expressions, unknown paths render empty.

### Gates

A parked run holds **no process** — state lives in the DB, so restarts are
safe. The approver becomes the operator for everything after the gate: they
are the human authorizing the mutation, and `applyPreset` re-checks every
per-action permission against *them*. Approver permissions are checked at
reaction time, not gate creation — demoted members can't approve stale
gates, and an expired gate fails on the spot even if reacted to. Pending
gates dispatch a `workflow.gate.pending` event to your outbound webhooks.
Rejection can also carry a reason (feeds the rejection-learning loop).
Expired gates are swept by the scheduler tick: the run fails and an expiry
notice lands on the card (or in the gate's channel thread).

### Loop guards

- Events caused by a workflow run never trigger another workflow (no chains).
- Agent-authored channel messages never fire `message.posted`.
- System-event triggers are depth-1: their runs never fire further system
  events, and a workflow is excluded from its own `workflow.run.failed`.
- Max 20 runs per workflow per hour; max 10 steps; per-step timeouts.
- `card.due` dedupes per card+workflow within the window.
- Reaper: runs still `running` with no progress (`updatedAt`) for 1 hour
  are failed by the scheduler tick — a crash mid-step leaves no other
  recovery path. The longest legitimate step caps at 20 min, so 1h with
  no step transition means dead; a run parked at a gate for hours before
  resuming is not affected, since only the no-progress window counts.

## Custom workers (persona packs)

Settings → AI workers → Create worker (`agent:manage`). A custom worker =
mention slug + title + avatar + system prompt. **Advisory-only — custom
workers never get tools.** Borrow a stock output schema ("applies like
triage-card") and the output contract is injected into the prompt
automatically; the result parses and applies exactly like the stock worker's.
Export/import as `*.persona.json`.

## Full-text search

⌘K accepts free text (3+ chars): in-process token matching across card
titles/descriptions, comments, and agent results, workspace-scoped, ranked,
with snippets.

## Audit chain

Settings → Audit log (`workspace:edit`). Every mutation — human or agent —
appends to a per-workspace hash chain:
`hash = sha256(prevHash | seq | eventType | entityId | payload | createdAt)`.
"Verify integrity" recomputes the chain and reports the exact first broken
sequence on tamper or row deletion. CLI: `./scripts/kr8kan-audit.sh
--workspace=<publicId>` (exit 2 on a broken chain — cron it).

**Honesty note:** this is a tamper-*evident* log, not cryptographic
signatures. It proves the DB history is internally consistent; it does not
prove *who* wrote an entry the way Buzz's Nostr-signed events do. Kr8Kan
deliberately does not ship key management.

## CLI machine mode

`pnpm agents:worker -- --worker=… --card=… --json` — exactly one JSON object
(terminal job state) on stdout, JSON errors on stderr, no prose. Built for
other agents driving Kr8Kan as a tool. Exit codes unchanged (0/1/2/3/4).

## Deployment

The workflow scheduler ticks **hourly, in-process** alongside the runner —
same constraint as always: one long-lived Node instance, no serverless, no
horizontal scaling. It installs on the first API request of any kind (not
just agent/workflow routes), so schedules, `card.due` scans, gate expiry,
and the reaper wake up as soon as anything touches the server after a
restart.

Because the tick is hourly, **sub-hourly cron expressions fire at most once
per hour** — `*/5 * * * *` behaves like `@hourly`. Each tick looks back one
window (from the last fire when it's under 2h old, otherwise one hour) and
fires at most once if the cron was due in it; misses older than that skip.
