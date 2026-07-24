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
| `card.created` | a card is created | optional list filter |
| `card.moved` | a card changes list | optional target-list filter |
| `label.added` | a label lands on a card | optional label filter |
| `card.due` | a card is due within N hours (hourly scan) | `beforeHours` |
| `comment.created` | a comment posts | optional substring filter |
| `reaction.added` | a reaction lands | emoji, optional agent-comment-only |
| `schedule` | cron (5-field: `min hour day month weekday`) | `cron` |
| `webhook` | `POST /api/v1/workflows/{slug}/trigger` (API-key auth) | `slug` |

### Steps

| Type | Does | Notes |
|---|---|---|
| `runWorker` | dispatches a worker, waits for completion | `dev-task` (tools) is banned in workflows; prompt supports templates |
| `gate` | posts an approval comment on the card, parks the run | 👍 approves, ❌ rejects; expires after `timeoutHours`; approver spec `member`/`admin`, re-checked at reaction time |
| `applyPreset` | applies the last worker's parsed result | requires a gate immediately before it unless `autoApply: true` (default **false** — no silent board mutation, ever) |
| `postComment` | comments on the card as the ⚙️ Workflow agent | template |
| `callWebhook` | POSTs run metadata to a URL | 10s timeout; non-2xx fails the run |

Templates: `{{card.title}}`, `{{card.publicId}}`, `{{trigger.*}}`,
`{{steps.0.result.summary}}`, `{{workflow.name}}` — whitelist paths only, no
expressions, unknown paths render empty.

### Gates

A parked run holds **no process** — state lives in the DB, so restarts are
safe. The approver becomes the operator for everything after the gate: they
are the human authorizing the mutation, and `applyPreset` re-checks every
per-action permission against *them*. Pending gates dispatch a
`workflow.gate.pending` event to your outbound webhooks.

### Loop guards

- Events caused by a workflow run never trigger another workflow (no chains).
- Max 20 runs per workflow per hour; max 10 steps; per-step timeouts.
- `card.due` dedupes per card+workflow within the window.

## Custom workers (persona packs)

Settings → AI workers → Create worker (`agent:manage`). A custom worker =
mention slug + title + avatar + system prompt. **Advisory-only — custom
workers never get tools.** Borrow a stock output schema ("applies like
triage-card") and the output contract is injected into the prompt
automatically; the result parses and applies exactly like the stock worker's.
Export/import as `*.persona.json`.

## Full-text search

⌘K accepts free text (3+ chars): Postgres FTS across card titles/descriptions,
comments, and agent results, workspace-scoped, ranked, with snippets. Works
identically on embedded PGlite.

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

The workflow scheduler ticks hourly **in-process** alongside the runner —
same constraint as always: one long-lived Node instance, no serverless, no
horizontal scaling. Missed schedules fire once on boot when the miss is under
an hour, otherwise they skip (logged).
