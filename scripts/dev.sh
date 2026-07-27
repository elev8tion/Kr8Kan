#!/usr/bin/env bash
# Kr8Kan local dev — dedicated ports so we never fight other local stacks.
#   web → http://localhost:${KR8KAN_WEB_PORT:-3310}
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export KR8KAN_WEB_PORT="${KR8KAN_WEB_PORT:-3310}"

if [ -z "${NCB_INSTANCE:-}" ] || [ -z "${NCB_SECRET_KEY:-}" ]; then
  echo "▸ WARNING: NCB_INSTANCE/NCB_SECRET_KEY not set — NoCodeBackend calls will fail"
else
  echo "▸ using NoCodeBackend instance ${NCB_INSTANCE}"
fi

echo "▸ web on http://localhost:${KR8KAN_WEB_PORT}"
exec pnpm -F @kr8kan/web dev
