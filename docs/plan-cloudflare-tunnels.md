# Cloudflare Tunnels — Proxy Architecture Plan

## Why Tunnels (and why everything else failed)

| Approach tried | Failure mode |
|---|---|
| Per-machine DNS (grey cloud) | No Cloudflare TLS, no Worker interception |
| Per-machine DNS (orange cloud) | DNS propagation takes 0-60s, sometimes fails entirely |
| Wildcard DNS + Worker | Worker can't fetch raw IPs (error 1003), hostname fetch loops |
| Two records (slug + origin) | Double propagation issues, SSL mode conflicts |

**Cloudflare Tunnels solve all of these** because there's no DNS propagation — the tunnel is an outbound connection from the VPS to Cloudflare. Traffic is routed via CNAME to `{tunnel-id}.cfargotunnel.com`, which is instant.

---

## Architecture

```
VPS (cloud-init installs cloudflared)
  └── cloudflared connects OUTBOUND to Cloudflare edge
        └── Tunnel ID: abc123.cfargotunnel.com

Browser → slug.kortix.cloud (HTTPS)
  → Cloudflare DNS: CNAME slug.kortix.cloud → {tunnel-id}.cfargotunnel.com (proxied)
  → Cloudflare edge routes to the tunnel
  → cloudflared on VPS receives request → forwards to localhost:80 (Caddy)
  → Caddy → code-server on localhost:8080

Auth: handled by CF Access policies OR our existing JWT Worker (see options below)
```

### What changes

| Component | Current | With Tunnels |
|---|---|---|
| DNS per machine | A record (proxied) — broken propagation | CNAME to tunnel UUID — instant |
| VPS connectivity | Inbound ports 80/443 from Cloudflare IPs | **No inbound ports at all** — outbound only |
| TLS | Cloudflare edge (when proxy works) | Cloudflare edge (always works) |
| Auth | CF Worker JWT (complex) | CF Access (built-in) OR CF Worker |
| Firewall | UFW allow Cloudflare IPs | UFW deny ALL inbound (except SSH) |
| Worker | Required for auth + proxy routing | Optional — only for custom auth logic |

---

## Scaling Analysis

### Cloudflare Tunnels — Pricing & Limits

| Tier | Tunnels | Connectors | Cost |
|---|---|---|---|
| Free (Cloudflare One) | 20 tunnels | Unlimited per tunnel | $0 |
| Cloudflare One Starter | Unlimited | Unlimited | $7/user/month (min 1 user) |
| Pay-as-you-go | Unlimited | Unlimited | Contact CF |

**Key insight: One tunnel can have MANY connectors.** We don't need one tunnel per machine. We can use:

### Option A: One tunnel per machine (simple, limited)
- Create a tunnel via API when machine is provisioned
- Each VPS runs `cloudflared` with its own tunnel token
- Create a CNAME DNS record: `slug.kortix.cloud → tunnel-id.cfargotunnel.com`
- Limit: 20 tunnels on free tier = 20 machines max
- Easy to implement, but doesn't scale beyond free tier

### Option B: Shared tunnel, per-machine ingress (scalable, recommended)
- **One tunnel** for all machines (e.g., "justavps-production")
- Each VPS runs `cloudflared` as a **connector** to this shared tunnel
- Tunnel config maps hostnames to local services:
  ```
  ingress:
    - hostname: slug1.kortix.cloud → http://localhost:80
    - hostname: slug2.kortix.cloud → http://localhost:80
    ...
    - service: http_status:404
  ```
- **Problem:** Adding ingress rules requires updating the tunnel config via API for every machine. This is a global config — one API call per machine creation.
- Limit: None on connectors. Free tier allows 20 tunnels, but we only use 1.
- **This is the right approach.**

### Option C: Per-machine tunnel, one connector each (simple, scales with paid tier)
- Like Option A but on the paid tier (unlimited tunnels)
- Simpler than B — no shared config, each machine is independent
- $7/month for Cloudflare One Starter
- Good if we want isolation per machine

**Recommendation: Option B** (shared tunnel) for now, upgrade to Option C if we need machine isolation later.

---

## Implementation Plan — Option B (Shared Tunnel)

### Phase 1: Create the shared tunnel (one-time setup)

```bash
# Create tunnel via API
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  --json '{"name": "justavps-production", "config_src": "cloudflare"}'

# → Returns tunnel_id and tunnel_token
# Store tunnel_token in env: CLOUDFLARE_TUNNEL_TOKEN
```

### Phase 2: Machine provisioning (cloud-init changes)

When a new machine is created:

1. **Install cloudflared on VPS** (in cloud-init):
   ```bash
   curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | gpg --dearmor -o /usr/share/keyrings/cloudflare-main.gpg
   echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared jammy main' | tee /etc/apt/sources.list.d/cloudflared.list
   apt-get update && apt-get install -y cloudflared
   ```

2. **Update tunnel ingress** (from platform API):
   ```
   PUT /accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations
   {
     "config": {
       "ingress": [
         { "hostname": "slug1.kortix.cloud", "service": "http://localhost:80" },
         { "hostname": "slug2.kortix.cloud", "service": "http://localhost:80" },
         { "hostname": "NEW_SLUG.kortix.cloud", "service": "http://localhost:80" },
         { "service": "http_status:404" }
       ]
     }
   }
   ```

3. **Create DNS CNAME** (from platform API):
   ```
   POST /zones/{zone_id}/dns_records
   {
     "type": "CNAME",
     "name": "NEW_SLUG.kortix.cloud",
     "content": "{tunnel_id}.cfargotunnel.com",
     "proxied": true
   }
   ```
   **This is a CNAME pointing to cfargotunnel.com — not an A record to a VPS IP.** Cloudflare resolves it internally, no propagation delay.

4. **Run cloudflared on VPS** (cloud-init):
   ```bash
   cloudflared service install $TUNNEL_TOKEN
   ```

### Phase 3: Auth

Two options:

#### Option 3a: Cloudflare Access (recommended for simplicity)
- Configure Access policies via CF dashboard/API
- Supports: email-based, SAML, OIDC, service tokens
- Users see a CF Access login page → authenticates → gets `CF_Authorization` cookie
- Zero code change on the Worker side
- **But:** The Access login page is Cloudflare-branded, not JustAVPS-branded

#### Option 3b: Keep our JWT Worker (recommended for branding)
- Worker route `*.kortix.cloud/*` still intercepts
- Worker checks `__justavps_proxy` JWT cookie
- Worker passes through to the tunnel origin (no raw IP fetch needed — Cloudflare handles routing internally)
- **This should work because the Worker doesn't need to fetch the origin IP directly — the tunnel handles it**
- Users see our own login page at justavps.com

**Recommendation: Option 3b** — keep our JWT Worker for branded auth. The Worker just validates the JWT and passes through. Cloudflare routes to the tunnel automatically.

### Phase 4: Machine deletion

1. Remove hostname from tunnel ingress config (API call)
2. Delete DNS CNAME record
3. Delete Hetzner server
4. Delete KV entry

---

## Files to Change

### Platform

| File | Change |
|---|---|
| `src/server/lib/cloudflare.ts` | Replace A record DNS with CNAME to tunnel. Add tunnel ingress management (add/remove hostnames). |
| `src/server/lib/cloud-init.ts` | Install cloudflared, run with tunnel token. Remove UFW Cloudflare IP rules (not needed — no inbound). |
| `src/server/lib/config.ts` | Add `CLOUDFLARE_TUNNEL_ID`, `CLOUDFLARE_TUNNEL_TOKEN` |
| `src/server/lib/machine-lifecycle.ts` | setupProxyKV: add hostname to tunnel ingress + create CNAME |
| `.env` + `.env.example` | Add tunnel vars |

### Worker

| File | Change |
|---|---|
| `workers/proxy/src/proxy.ts` | Remove origin fetch entirely. Worker just validates auth and passes through — Cloudflare routes to the tunnel. |
| `workers/proxy/src/index.ts` | After auth validation, `return fetch(request)` — let Cloudflare handle the proxying to the tunnel. |

### Cloud-Init

| Change | Detail |
|---|---|
| Install cloudflared | `apt-get install cloudflared` |
| Run tunnel | `cloudflared service install $TUNNEL_TOKEN` |
| Remove UFW rules | No inbound ports needed — tunnel is outbound-only |
| Keep Caddy on :80 | cloudflared → Caddy :80 → code-server :8080 |
| Keep code-server auth:none | Worker handles auth before traffic reaches the tunnel |

---

## DNS: CNAME vs A Record

**This is the key difference that fixes everything:**

| | A Record (current, broken) | CNAME to Tunnel (new) |
|---|---|---|
| Points to | VPS IP directly | `{tunnel-id}.cfargotunnel.com` |
| Propagation | 0-60s, sometimes fails | **Instant** — CNAME to Cloudflare's own infra |
| Requires | VPS to be reachable on port 80/443 | Nothing — tunnel is outbound from VPS |
| SSL | Cloudflare edge (when proxy works) | **Always** — Cloudflare handles it |
| Worker fetch | Needs raw IP → blocked by CF | **Not needed** — Worker just passes through |

---

## Cost

- Cloudflare One Free: 20 tunnels, 50 users, unlimited connectors → **$0/month**
- We use 1 tunnel with many connectors (one per VPS) → well within free tier
- If we exceed 50 Access users → Cloudflare One Starter at $7/user/month
- cloudflared binary: free, open source, auto-updates

---

## Implementation Order

1. Create shared tunnel via API (one-time)
2. Update cloud-init: install cloudflared + run with token
3. Update cloudflare.ts: CNAME DNS + tunnel ingress management
4. Update Worker: pass-through after auth (no origin fetch)
5. Test e2e with new machine
6. Migrate existing machines
7. Clean up old DNS records + remove old origin-fetch code
