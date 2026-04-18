#!/usr/bin/env bash
#
# dev-with-stripe.sh — Starts Next.js dev server + Stripe webhook forwarding.
#
# The Stripe CLI forwards webhook events to the local API endpoint and
# auto-generates a webhook signing secret. This script captures that secret,
# writes it to .env, and starts both processes in parallel.
#
# Usage: pnpm dev:stripe
#
# Prerequisites:
#   - Stripe CLI installed: brew install stripe/stripe-cli/stripe
#   - STRIPE_SECRET_KEY set in .env
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
ENV_FILE="$PROJECT_DIR/.env"
ENV_LOCAL_FILE="$PROJECT_DIR/.env.local"
WEBHOOK_URL="http://localhost:4100/api/v1/stripe/webhooks"
EVENTS="checkout.session.completed,invoice.payment_failed,customer.subscription.deleted,customer.subscription.updated"

# Source .env first, then .env.local — local overrides win (matches Next.js
# env priority). Without .env.local here, DATABASE_URL from .env (prod Neon)
# would leak into the shell env and Next.js would use that instead of the
# local Postgres override, silently querying prod.
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi
if [ -f "$ENV_LOCAL_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_LOCAL_FILE"
  set +a
fi

if [ -z "${STRIPE_SECRET_KEY:-}" ]; then
  echo "[dev-with-stripe] STRIPE_SECRET_KEY is missing. Set it in .env first."
  exit 1
fi

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}[dev-with-stripe]${NC} Starting Stripe webhook listener..."

# Get the webhook signing secret from Stripe CLI (printed on first line of `stripe listen`)
# We run it in the background and capture the secret from its output.
STRIPE_LOG=$(mktemp)
stripe listen --api-key "$STRIPE_SECRET_KEY" --forward-to "$WEBHOOK_URL" --events "$EVENTS" > "$STRIPE_LOG" 2>&1 &
STRIPE_PID=$!

# Wait for the webhook secret to appear in output (up to 15s)
WEBHOOK_SECRET=""
for i in $(seq 1 30); do
  if grep -q "whsec_" "$STRIPE_LOG" 2>/dev/null; then
    WEBHOOK_SECRET=$(grep -o 'whsec_[a-zA-Z0-9]*' "$STRIPE_LOG" | head -1)
    break
  fi
  sleep 0.5
done

if [ -z "$WEBHOOK_SECRET" ]; then
  echo -e "${YELLOW}[dev-with-stripe]${NC} Warning: Could not capture webhook secret from Stripe CLI output."
  echo -e "${YELLOW}[dev-with-stripe]${NC} Continuing, but webhook verification may fail until STRIPE_WEBHOOK_SECRET is set."
else
  echo -e "${GREEN}[dev-with-stripe]${NC} Captured webhook secret: ${WEBHOOK_SECRET:0:12}..."

  # Update .env with the webhook secret
  if grep -q "^STRIPE_WEBHOOK_SECRET=" "$ENV_FILE" 2>/dev/null; then
    # Replace existing line (macOS sed)
    sed -i '' "s|^STRIPE_WEBHOOK_SECRET=.*|STRIPE_WEBHOOK_SECRET=$WEBHOOK_SECRET|" "$ENV_FILE"
  else
    printf '\nSTRIPE_WEBHOOK_SECRET=%s\n' "$WEBHOOK_SECRET" >> "$ENV_FILE"
  fi

  echo -e "${GREEN}[dev-with-stripe]${NC} Updated .env with STRIPE_WEBHOOK_SECRET"
fi

rm -f "$STRIPE_LOG"

# Cleanup on exit
cleanup() {
  echo -e "\n${BLUE}[dev-with-stripe]${NC} Shutting down..."
  if [ -n "${STRIPE_PID:-}" ] && kill -0 "$STRIPE_PID" 2>/dev/null; then
    kill "$STRIPE_PID" 2>/dev/null || true
    wait "$STRIPE_PID" 2>/dev/null || true
  fi
  if [ -n "${NEXT_PID:-}" ] && kill -0 "$NEXT_PID" 2>/dev/null; then
    kill "$NEXT_PID" 2>/dev/null || true
    wait "$NEXT_PID" 2>/dev/null || true
  fi
  echo -e "${BLUE}[dev-with-stripe]${NC} Done."
}
trap cleanup EXIT INT TERM

echo -e "${GREEN}[dev-with-stripe]${NC} Starting Next.js dev server on port 4100..."
echo -e "${GREEN}[dev-with-stripe]${NC} Stripe webhooks forwarding to: $WEBHOOK_URL"
echo -e "${GREEN}[dev-with-stripe]${NC} Listening for events: $EVENTS"
echo ""

# Start Next.js dev server
pnpm dev &
NEXT_PID=$!

# Wait for either process to exit
wait -n "$STRIPE_PID" "$NEXT_PID" 2>/dev/null || true
