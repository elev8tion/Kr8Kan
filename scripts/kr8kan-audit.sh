#!/usr/bin/env bash
# Verify a workspace's audit hash chain from the CLI (cron-friendly).
#
#   ./scripts/kr8kan-audit.sh --workspace=<workspacePublicId>
#
# Exit codes: 0 chain intact · 1 usage/transport error · 2 chain broken
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required (brew install jq / apt install jq)" >&2
  exit 1
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

BASE_URL="${KR8KAN_BASE_URL:-http://localhost:${KR8KAN_WEB_PORT:-3310}}"
API_TOKEN="${KR8KAN_API_TOKEN:-}"

WORKSPACE=""
for arg in "$@"; do
  case "$arg" in
    --workspace=*) WORKSPACE="${arg#*=}" ;;
  esac
done

if [ -z "$WORKSPACE" ]; then
  echo "usage: ./scripts/kr8kan-audit.sh --workspace=<workspacePublicId>" >&2
  exit 1
fi
if [ -z "$API_TOKEN" ]; then
  echo "KR8KAN_API_TOKEN not set — create an API key in Settings → API." >&2
  exit 1
fi

# tRPC mutation endpoint (superjson-free input shape).
result=$(curl -sf -X POST "$BASE_URL/api/trpc/workspace.auditVerify" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"json\":{\"workspacePublicId\":\"$WORKSPACE\"}}")

ok=$(echo "$result" | jq -r '.result.data.json.ok // false')
checked=$(echo "$result" | jq -r '.result.data.json.checked // 0')
broken=$(echo "$result" | jq -r '.result.data.json.brokenAtSeq // empty')

if [ "$ok" = "true" ]; then
  echo "✓ audit chain intact ($checked entries)"
  exit 0
fi
echo "✗ audit chain BROKEN at seq ${broken:-unknown} (checked $checked)" >&2
exit 2
