# Fresh machine top-to-bottom verification — 2026-04-07

## Fresh machine
- slug: xpalemmx
- machine id: e50bfe0e-dae3-4783-a299-ec04b95b15c5
- resources: 1 vCPU / 1 GB RAM / 10 GB SSD
- runtime path: warm pool hit
- time to ready observed in API polling: ~2.33s

## Verified paths
### DNS
- `origin-xpalemmx.kortix-dev.cloud` resolves to `135.181.129.188`

### SSH reachability
- TCP connect to `origin-xpalemmx.kortix-dev.cloud:22949` succeeds
- Using the exact private key from the V2 API payload:
  `ssh -i /tmp/xpalemmx-key -p 22949 root@origin-xpalemmx.kortix-dev.cloud`
  → `SSH_OK`
  → hostname inside guest = `xpalemmx`

### Terminal
- `http://origin-xpalemmx.kortix-dev.cloud:8448/_terminal` returns `HTTP/1.1 200 OK`

### Root proxy URL
- `http://origin-xpalemmx.kortix-dev.cloud:8448/` returns the JustAVPS welcome landing page HTML
- no more default 502 for fresh machines

## Runner health after fix
- warm_pool: 4/4 ready
- no stopped/stateful runtime pool exposed anymore

## Conclusion
Future fresh machines are now wired correctly from top to bottom:
- DNS
- SSH proxy port
- API connect payload
- terminal
- root proxy landing page
