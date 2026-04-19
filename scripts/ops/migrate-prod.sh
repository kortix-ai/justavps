#!/usr/bin/env bash
# Apply pending schema migrations to a prod or preview database.
#
# All files 0004+ under db/migrations/ are idempotent (IF NOT EXISTS,
# duplicate_object guards). Re-running is a no-op once applied.
#
# Baseline 0000-0003 are skipped: they created core tables long ago and
# are not idempotent. Every running prod already has them.
#
# Safety:
#   - Hard-fails if any migration file contains an unguarded DROP.
#   - Runs each file in its own transaction (psql -1) with ON_ERROR_STOP.
#   - --dry lists which files would be applied without touching the DB.
#
# Usage:
#   DATABASE_URL=<prod-url> ./scripts/ops/migrate-prod.sh          # apply
#   DATABASE_URL=<prod-url> ./scripts/ops/migrate-prod.sh --dry    # preview
set -euo pipefail

MODE="${1:-apply}"
case "$MODE" in
  --dry|--dry-run|dry) MODE=dry ;;
  ""|apply)            MODE=apply ;;
  *) echo "unknown arg: $MODE (use --dry to preview)" >&2; exit 2 ;;
esac

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL must be set (point at the target DB)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/db/migrations"

if [ ! -d "$MIG_DIR" ]; then
  echo "migrations dir not found: $MIG_DIR" >&2
  exit 1
fi

# Every file we would touch must be idempotent. Unguarded DROP/TRUNCATE/DELETE
# without IF EXISTS / duplicate_object would be a data-loss risk.
pending=()
for f in "$MIG_DIR"/*.sql; do
  name=$(basename "$f")
  # Skip pre-v2 baseline files.
  case "$name" in
    0000_*|0001_*|0002_*|0003_*) continue ;;
  esac
  pending+=("$f")
done

for f in "${pending[@]}"; do
  # Any DROP/TRUNCATE must be explicitly guarded. Flag anything else.
  unsafe=$(grep -iE "^\s*(drop|truncate|delete from)" "$f" | grep -viE "if exists|duplicate_object" || true)
  if [ -n "$unsafe" ]; then
    echo "UNSAFE unguarded destructive SQL in $f:" >&2
    echo "$unsafe" >&2
    exit 3
  fi
done

if [ "$MODE" = "dry" ]; then
  echo "--- dry run (no DB writes). Target: ${DATABASE_URL%%\?*} ---"
  for f in "${pending[@]}"; do
    printf "  would apply %s\n" "$(basename "$f")"
  done
  echo "--- ${#pending[@]} files pending ---"
  exit 0
fi

echo "Applying ${#pending[@]} migrations to ${DATABASE_URL%%\?*}"
for f in "${pending[@]}"; do
  printf "  %s ... " "$(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -q -f "$f" >/dev/null
  echo "ok"
done
echo "All migrations applied."
