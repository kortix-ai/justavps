#!/usr/bin/env bash
# dev-stack.sh — runs the full local dev stack:
#   - apps/v1-api on :4101 (the actual API surface)
#   - Next.js web on :4100 (proxies /api/* → V1)
#
# Both children run as the foreground process group; ^C / SIGTERM cleanly
# stops both. Output is line-prefixed so it's clear which process logged what.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

V1_PORT="${V1_API_PORT:-4101}"
NEXT_PORT="${NEXT_PORT:-4100}"
WAIT_TIMEOUT_MS="${V1_WAIT_TIMEOUT_MS:-60000}"

V1_PID=""
NEXT_PID=""

terminate_tree() {
  # Recursively SIGTERM every descendant of the given pid, then the pid itself.
  local pid="$1"
  [ -z "$pid" ] && return 0
  if kill -0 "$pid" 2>/dev/null; then
    local children=""
    children=$(pgrep -P "$pid" 2>/dev/null || true)
    for child in $children; do
      terminate_tree "$child"
    done
    kill -TERM "$pid" 2>/dev/null || true
  fi
}

force_kill_tree() {
  local pid="$1"
  [ -z "$pid" ] && return 0
  if kill -0 "$pid" 2>/dev/null; then
    local children=""
    children=$(pgrep -P "$pid" 2>/dev/null || true)
    for child in $children; do
      force_kill_tree "$child"
    done
    kill -KILL "$pid" 2>/dev/null || true
  fi
}

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  terminate_tree "$NEXT_PID"
  terminate_tree "$V1_PID"
  sleep 1
  force_kill_tree "$NEXT_PID"
  force_kill_tree "$V1_PID"
  exit "$code"
}
trap cleanup EXIT INT TERM

prefix_output() {
  local label="$1"
  local color="$2"
  local reset="\033[0m"
  while IFS= read -r line; do
    printf "%b[%s]%b %s\n" "$color" "$label" "$reset" "$line"
  done
}

# Free the V1 port if a stale instance is squatting on it.
if lsof -ti tcp:"$V1_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[dev-stack] port ${V1_PORT} already in use; killing stale listener…"
  lsof -ti tcp:"$V1_PORT" -sTCP:LISTEN | xargs -r kill -TERM 2>/dev/null || true
  sleep 1
fi

echo "[dev-stack] starting v1-api on :${V1_PORT}"
(
  pnpm --silent v1api:dev 2>&1 | prefix_output "v1-api" "\033[36m"
) &
V1_PID=$!

# Wait for V1 to start accepting TCP connections so the first Next.js
# request doesn't ECONNREFUSED. Use a TCP probe instead of /health
# because /health does a real DB probe and can be slow on first boot.
echo "[dev-stack] waiting for v1-api on :${V1_PORT}"
deadline=$(( $(date +%s) * 1000 + WAIT_TIMEOUT_MS ))
port_open() {
  if command -v nc >/dev/null 2>&1; then
    nc -z localhost "$V1_PORT" >/dev/null 2>&1
  else
    (exec 3<>/dev/tcp/localhost/"$V1_PORT") >/dev/null 2>&1 && exec 3<&- 3>&-
  fi
}
while :; do
  if ! kill -0 "$V1_PID" 2>/dev/null; then
    echo "[dev-stack] v1-api exited before becoming ready"
    exit 1
  fi
  if port_open; then
    break
  fi
  now_ms=$(( $(date +%s) * 1000 ))
  if [ "$now_ms" -gt "$deadline" ]; then
    echo "[dev-stack] timed out waiting for v1-api on :${V1_PORT}"
    exit 1
  fi
  sleep 0.25
done
echo "[dev-stack] v1-api ready on :${V1_PORT}"

echo "[dev-stack] starting next dev on :${NEXT_PORT}"
(
  V1_API_URL="${V1_API_URL:-http://localhost:${V1_PORT}}" \
    pnpm exec next dev --webpack -p "$NEXT_PORT" 2>&1 | prefix_output "next" "\033[35m"
) &
NEXT_PID=$!

# Wait for either child to exit and propagate its status.
wait -n "$V1_PID" "$NEXT_PID"
status=$?
echo "[dev-stack] a child exited (status ${status}); shutting down…"
exit "$status"
