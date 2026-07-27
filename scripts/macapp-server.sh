#!/bin/sh
# Boots the Kr8Kan web server for the macOS app bundle (see macapp.json).
#
# Called as: sh scripts/macapp-server.sh <port>, with the repo root as cwd.
#
# Why this exists rather than a plain command in macapp.json:
#
#  - Not `pnpm dev:next`. The app shell stops the server with
#    Process.terminate(), which signals only its direct child. Behind pnpm
#    the real server sits three processes deep (dotenv -> pnpm -F -> next),
#    survives the signal, and keeps holding the port — so the next launch
#    finds it occupied. Invoking next directly is safe because
#    apps/web/next.config.js loads the monorepo root .env on its own.
#
#  - Next ignores the stdin pipe the app shell relies on to notice a force
#    quit, so `cat` waits on that pipe here and stops Next when it closes.
#
# Between the trap and the pipe, both a clean Cmd-Q and a hard kill of the
# app leave no orphaned server behind.
set -eu

port="${1:?usage: macapp-server.sh <port>}"

# cd, rather than `next dev apps/web` from the root. Next resolves
# postcss.config.cjs and tailwind.config.ts from the *cwd*, and both live in
# apps/web — run it from the root and Tailwind silently never runs, so the
# app serves working but completely unstyled HTML. This is what
# `pnpm -F @kr8kan/web dev` does, minus the process layers.
cd apps/web

../../node_modules/.bin/next dev -p "$port" &
child=$!

stop() {
	kill -TERM "$child" 2>/dev/null || true
}
trap stop TERM INT

# Blocks until the app closes the pipe (quit, crash, or force quit).
cat >/dev/null || true
stop
wait "$child" 2>/dev/null || true
