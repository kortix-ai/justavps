#!/usr/bin/env bash
# Boot-up time benchmark for V2 API: creates+starts N containers and N VMs,
# measures wall-clock from POST /machines until status=Running, then prints
# min/median/p95/max for each instance type. All instances are torn down.
#
# Hardened-security defaults from the V2 API are in effect — this measures the
# real cold-start cost users see, not a stripped config. Override count via
# V2_E2E_BENCH_COUNT (default 3).
set -euo pipefail

source "$(dirname "$0")/lib.sh"
require_live
require_image
require_vm_image

count="${V2_E2E_BENCH_COUNT:-3}"
region="${V2_E2E_REGION:-eu}"
disk_gb="${V2_E2E_DISK_GB:-10}"

# Track every machine we create so the cleanup trap can drop them even on
# partial failure — boot benchmarks are expensive, leaks are worse.
machines=()
cleanup() {
  for id in "${machines[@]:-}"; do
    [ -z "$id" ] && continue
    request DELETE "/machines/$id" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

# Boot a single instance of the requested type and echo "<seconds>" to stdout.
# Steps: POST /machines -> POST /start -> poll GET /machines/:id until Running.
# We measure POST-create-through-Running, which is what the user perceives.
boot_one() {
  local type="$1"
  local image="$2"
  local label="bench-${type}-$(date +%s)-${RANDOM}"
  local body
  body="$(node -e 'console.log(JSON.stringify({region:process.argv[1],type:process.argv[2],name:process.argv[3],resources:{vcpu:1,memory_gb:1,disk_gb:Number(process.argv[4])},source:{type:"image",image_id:process.argv[5]}}))' "$region" "$type" "$label" "$disk_gb" "$image")"

  local start_ms end_ms id status deadline
  start_ms="$(date +%s%3N)"

  local create_json
  create_json="$(request POST /machines "$body")"
  id="$(printf '%s' "$create_json" | json_get machine.id)"
  if [ -z "$id" ]; then
    echo "create failed: $create_json" >&2
    return 1
  fi
  machines+=("$id")

  request POST "/machines/$id/start" >/dev/null

  # Poll for up to 5 minutes — VMs need longer than containers.
  deadline=$(( $(date +%s) + 300 ))
  while :; do
    status="$(request GET "/machines/$id" | node -e 'let i=""; process.stdin.on("data",c=>i+=c); process.stdin.on("end",()=>{const m=JSON.parse(i); console.log((m.machine&&m.machine.incus&&m.machine.incus.observed&&m.machine.incus.observed.status)||"")})')"
    if [ "$status" = "Running" ]; then break; fi
    if [ "$(date +%s)" -gt "$deadline" ]; then
      echo "timeout waiting for $id to reach Running (last status: ${status:-unknown})" >&2
      return 1
    fi
    sleep 0.5
  done

  end_ms="$(date +%s%3N)"
  awk -v s="$start_ms" -v e="$end_ms" 'BEGIN{printf "%.2f\n", (e - s)/1000.0}'
}

# Compute min / median / p95 / max from a whitespace-separated list of seconds.
stats() {
  node -e '
    const xs = process.argv.slice(1).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
    if (!xs.length) { console.log("(no samples)"); process.exit(0); }
    const q = (p) => xs[Math.min(xs.length-1, Math.floor(p*(xs.length-1)+0.5))];
    console.log(`n=${xs.length}  min=${xs[0].toFixed(2)}s  med=${q(0.5).toFixed(2)}s  p95=${q(0.95).toFixed(2)}s  max=${xs[xs.length-1].toFixed(2)}s  samples=[${xs.map(x=>x.toFixed(2)).join(", ")}]`);
  ' "$@"
}

container_samples=()
for i in $(seq 1 "$count"); do
  echo "[bench] container ${i}/${count}…"
  sample="$(boot_one container "$V2_E2E_IMAGE")"
  container_samples+=("$sample")
done

vm_samples=()
for i in $(seq 1 "$count"); do
  echo "[bench] vm ${i}/${count}…"
  sample="$(boot_one vm "$V2_E2E_VM_IMAGE")"
  vm_samples+=("$sample")
done

echo
echo "container boot: $(stats "${container_samples[@]}")"
echo "vm boot:        $(stats "${vm_samples[@]}")"
