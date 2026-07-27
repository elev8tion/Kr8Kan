#!/usr/bin/env bash
# Kr8Kan local dev — dedicated ports so we never fight other local stacks.
#   web      → http://localhost:${KR8KAN_WEB_PORT:-3310}
#   postgres → localhost:${KR8KAN_POSTGRES_PORT:-5433} (external, optional)
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export KR8KAN_WEB_PORT="${KR8KAN_WEB_PORT:-3310}"

if [ -n "${POSTGRES_URL:-}" ]; then
  echo "▸ using external postgres at POSTGRES_URL"
else
  echo "▸ POSTGRES_URL empty — using embedded PGLite (.kr8kan/pglite)"
fi

echo "▸ web on http://localhost:${KR8KAN_WEB_PORT}"
exec pnpm -F @kr8kan/web dev
