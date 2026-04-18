#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

callback_url="$($SCRIPT_DIR/dev-ngrok-callback.sh start)"

printf '[dev:ngrok] MACHINE_CALLBACK_URL=%s\n' "$callback_url"
printf '[dev:ngrok] .env.local updated; starting Next.js on http://localhost:4100\n'

cd "$PROJECT_DIR"
exec pnpm dev
