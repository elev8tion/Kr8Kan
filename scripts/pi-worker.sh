#!/usr/bin/env bash
# Run a Kr8Kan Pi worker non-interactively from the CLI.
#
#   pnpm agents:worker -- --worker=summarize-board --board=<boardPublicId>
#   pnpm agents:worker -- --worker=draft-card --prompt="landing page revamp"
#   pnpm agents:worker -- --worker=breakdown-card --card=<cardPublicId> --apply
#
# Talks to the local Kr8Kan REST API (dedicated port 3310 by default) with an
# API key, so it exercises the same path as the UI "Run AI worker" flow.
# --apply posts the completed result back to the card as a comment via the
# same /agents/apply endpoint the UI uses (requires --card).
#
# --json: machine mode (agent-first, JSON in / JSON out) — exactly one
# JSON object (the job's terminal state) on stdout, errors as JSON on
# stderr, no prose. Built for LLM tool calls.
#
# Exit codes: 0 completed · 1 usage/transport error · 2 job failed ·
#             3 timed out waiting · 4 apply failed
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required (brew install jq / apt install jq)" >&2
  exit 1
fi

# Caller-exported values take precedence over .env (repo .env may contain
# empty placeholders like KR8KAN_API_TOKEN=).
_caller_api_token="${KR8KAN_API_TOKEN-__unset__}"
_caller_base_url="${KR8KAN_BASE_URL-__unset__}"
_caller_web_port="${KR8KAN_WEB_PORT-__unset__}"
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
if [ "$_caller_api_token" != "__unset__" ]; then KR8KAN_API_TOKEN="$_caller_api_token"; fi
if [ "$_caller_base_url" != "__unset__" ]; then KR8KAN_BASE_URL="$_caller_base_url"; fi
if [ "$_caller_web_port" != "__unset__" ]; then KR8KAN_WEB_PORT="$_caller_web_port"; fi

BASE_URL="${KR8KAN_BASE_URL:-http://localhost:${KR8KAN_WEB_PORT:-3310}}"
API_TOKEN="${KR8KAN_API_TOKEN:-}"

WORKER=""
BOARD=""
CARD=""
PROMPT=""
APPLY=0
JSON=0
for arg in "$@"; do
  case "$arg" in
    --worker=*) WORKER="${arg#*=}" ;;
    --board=*)  BOARD="${arg#*=}" ;;
    --card=*)   CARD="${arg#*=}" ;;
    --prompt=*) PROMPT="${arg#*=}" ;;
    --apply)    APPLY=1 ;;
    --json)     JSON=1 ;;
  esac
done

say() { [ "$JSON" = 1 ] || echo "$@"; }
jerr() {
  if [ "$JSON" = 1 ]; then jq -n --arg error "$1" '{error: $error}' >&2; else echo "$1" >&2; fi
}

if [ -z "$WORKER" ]; then
  jerr "usage: pnpm agents:worker -- --worker=<name> [--board=<publicId>] [--card=<publicId>] [--prompt=...] [--apply] [--json]"
  exit 1
fi
if [ -z "$API_TOKEN" ]; then
  jerr "KR8KAN_API_TOKEN not set — create an API key in Settings → API and export it."
  exit 1
fi
if [ "$APPLY" = 1 ] && [ -z "$CARD" ]; then
  jerr "--apply requires --card (result is posted back to the card)"
  exit 1
fi

# jq builds the JSON body — worker/board/card/prompt are data, never format
# strings, so quoting/injection is a non-issue.
body=$(jq -n \
  --arg worker "$WORKER" \
  --arg board "$BOARD" \
  --arg card "$CARD" \
  --arg prompt "$PROMPT" \
  '{worker: $worker,
    boardPublicId: (if $board == "" then null else $board end),
    cardPublicId:  (if $card  == "" then null else $card  end),
    prompt:        (if $prompt == "" then null else $prompt end)}')

say "▸ running worker '$WORKER' via $BASE_URL"
run=$(curl -sf -X POST "$BASE_URL/api/v1/agents/run" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "content-type: application/json" \
  -d "$body")
say "$run"
job_id=$(echo "$run" | jq -r '.jobId // empty')
if [ -z "$job_id" ]; then jerr "run did not return a jobId"; exit 1; fi

say "▸ polling job $job_id"
state=""
status=""
for _ in $(seq 1 480); do
  status=$(curl -sf "$BASE_URL/api/v1/agents/jobs/$job_id" -H "Authorization: Bearer $API_TOKEN")
  state=$(echo "$status" | jq -r '.status // empty')
  if [ "$state" = "completed" ] || [ "$state" = "failed" ] || [ "$state" = "cancelled" ]; then
    if [ "$JSON" = 1 ]; then echo "$status" | jq -c .; else echo "$status" | jq .; fi
    break
  fi
  progress=$(echo "$status" | jq -r '.progress // empty')
  [ -n "$progress" ] && say "  … $progress"
  sleep 2
done

case "$state" in
  completed) ;;
  failed|cancelled) exit 2 ;;
  *) jerr "timed out waiting for job $job_id"; exit 3 ;;
esac

if [ "$APPLY" = 1 ]; then
  say "▸ applying result as comment on card $CARD"
  result=$(echo "$status" | jq -r '.result // empty')
  if [ -z "$result" ]; then
    jerr "job completed with no result — nothing to apply"
    exit 4
  fi
  apply_body=$(jq -n --arg jobId "$job_id" --arg card "$CARD" --arg body "$result" \
    '{jobId: $jobId, actions: [{type: "addComment", cardPublicId: $card, body: $body}]}')
  if ! curl -sf -X POST "$BASE_URL/api/v1/agents/apply" \
    -H "Authorization: Bearer $API_TOKEN" \
    -H "content-type: application/json" \
    -d "$apply_body" | { [ "$JSON" = 1 ] && jq -c . || jq .; }; then
    jerr "apply failed"
    exit 4
  fi
fi

exit 0
