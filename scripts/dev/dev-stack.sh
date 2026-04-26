#!/usr/bin/env bash
# dev-stack.sh — runs the full local dev stack:
#   - apps/v1-api  on :4101 (V1 HTTP API; Next /api/* proxies here)
#   - apps/v2-api  on :4200 (V2 Incus API; Next /admin-ui/* proxies here)
#   - Next.js web  on :4100 (UI shell; proxies V1 + V2 admin)
#
# All three children run under one foreground process group; ^C/SIGTERM
# cleanly tears down the whole subprocess tree. Output is line-prefixed so
# it's clear which process logged what.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

V1_PORT="${V1_API_PORT:-4101}"
V2_PORT="${V2_API_PORT:-4200}"
NEXT_PORT="${NEXT_PORT:-4100}"
WAIT_TIMEOUT_MS="${DEV_STACK_WAIT_TIMEOUT_MS:-60000}"

# CORS / API URLs — by default trust the Next dev origin and let the
# admin-web UI hit the V2 API directly when it loads.
V2_CORS_ORIGINS_DEFAULT="http://localhost:${NEXT_PORT},http://127.0.0.1:${NEXT_PORT},http://localhost:${V2_PORT}"
export V2_CORS_ORIGINS="${V2_CORS_ORIGINS:-${V2_CORS_ORIGINS_DEFAULT}}"

V1_PID=""
V2_PID=""
NEXT_PID=""

terminate_tree() {
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
  terminate_tree "$V2_PID"
  terminate_tree "$V1_PID"
  sleep 1
  force_kill_tree "$NEXT_PID"
  force_kill_tree "$V2_PID"
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

free_port() {
  local port="$1"
  if lsof -ti tcp:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[dev-stack] port ${port} already in use; killing stale listener…"
    lsof -ti tcp:"$port" -sTCP:LISTEN | xargs -r kill -TERM 2>/dev/null || true
    sleep 1
  fi
}

port_open() {
  local port="$1"
  if command -v nc >/dev/null 2>&1; then
    nc -z localhost "$port" >/dev/null 2>&1
  else
    (exec 3<>/dev/tcp/localhost/"$port") >/dev/null 2>&1 && exec 3<&- 3>&-
  fi
}

wait_for_port() {
  local label="$1"
  local port="$2"
  local pid="$3"
  echo "[dev-stack] waiting for ${label} on :${port}"
  local deadline=$(( $(date +%s) * 1000 + WAIT_TIMEOUT_MS ))
  while :; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "[dev-stack] ${label} exited before becoming ready"
      exit 1
    fi
    if port_open "$port"; then
      break
    fi
    local now_ms=$(( $(date +%s) * 1000 ))
    if [ "$now_ms" -gt "$deadline" ]; then
      echo "[dev-stack] timed out waiting for ${label} on :${port}"
      exit 1
    fi
    sleep 0.25
  done
  echo "[dev-stack] ${label} ready on :${port}"
}

free_port "$V1_PORT"
free_port "$V2_PORT"
free_port "$NEXT_PORT"

echo "[dev-stack] starting v1-api on :${V1_PORT}"
(
  pnpm --silent v1api:dev 2>&1 | prefix_output "v1-api" "\033[36m"
) &
V1_PID=$!
wait_for_port "v1-api" "$V1_PORT" "$V1_PID"

echo "[dev-stack] starting v2-api on :${V2_PORT}"
(
  V2_API_PORT="$V2_PORT" \
    V2_CORS_ORIGINS="$V2_CORS_ORIGINS" \
    pnpm --silent v2api:dev 2>&1 | prefix_output "v2-api" "\033[33m"
) &
V2_PID=$!
wait_for_port "v2-api" "$V2_PORT" "$V2_PID"

echo "[dev-stack] starting next dev on :${NEXT_PORT}"
(
  V1_API_URL="${V1_API_URL:-http://localhost:${V1_PORT}}" \
    NEXT_PUBLIC_V2_ADMIN_URL="${NEXT_PUBLIC_V2_ADMIN_URL:-http://localhost:${V2_PORT}/admin-ui}" \
    pnpm exec next dev --webpack -p "$NEXT_PORT" 2>&1 | prefix_output "next" "\033[35m"
) &
NEXT_PID=$!

echo "[dev-stack] up: v1=:${V1_PORT}  v2=:${V2_PORT}  next=:${NEXT_PORT}"
echo "[dev-stack]   - V1 dashboard: http://localhost:${NEXT_PORT}/"
echo "[dev-stack]   - V2 admin UI:  http://localhost:${V2_PORT}/admin-ui/  (also picked from V1 sidebar version selector)"

wait -n "$V1_PID" "$V2_PID" "$NEXT_PID"
status=$?
echo "[dev-stack] a child exited (status ${status}); shutting down…"
exit "$status"
