# Kr8Kan native messaging — executable plan

Status: **executed — all four waves shipped** (A: channels core, B: protocol
layer, C: surfaces + polish, D: SSE live transport).

## Why

Kr8Kan's collaboration model is Buzz-inspired (see
`docs/archive/BUZZ-INSPIRED-PLAN.md`): humans and agents share one identity
model, one audit trail, one reaction protocol. Buzz's remaining untranslated
piece is its *conversation surface* — Slack-shaped channels and threads where
agents act in-thread. Kr8Kan has card comments and board notes, but no
free-standing conversation space. This plan builds that surface **natively** —
no Slack, no external chat product, ever. (The short-lived Slack webhook
formatter was removed in `4b76eec` for exactly this reason.)

## Non-negotiables (inherited from the Buzz ethos)

- Agents are first-class authors via `agentIdentities` — same message shape,
  same identity model, whether the author is a person or a process.
- Every message event lands in the hash-chained `auditLog`.
- Reactions are protocol: 👍 on an agent proposal in a channel approves it,
  exactly like on card comments.
- Agent-authored messages are immutable, even to their operator — rewriting an
  agent's words corrupts the audit story (same rule as agent comments).
- Channels never leak through public boards — the `/p/` redaction stays
  field-by-field and channels are simply absent from it.
- Fail-closed parsing everywhere agents produce message content.

## Wave A — channels core (schema + API + basic UI)

Migration (next in sequence):

- `channels` — workspace-scoped; `publicId`, `name`, `slug`, `topic`,
  optional `boardId` (a channel may be attached to a board), `archivedAt`,
  soft-delete like boards/lists/cards.
- `channelMembers` — membership rows for humans and agent identities;
  workspace admins implicitly see all non-private channels. Start with all
  channels workspace-visible; private channels are a later flag, not Wave A.
- `messages` — `channelId`, `authorId` (same author model as `comments`,
  covering humans and agents), `body`, `parentMessageId` for threads
  (one level deep, Slack-style), soft-delete, `editedAt`.

API (tRPC, mirroring existing router conventions): channel CRUD
(create/rename/topic/archive), message post/edit/delete/list with cursor
pagination, thread fetch. Permissions mirror comment rules: edit own only,
delete own-or-admin, agent messages immutable. All mutations audited
(`channel.created`, `message.posted`, …).

UI: `/channels` index + `/channels/[publicId]` view in the side nav.
Message list (newest at bottom), composer, thread panel. Reuse the comment
renderer (markdown, mentions highlighting). Poll on the existing 30-second
pattern — real-time transport is Wave D, not here.

**Done when:** two humans can hold a threaded conversation in a channel,
every event is in the audit chain, and typecheck + tests + web build are
green.

## Wave B — the protocol layer (agents in-thread)

- **Mentions dispatch workers.** `@worker` in a channel message goes through
  the same mention pipeline as card comments (`packages/api/src/mentions.ts`):
  dispatch job, agent replies in-thread as its `agentIdentity`, reply audited
  (`agent.reply.posted`). Context builder gets channel + thread history
  (bounded) instead of card context.
- **Message reactions.** `messageReactions` table cloning the
  `commentReactions` pattern, optimistic UI, same emoji set.
- **Gates in channels.** Agent proposals posted to a channel carry the same
  gate machinery as card comments: 👍 approves, gate expiry posts the
  follow-up message, everything audited. One gate implementation, two
  surfaces — extract shared gate logic rather than duplicating it.
- **Workflow integration.** New trigger class `message.posted` (with channel
  + pattern filters) and new step `postMessage` (target channel), joining
  the existing trigger/step registry in `packages/shared/src/workflow.ts` and
  the engine. The standup digest template gains a post-to-channel variant.

**Done when:** the full Buzz release-flow shape works in a channel: agent
proposes in-thread, human reacts 👍, board mutates, audit chain shows
propose → approve → apply.

## Wave C — surfaces + polish

- Board-linked channels: creating a board offers (not forces) a companion
  channel; board header links to it.
- Notification bell + `/my`: unread channel mentions and thread replies join
  the existing feeds (same local-watermark pattern, no new notification
  tables).
- Search: messages join the global search index; hits deep-link into the
  channel scrolled to the message with flash-highlight (same pattern as
  comment hits).
- Unread markers per channel (local watermark, consistent with the bell).
- Message edit/delete UI with the two-tap confirm used by comments.
- Channel archive view + Trash-page integration for deleted channels.

**Done when:** channels feel first-class next to boards — findable,
notifying, searchable, restorable.

## Wave D (stretch) — live transport

Only after A–C prove out: upgrade channel views from 30-second polling to
SSE (single endpoint, per-workspace event stream), falling back to polling
when the stream drops. No typing indicators, no presence — that's chat
theater, not protocol. Skip this wave entirely if polling feels fine in use.

## Sequencing

A → B → C strictly sequential (shared migration chain + shared files).
Same discipline as every prior wave: fork implements, full typecheck +
tests + web build, commit on green, coordinator verifies and pushes.
