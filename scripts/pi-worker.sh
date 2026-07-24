#!/usr/bin/env bash
# Run a Kr8Kan Pi worker non-interactively from the CLI.
#
#   pnpm agents:worker -- --worker=summarize-board --board=<boardPublicId>
#   pnpm agents:worker -- --worker=draft-card --prompt="landing page revamp"
#
# Talks to the local Kr8Kan REST API (dedicated port 3310 by default) with an
# API key, so it exercises the same path as the UI "Run AI worker" flow.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

BASE_URL="${KR8KAN_BASE_URL:-http://localhost:${KR8KAN_WEB_PORT:-3310}}"
API_TOKEN="${KR8KAN_API_TOKEN:-}"

WORKER=""
BOARD=""
CARD=""
PROMPT=""
for arg in "$@"; do
  case "$arg" in
    --worker=*) WORKER="${arg#*=}" ;;
    --board=*)  BOARD="${arg#*=}" ;;
    --card=*)   CARD="${arg#*=}" ;;
    --prompt=*) PROMPT="${arg#*=}" ;;
  esac
done

if [ -z "$WORKER" ]; then
  echo "usage: pnpm agents:worker -- --worker=<name> [--board=<publicId>] [--card=<publicId>] [--prompt=...]" >&2
  exit 1
fi
if [ -z "$API_TOKEN" ]; then
  echo "KR8KAN_API_TOKEN not set — create an API key in Settings → API and export it." >&2
  exit 1
fi

body=$(printf '{"worker":"%s","boardPublicId":%s,"cardPublicId":%s,"prompt":%s}' \
  "$WORKER" \
  "$([ -n "$BOARD" ] && printf '"%s"' "$BOARD" || echo null)" \
  "$([ -n "$CARD" ] && printf '"%s"' "$CARD" || echo null)" \
  "$([ -n "$PROMPT" ] && printf '"%s"' "$PROMPT" || echo null)")

echo "▸ running worker '$WORKER' via $BASE_URL"
run=$(curl -sf -X POST "$BASE_URL/api/v1/agents/run" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "content-type: application/json" \
  -d "$body")
echo "$run"
job_id=$(echo "$run" | sed -n 's/.*"jobId":"\([^"]*\)".*/\1/p')
[ -z "$job_id" ] && exit 1

echo "▸ polling job $job_id"
for _ in $(seq 1 120); do
  status=$(curl -sf "$BASE_URL/api/v1/agents/jobs/$job_id" -H "Authorization: Bearer $API_TOKEN")
  state=$(echo "$status" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')
  if [ "$state" = "completed" ] || [ "$state" = "failed" ] || [ "$state" = "cancelled" ]; then
    echo "$status"
    [ "$state" = "completed" ] || exit 1
    exit 0
  fi
  sleep 2
done
echo "timed out waiting for job $job_id" >&2
exit 1
