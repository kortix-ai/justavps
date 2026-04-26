#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib.sh"

products_json="$(request GET /admin/vendors/hetzner/products)"
printf '%s' "$products_json" | json_assert procurement-products 'Array.isArray(data.products) && data.products.length > 0'

product_id="$(printf '%s' "$products_json" | node -e 'let d=""; process.stdin.on("data",c=>d+=c); process.stdin.on("end",()=>{const products=JSON.parse(d).products; const product=products.find(item => item.product && item.product.id && Array.isArray(item.product.location) && item.product.location.length > 0) || products[0]; console.log(product.product.id || product.product.name);});')"
location="$(printf '%s' "$products_json" | node -e 'let d=""; process.stdin.on("data",c=>d+=c); process.stdin.on("end",()=>{const products=JSON.parse(d).products; const product=products.find(item => item.product && (item.product.id || item.product.name) === process.argv[1]) || products[0]; console.log((product.product.location || ["HEL1"])[0]);});' "$product_id")"

quote_body="$(node -e 'console.log(JSON.stringify({product_id:process.argv[1],location:process.argv[2],region:process.env.V2_E2E_REGION||"eu",quantity:1}))' "$product_id" "$location")"
quote_json="$(request POST /admin/procurements/quote "$quote_body")"
printf '%s' "$quote_json" | json_assert procurement-quote 'data.quote && data.quote.vendor === "hetzner_robot" && data.quote.product_id && data.quote.execution && data.quote.execution.supported === false'

blocked_order_status="$(curl -sS -o /tmp/v2-api-blocked-order.json -w '%{http_code}' "${AUTH_ARGS[@]}" -H 'Content-Type: application/json' -X POST --data "$(node -e 'console.log(JSON.stringify({product_id:process.argv[1],location:process.argv[2],region:process.env.V2_E2E_REGION||"eu",quantity:1,execute:true}))' "$product_id" "$location")" "$BASE_URL/admin/procurements" || true)"
if [ "$blocked_order_status" != "409" ]; then
  echo "blocked procurement expected HTTP 409, got $blocked_order_status"
  exit 1
fi

create_json="$(request POST /admin/procurements "$quote_body")"
printf '%s' "$create_json" | json_assert procurement-create 'Array.isArray(data.procurements) && data.procurements.length === 1 && data.procurements[0].status === "planned" && data.execution === "dry_run_planned"'
procurement_id="$(printf '%s' "$create_json" | json_get procurements.0.id)"

request POST "/admin/procurements/$procurement_id/approve" '{"note":"v2 e2e approval dry run"}' | json_assert procurement-approve 'data.procurement && data.procurement.status === "approved"'

request POST "/admin/procurements/$procurement_id/order" '{"note":"v2 e2e order dry run"}' | json_assert procurement-order-plan 'data.procurement && data.procurement.status === "order_planned" && data.plan && Array.isArray(data.plan.steps) && data.plan.execution.supported === false'

blocked_selected_order_status="$(curl -sS -o /tmp/v2-api-blocked-selected-order.json -w '%{http_code}' "${AUTH_ARGS[@]}" -H 'Content-Type: application/json' -X POST --data '{"execute":true}' "$BASE_URL/admin/procurements/$procurement_id/order" || true)"
if [ "$blocked_selected_order_status" != "409" ]; then
  echo "blocked selected procurement order expected HTTP 409, got $blocked_selected_order_status"
  exit 1
fi

clusters_json="$(request GET /admin/clusters)"
cluster_id="$(printf '%s' "$clusters_json" | node -e 'let d=""; process.stdin.on("data",c=>d+=c); process.stdin.on("end",()=>{const clusters=JSON.parse(d).clusters || []; if (!clusters[0]) process.exit(2); console.log(clusters[0].id);});')"
bootstrap_json="$(request POST "/admin/procurements/$procurement_id/bootstrap-plan" "$(node -e 'console.log(JSON.stringify({cluster_id:process.argv[1],mode:"incusos_join_cluster"}))' "$cluster_id")")"
printf '%s' "$bootstrap_json" | json_assert bootstrap-plan 'data.procurement && data.procurement.status === "bootstrap_planned" && data.plan && Array.isArray(data.plan.steps) && data.plan.execution.supported === false'

blocked_bootstrap_status="$(curl -sS -o /tmp/v2-api-blocked-bootstrap.json -w '%{http_code}' "${AUTH_ARGS[@]}" -H 'Content-Type: application/json' -X POST --data "$(node -e 'console.log(JSON.stringify({cluster_id:process.argv[1],mode:"incusos_join_cluster",execute:true}))' "$cluster_id")" "$BASE_URL/admin/procurements/$procurement_id/bootstrap-plan" || true)"
if [ "$blocked_bootstrap_status" != "409" ]; then
  echo "blocked bootstrap expected HTTP 409, got $blocked_bootstrap_status"
  exit 1
fi

request GET /admin/procurements | json_assert procurement-list 'Array.isArray(data.procurements) && data.procurements.some(item => item.id === "'"$procurement_id"'")'
request POST "/admin/procurements/$procurement_id/cancel" '{"note":"v2 e2e cleanup"}' | json_assert procurement-cancel 'data.procurement && data.procurement.status === "cancelled"'

echo "procurement/bootstrap dry-run ok: $procurement_id"
