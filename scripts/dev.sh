#!/usr/bin/env bash
# Kr8Kan local dev — dedicated ports so we never fight other local stacks.
#   web      → http://localhost:${KR8KAN_WEB_PORT:-3310}
#   postgres → localhost:${KR8KAN_POSTGRES_PORT:-5433} (docker compose, optional)
#   redis    → localhost:${KR8KAN_REDIS_PORT:-6380}   (docker compose --profile redis)
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export KR8KAN_WEB_PORT="${KR8KAN_WEB_PORT:-3310}"

if [ -n "${POSTGRES_URL:-}" ] && command -v docker >/dev/null 2>&1; then
  if docker compose ps --status running postgres 2>/dev/null | grep -q postgres; then
    echo "▸ postgres already running on :${KR8KAN_POSTGRES_PORT:-5433}"
  else
    echo "▸ starting postgres on :${KR8KAN_POSTGRES_PORT:-5433}"
    docker compose up -d postgres
  fi
elif [ -z "${POSTGRES_URL:-}" ]; then
  echo "▸ POSTGRES_URL empty — using embedded PGLite (.kr8kan/pglite)"
fi

echo "▸ web on http://localhost:${KR8KAN_WEB_PORT}"
exec pnpm -F @kr8kan/web dev
