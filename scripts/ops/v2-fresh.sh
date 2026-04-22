#!/usr/bin/env bash
# v2-fresh.sh — orchestrate a clean v2 e2e run against the local sim.
#
#   1. Reset v2 DB state + checkpoints
#   2. Start the runnerd simulator (if not already running)
#   3. Seed the sim host row
#   4. Run the full v2 suite (core + UI)
#   5. Clean up sim on exit
set -euo pipefail

cd "$(dirname "$0")/../.."

SIM_LOG=/tmp/v2-fresh-sim.log
SIM_PID=""

cleanup() {
  if [ -n "${SIM_PID}" ] && kill -0 "${SIM_PID}" 2>/dev/null; then
    echo "[v2-fresh] stopping sim (pid ${SIM_PID})"
    kill "${SIM_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "[v2-fresh] resetting v2 state"
pnpm v2:reset

echo "[v2-fresh] checking sim"
if ! curl -sf http://127.0.0.1:7780/healthz >/dev/null 2>&1; then
  echo "[v2-fresh] starting sim (log → ${SIM_LOG})"
  : > "${SIM_LOG}"
  nohup pnpm v2:sim > "${SIM_LOG}" 2>&1 &
  SIM_PID=$!
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -sf http://127.0.0.1:7780/healthz >/dev/null 2>&1; then
      echo "[v2-fresh] sim ready"
      break
    fi
    sleep 1
  done
  if ! curl -sf http://127.0.0.1:7780/healthz >/dev/null 2>&1; then
    echo "[v2-fresh] sim never came up; log:"
    tail -30 "${SIM_LOG}"
    exit 1
  fi
else
  echo "[v2-fresh] sim already running"
fi

echo "[v2-fresh] seeding dev host"
pnpm v2:seed:dev

echo "[v2-fresh] running full v2 suite"
export E2E_BAREMETAL_HOST_ID=ed822eae-59ef-4601-8782-a17cc85196ab
pnpm e2e:v2:all
echo "[v2-fresh] all green"
