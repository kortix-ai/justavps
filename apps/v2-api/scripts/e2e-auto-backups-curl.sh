#!/usr/bin/env bash
set -Eeuo pipefail

API_URL="${V2_API_URL:-http://localhost:4200}"
ADMIN_TOKEN="${V2_E2E_ADMIN_TOKEN:-${V2_ADMIN_TOKEN:-v2e2e-admin}}"
ACCOUNT_ID="${V2_E2E_ACCOUNT_ID:-system}"
TEMPLATE_ID="${V2_E2E_TEMPLATE_ID:-${V2_E2E_IMAGE_ID:-justavps-ubuntu-24.04-template}}"
RESOURCE_VCPU="${V2_E2E_AUTO_BACKUP_VCPU:-1}"
RESOURCE_MEMORY_GB="${V2_E2E_AUTO_BACKUP_MEMORY_GB:-1}"
RESOURCE_DISK_GB="${V2_E2E_AUTO_BACKUP_DISK_GB:-10}"
MARKER_PATH="${V2_E2E_AUTO_BACKUP_MARKER_PATH:-/root/justavps-auto-backup-e2e.txt}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$(mktemp -d "$API_DIR/.e2e-auto-backups.XXXXXX")"
MACHINE_ID=""
CREATED_BACKUPS=""

log() { printf '[auto-backups-e2e] %s\n' "$*"; }
fail() { printf '[auto-backups-e2e] ERROR: %s\n' "$*" >&2; exit 1; }

json_get() {
  python3 - "$1" "$2" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    value = json.load(f)
for part in sys.argv[2].split('.'):
    if part == '':
        continue
    value = value[int(part)] if isinstance(value, list) else value[part]
if isinstance(value, (dict, list)):
    print(json.dumps(value, separators=(',', ':')))
elif value is None:
    print('')
else:
    print(value)
PY
}

json_assert() {
  python3 - "$1" "$2" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
safe = {'d': d, 'len': len, 'any': any, 'all': all, 'sorted': sorted, 'str': str, 'int': int, 'float': float}
if not eval(sys.argv[2], {'__builtins__': {}}, safe):
    raise SystemExit(f'assertion failed: {sys.argv[2]}\njson={json.dumps(d)[:4000]}')
PY
}

request() {
  local method="$1"
  local path="$2"
  local body_file="${3:-}"
  local out_file="$4"
  shift 4 || true
  local meta_file="$TMP_DIR/meta-$(date +%s)-$RANDOM.txt"
  local curl_args=(-sS -o "$out_file" -w '%{http_code} %{time_total}' -X "$method" -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Account-Id: $ACCOUNT_ID")
  for header in "$@"; do curl_args+=(-H "$header"); done
  if [[ -n "$body_file" ]]; then curl_args+=(-H 'Content-Type: application/json' --data-binary "@$body_file"); fi
  curl_args+=("$API_URL$path")
  if ! curl "${curl_args[@]}" > "$meta_file"; then
    [[ -s "$out_file" ]] && cat "$out_file" >&2 || true
    fail "curl failed for $method $path"
  fi
  local code time_total
  read -r code time_total < "$meta_file" || true
  if [[ "$code" -lt 200 || "$code" -ge 300 ]]; then
    cat "$out_file" >&2 || true
    fail "$method $path returned HTTP $code"
  fi
  printf '%s' "$time_total" > "$out_file.time_total"
}

write_db_helper() {
  cat > "$TMP_DIR/auto-backup-db.ts" <<'TS'
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: '../../.env', quiet: true });
dotenv.config({ path: '../../.env.local', override: true, quiet: true });
dotenv.config({ quiet: true });
dotenv.config({ path: '.env.local', override: true, quiet: true });
if (process.env.V2_DATABASE_URL && !process.env.DATABASE_URL) process.env.DATABASE_URL = process.env.V2_DATABASE_URL;

const prisma = new PrismaClient();
const [action, machineId, backupName] = process.argv.slice(2);
const past = new Date(Date.now() - 60_000);

try {
  if (action === 'force-due') {
    const policy = await prisma.machineBackupPolicy.update({
      where: { machineId },
      data: { enabled: true, status: 'active', nextBackupAt: past },
    });
    console.log(JSON.stringify({ action, policy_id: policy.id, machine_id: policy.machineId, next_backup_at: policy.nextBackupAt?.toISOString() ?? null }));
  } else if (action === 'expire-backup') {
    if (!backupName) throw new Error('backupName required');
    const row = await prisma.backup.findFirst({ where: { machineId, incusBackupName: backupName } });
    if (!row) throw new Error(`backup row not found: ${backupName}`);
    const retention = { ...(row.retentionPolicy as Record<string, unknown>), trigger: 'auto', expires_at: past.toISOString() };
    const metadata = { ...(row.metadata as Record<string, unknown>), trigger: 'auto', expires_at: past.toISOString(), e2e_forced_expired_at: new Date().toISOString() };
    const updated = await prisma.backup.update({
      where: { id: row.id },
      data: { retentionPolicy: retention, metadata },
    });
    console.log(JSON.stringify({ action, backup_id: updated.id, backup_name: updated.incusBackupName, expires_at: past.toISOString() }));
  } else if (action === 'summary') {
    const [policy, backups] = await Promise.all([
      prisma.machineBackupPolicy.findUnique({ where: { machineId } }),
      prisma.backup.findMany({ where: { machineId }, orderBy: { createdAt: 'asc' } }),
    ]);
    console.log(JSON.stringify({
      policy: policy ? {
        id: policy.id,
        enabled: policy.enabled,
        cadence: policy.cadence,
        retention_days: policy.retentionDays,
        retention_count: policy.retentionCount,
        last_backup_at: policy.lastBackupAt?.toISOString() ?? null,
        next_backup_at: policy.nextBackupAt?.toISOString() ?? null,
      } : null,
      backups: backups.map((row) => ({
        id: row.id,
        name: row.incusBackupName,
        status: row.status,
        trigger: (row.retentionPolicy as Record<string, unknown>).trigger ?? (row.metadata as Record<string, unknown>).trigger ?? 'manual',
        policy_id: (row.retentionPolicy as Record<string, unknown>).policy_id ?? null,
        expires_at: (row.retentionPolicy as Record<string, unknown>).expires_at ?? (row.metadata as Record<string, unknown>).expires_at ?? null,
        created_at: row.createdAt.toISOString(),
      })),
    }, null, 2));
  } else {
    throw new Error(`unknown action: ${action}`);
  }
} finally {
  await prisma.$disconnect();
}
TS
}

db_action() {
  local action="$1"
  shift
  (cd "$API_DIR" && pnpm exec tsx "$TMP_DIR/auto-backup-db.ts" "$action" "$@")
}

wait_next_second() {
  python3 <<'PY'
import time
start = int(time.time())
while int(time.time()) <= start:
    pass
PY
}

backup_names_by_trigger() {
  local file="$1"
  local trigger="$2"
  python3 - "$file" "$trigger" <<'PY'
import json, sys
d=json.load(open(sys.argv[1])); trigger=sys.argv[2]
print('\n'.join(b.get('name') or b.get('incus_backup_name') for b in d.get('backups', []) if b.get('trigger') == trigger))
PY
}

cleanup() {
  set +e
  log "cleanup machine=$MACHINE_ID account=$ACCOUNT_ID"
  if [[ -n "$MACHINE_ID" ]]; then
    curl -sS -o /dev/null -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' --data-binary '{"enabled":false}' "$API_URL/machines/$MACHINE_ID/backup-policy" || true
    local cleanup_backups="$TMP_DIR/cleanup-backups.json"
    curl -sS -o "$cleanup_backups" -H "Authorization: Bearer $ADMIN_TOKEN" "$API_URL/machines/$MACHINE_ID/backups" || true
    if [[ -s "$cleanup_backups" ]]; then
      python3 - "$cleanup_backups" <<'PY' | while read -r backup_name; do
import json, sys
try:
    d=json.load(open(sys.argv[1]))
except Exception:
    d={}
for b in d.get('backups', []):
    name=b.get('name') or b.get('incus_backup_name')
    if name:
        print(name)
PY
        curl -sS -o /dev/null -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$API_URL/machines/$MACHINE_ID/backups/$backup_name" || true
      done
    fi
    curl -sS -o /dev/null -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$API_URL/machines/$MACHINE_ID" || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

assert_backup_present() {
  local backups_file="$1"
  local backup_name="$2"
  local expected_trigger="$3"
  python3 - "$backups_file" "$backup_name" "$expected_trigger" <<'PY'
import json, sys
d=json.load(open(sys.argv[1])); name=sys.argv[2]; trigger=sys.argv[3]
match=next((b for b in d.get('backups', []) if (b.get('name') or b.get('incus_backup_name')) == name), None)
if not match:
    raise SystemExit(f'backup {name} not found: {d}')
if match.get('trigger') != trigger:
    raise SystemExit(f'backup {name} trigger {match.get("trigger")} != {trigger}: {match}')
if trigger == 'auto':
    assert match.get('policy_id'), match
    assert match.get('expires_at'), match
    assert match.get('restore_snapshot') == f'bk-snap-{name}', match
print(json.dumps({'name': name, 'trigger': trigger, 'expires_at': match.get('expires_at'), 'restore_snapshot': match.get('restore_snapshot'), 'cost_attribution': bool(match.get('cost_attribution'))}, separators=(',', ':')))
PY
}

log "preflight api=$API_URL account=$ACCOUNT_ID template=$TEMPLATE_ID"
write_db_helper
request GET /health '' "$TMP_DIR/health.json"
json_assert "$TMP_DIR/health.json" 'd["status"] == "ok" and d["database_configured"] is True and d["incus_clusters_configured"] >= 1'

request GET /machine-templates '' "$TMP_DIR/templates.json"
python3 - "$TMP_DIR/templates.json" "$TEMPLATE_ID" <<'PY'
import json, sys
d=json.load(open(sys.argv[1])); wanted=sys.argv[2]
templates=d.get('templates', [])
match=next((t for t in templates if t.get('id') == wanted or t.get('slug') == wanted), None)
if not match:
    raise SystemExit(f'template {wanted} not found; available={[t.get("id") or t.get("slug") for t in templates]}')
if match.get('status') != 'active':
    raise SystemExit(f'template {wanted} not active: {match}')
readiness=match.get('readiness') or {}
if readiness and readiness.get('ready') is False:
    raise SystemExit(f'template {wanted} not ready: {readiness}')
print(json.dumps({'template_id': match.get('id'), 'slug': match.get('slug'), 'status': match.get('status'), 'ready': readiness.get('ready')}, separators=(',', ':')))
PY

log "create fresh machine"
cat > "$TMP_DIR/create-machine.json" <<JSON
{"type":"container","name":"auto-backup-e2e-$(date +%s)","template_id":"$TEMPLATE_ID","start_strategy":"auto","resources":{"vcpu":$RESOURCE_VCPU,"memory_gb":$RESOURCE_MEMORY_GB,"disk_gb":$RESOURCE_DISK_GB}}
JSON
request POST /machines "$TMP_DIR/create-machine.json" "$TMP_DIR/create-machine.out.json" "X-JustAVPS-Request-Id: auto-backup-e2e-$(date +%s)"
MACHINE_ID="$(json_get "$TMP_DIR/create-machine.out.json" machine.id)"
[[ -n "$MACHINE_ID" ]] || fail 'machine id missing'
log "machine=$MACHINE_ID"

log "write pre-backup marker"
python3 - "$MARKER_PATH" > "$TMP_DIR/file-before.json" <<'PY'
import json, sys
print(json.dumps({'path': sys.argv[1], 'content': 'before-auto-backup', 'create_dirs': True}))
PY
request PUT "/machines/$MACHINE_ID/files" "$TMP_DIR/file-before.json" "$TMP_DIR/file-before.out.json"

log "initial policy disabled"
request GET "/machines/$MACHINE_ID/backup-policy" '' "$TMP_DIR/policy.initial.json"
json_assert "$TMP_DIR/policy.initial.json" 'd["policy"]["enabled"] is False and d["policy"]["retention_days"] == 7 and d["policy"]["retention_count"] == 7 and d["policy"]["cadence"] == "daily"'

log "enable auto backups"
cat > "$TMP_DIR/policy-enable.json" <<'JSON'
{"enabled":true}
JSON
request PATCH "/machines/$MACHINE_ID/backup-policy" "$TMP_DIR/policy-enable.json" "$TMP_DIR/policy.enabled.json"
json_assert "$TMP_DIR/policy.enabled.json" 'd["policy"]["enabled"] is True and d["policy"]["id"] and d["policy"]["next_backup_at"] and d["policy"]["retention_days"] == 7 and d["policy"]["retention_count"] == 7'
POLICY_ID="$(json_get "$TMP_DIR/policy.enabled.json" policy.id)"

log "force first due sweep"
request POST /admin/backups/sweep '' "$TMP_DIR/sweep1.json"
json_assert "$TMP_DIR/sweep1.json" 'any(item["machine_id"] for item in d["created"]) and len(d["errors"]) == 0'
AUTO1="$(json_get "$TMP_DIR/sweep1.json" created.0.backup_name)"
CREATED_BACKUPS="$CREATED_BACKUPS $AUTO1"
log "auto1=$AUTO1"

request GET "/machines/$MACHINE_ID/backups" '' "$TMP_DIR/backups.after-auto1.json"
assert_backup_present "$TMP_DIR/backups.after-auto1.json" "$AUTO1" auto
request GET "/machines/$MACHINE_ID/snapshots" '' "$TMP_DIR/snapshots.after-auto1.json"
python3 - "$TMP_DIR/snapshots.after-auto1.json" "bk-snap-$AUTO1" <<'PY'
import json, sys
d=json.load(open(sys.argv[1])); wanted=sys.argv[2]
if not any(s.get('name') == wanted for s in d.get('snapshots', [])):
    raise SystemExit(f'restore snapshot {wanted} missing: {d}')
print(f'restore_snapshot_present={wanted}')
PY
request GET "/machines/$MACHINE_ID/backup-policy" '' "$TMP_DIR/policy.after-auto1.json"
json_assert "$TMP_DIR/policy.after-auto1.json" 'd["policy"]["last_backup_at"] and d["policy"]["next_backup_at"] and d["policy"]["enabled"] is True'

log "mutate marker, restore from auto backup, verify rollback"
python3 - "$MARKER_PATH" > "$TMP_DIR/file-after.json" <<'PY'
import json, sys
print(json.dumps({'path': sys.argv[1], 'content': 'after-auto-backup', 'create_dirs': True}))
PY
request PUT "/machines/$MACHINE_ID/files" "$TMP_DIR/file-after.json" "$TMP_DIR/file-after.out.json"
request POST "/machines/$MACHINE_ID/backups/$AUTO1/restore" '' "$TMP_DIR/restore-auto1.json"
json_assert "$TMP_DIR/restore-auto1.json" 'd["ok"] is True'
request GET "/machines/$MACHINE_ID/files?path=$MARKER_PATH" '' "$TMP_DIR/file-restored.json"
json_assert "$TMP_DIR/file-restored.json" 'd["content"] == "before-auto-backup"'

log "create manual backup; it must survive auto pruning"
MANUAL="manual-auto-backup-e2e-$(date +%s)"
cat > "$TMP_DIR/manual-backup.json" <<JSON
{"name":"$MANUAL","instance_only":false,"optimized_storage":true}
JSON
request POST "/machines/$MACHINE_ID/backups" "$TMP_DIR/manual-backup.json" "$TMP_DIR/manual-backup.out.json"
CREATED_BACKUPS="$CREATED_BACKUPS $MANUAL"
request GET "/machines/$MACHINE_ID/backups" '' "$TMP_DIR/backups.after-manual.json"
assert_backup_present "$TMP_DIR/backups.after-manual.json" "$MANUAL" manual

log "expire first auto row in DB; next sweep must prune it and create a fresh auto backup"
db_action expire-backup "$MACHINE_ID" "$AUTO1" > "$TMP_DIR/db-expire-auto1.json"
db_action force-due "$MACHINE_ID" > "$TMP_DIR/db-force-due-expiry.json"
wait_next_second
request POST /admin/backups/sweep '' "$TMP_DIR/sweep-expiry.json"
json_assert "$TMP_DIR/sweep-expiry.json" 'len(d["errors"]) == 0 and any(item["machine_id"] for item in d["created"]) and any(item["machine_id"] for item in d["pruned"])'
AUTO2="$(json_get "$TMP_DIR/sweep-expiry.json" created.0.backup_name)"
CREATED_BACKUPS="$CREATED_BACKUPS $AUTO2"
request GET "/machines/$MACHINE_ID/backups" '' "$TMP_DIR/backups.after-expiry-prune.json"
python3 - "$TMP_DIR/backups.after-expiry-prune.json" "$AUTO1" "$AUTO2" "$MANUAL" <<'PY'
import json, sys
d=json.load(open(sys.argv[1])); auto1, auto2, manual=sys.argv[2:5]
names={b.get('name') or b.get('incus_backup_name') for b in d.get('backups', [])}
if auto1 in names:
    raise SystemExit(f'expired auto backup still exists: {auto1}')
for required in (auto2, manual):
    if required not in names:
        raise SystemExit(f'required backup missing after expiry prune: {required} names={names}')
print(json.dumps({'expired_pruned': auto1, 'fresh_auto': auto2, 'manual_survived': manual}, separators=(',', ':')))
PY

log "create enough due auto backups to validate 7-recovery-point retention"
LAST_AUTO="$AUTO2"
for i in 1 2 3 4 5 6 7; do
  db_action force-due "$MACHINE_ID" > "$TMP_DIR/db-force-due-count-$i.json"
  wait_next_second
  request POST /admin/backups/sweep '' "$TMP_DIR/sweep-count-$i.json"
  json_assert "$TMP_DIR/sweep-count-$i.json" 'len(d["errors"]) == 0 and any(item["machine_id"] for item in d["created"])'
  LAST_AUTO="$(json_get "$TMP_DIR/sweep-count-$i.json" created.0.backup_name)"
  CREATED_BACKUPS="$CREATED_BACKUPS $LAST_AUTO"
  log "created count-test auto[$i]=$LAST_AUTO"
done

request GET "/machines/$MACHINE_ID/backups" '' "$TMP_DIR/backups.after-count-prune.json"
python3 - "$TMP_DIR/backups.after-count-prune.json" "$AUTO2" "$LAST_AUTO" "$MANUAL" <<'PY'
import json, sys
d=json.load(open(sys.argv[1])); auto2, latest, manual=sys.argv[2:5]
backups=d.get('backups', [])
autos=[b for b in backups if b.get('trigger') == 'auto']
manuals=[b for b in backups if b.get('trigger') == 'manual']
auto_names={b.get('name') or b.get('incus_backup_name') for b in autos}
all_names={b.get('name') or b.get('incus_backup_name') for b in backups}
if len(autos) != 7:
    raise SystemExit(f'expected exactly 7 auto backups after count prune, got {len(autos)}: {auto_names}')
if auto2 in auto_names:
    raise SystemExit(f'oldest auto backup was not count-pruned: {auto2}')
if latest not in auto_names:
    raise SystemExit(f'latest auto backup missing: {latest}')
if manual not in all_names:
    raise SystemExit(f'manual backup was pruned incorrectly: {manual}')
for b in autos:
    assert b.get('policy_id'), b
    assert b.get('expires_at'), b
    assert b.get('restore_snapshot') == f"bk-snap-{b.get('name') or b.get('incus_backup_name')}", b
print(json.dumps({'auto_backup_count': len(autos), 'manual_backup_count': len(manuals), 'count_pruned_oldest': auto2, 'latest_auto': latest, 'manual_survived': manual}, separators=(',', ':')))
PY

log "DB summary"
db_action summary "$MACHINE_ID" > "$TMP_DIR/db-summary.json"
python3 - "$TMP_DIR/db-summary.json" "$POLICY_ID" <<'PY'
import json, sys
d=json.load(open(sys.argv[1])); policy_id=sys.argv[2]
p=d.get('policy') or {}
if p.get('id') != policy_id or p.get('enabled') is not True:
    raise SystemExit(f'policy mismatch: {p}')
if p.get('retention_days') != 7 or p.get('retention_count') != 7:
    raise SystemExit(f'retention mismatch: {p}')
auto=[b for b in d.get('backups', []) if b.get('trigger') == 'auto']
manual=[b for b in d.get('backups', []) if b.get('trigger') == 'manual']
if len(auto) != 7 or len(manual) < 1:
    raise SystemExit(f'bad db backup counts: auto={len(auto)} manual={len(manual)} rows={d.get("backups")}')
print(json.dumps({'policy_id': policy_id, 'db_auto_rows': len(auto), 'db_manual_rows': len(manual), 'last_backup_at': p.get('last_backup_at'), 'next_backup_at': p.get('next_backup_at')}, separators=(',', ':')))
PY

log "PASS auto backups E2E machine=$MACHINE_ID policy=$POLICY_ID"
