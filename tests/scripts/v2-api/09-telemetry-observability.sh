#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

machine_id="telemetry-e2e-$(date +%s)-$$"
metric_body=$(node -e 'const id=process.argv[1]; process.stdout.write(JSON.stringify({machine_id:id,account_id:"e2e",source:"daemon",load:{cpu:0.42,memory:0.64,disk:0.21},network:{bytes_in:12345,bytes_out:67890,rate_in:120,rate_out:240,connections:7},uptime:99,services:{docker:true},security:{ufw_active:true,fail2ban_active:false},resource_attributes:{"service.name":"justavps-daemon","justavps.machine.id":id}}));' "$machine_id")
log_body=$(node -e 'process.stdout.write(JSON.stringify({source:"daemon",logs:[{severity:"error",source:"daemon",stream:"stderr",body:"telemetry e2e daemon error"},{severity:"info",source:"process.stdout",stream:"stdout",body:"hello from telemetry e2e"}]}));')
trace_body=$(node -e 'process.stdout.write(JSON.stringify({operation:"toolbox.exec",spans:[{trace_id:"trace-e2e",span_id:"span-e2e",operation:"toolbox.exec",name:"echo telemetry",status:"ok",duration_ms:17,attributes:{exit_code:0}}]}));')
event_body=$(node -e 'process.stdout.write(JSON.stringify({events:[{type:"sandbox.created",category:"lifecycle",body:"telemetry e2e lifecycle event",attributes:{reason:"e2e"}}]}));')

request GET /admin/telemetry/overview | json_assert telemetry_overview 'data.store && typeof data.metric_rows === "number" && typeof data.log_rows === "number" && typeof data.trace_rows === "number"'

request POST "/internal/telemetry/machines/${machine_id}/metrics" "$metric_body" | json_assert telemetry_metrics_ingest 'data.ok === true && data.inserted >= 8'
request POST "/internal/telemetry/machines/${machine_id}/logs" "$log_body" | json_assert telemetry_logs_ingest 'data.ok === true && data.inserted === 2'
request POST "/internal/telemetry/machines/${machine_id}/traces" "$trace_body" | json_assert telemetry_traces_ingest 'data.ok === true && data.inserted === 1'
request POST "/internal/telemetry/machines/${machine_id}/events" "$event_body" | json_assert telemetry_events_ingest 'data.ok === true && data.inserted === 1'

request GET "/admin/telemetry/machines/${machine_id}/latest" | json_assert telemetry_latest 'data.latest.machine_id && data.latest.metrics["justavps.sandbox.cpu.utilization"].value === 42 && data.latest.metrics["justavps.sandbox.network.connections"].value === 7'
request GET "/admin/telemetry/machines/${machine_id}/metrics?limit=100" | json_assert telemetry_metrics_query 'Array.isArray(data.metrics) && data.metrics.some((m) => m.name === "justavps.sandbox.cpu.utilization" && m.value === 42)'
request GET "/admin/telemetry/machines/${machine_id}/logs?limit=100&level=error" | json_assert telemetry_logs_query 'Array.isArray(data.logs) && data.logs.length === 1 && data.logs[0].body.includes("daemon error")'
request GET "/admin/telemetry/machines/${machine_id}/traces?limit=100&operation=toolbox.exec" | json_assert telemetry_traces_query 'Array.isArray(data.traces) && data.traces.length === 1 && data.traces[0].name === "echo telemetry"'
request GET "/admin/telemetry/machines/${machine_id}/events?limit=100" | json_assert telemetry_events_query 'Array.isArray(data.events) && data.events.some((event) => event.type === "sandbox.created")'

echo "v2-api telemetry observability ok (${machine_id})"
