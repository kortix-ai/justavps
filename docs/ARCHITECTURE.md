# JustAVPS Architecture — Source of Truth

> Last updated: 2026-03-18
> Status: Production (justavps.com)

---

## Overview

JustAVPS provisions on-demand cloud machines (Hetzner VPS) with a web IDE (code-server), terminal, and coding agent APIs. All web traffic is proxied through a Cloudflare Worker that handles authentication and port forwarding.

```
                                    CLOUDFLARE EDGE
                                    ┌─────────────────────────────────┐
                                    │                                 │
  Browser ──── HTTPS ────>  DNS ──> │  CF Worker (auth + proxy)       │
                                    │  kortix-cloud-proxy             │
                                    │                                 │
                                    │  Route: *.kortix.cloud/*        │
                                    │  Custom Domain: *.kortix.cloud  │
                                    │                                 │
                                    └───────────┬─────────────────────┘
                                                │
                                                │ fetch(http://origin-SLUG.kortix.cloud:PORT)
                                                │ (DNS-only A record → VPS IP)
                                                │
                                    ┌───────────▼─────────────────────┐
                                    │  HETZNER VPS (cpx22)            │
                                    │                                 │
                                    │  :80   Caddy (reverse proxy)    │
                                    │    ├── / → code-server :8080    │
                                    │    ├── /_pty → daemon :7777     │
                                    │    ├── /agent/* → sandbox :2468 │
                                    │    └── /opencode/* → OC :3456   │
                                    │                                 │
                                    │  :7777  justavps-daemon         │
                                    │    ├── /health (CPU/mem/disk)   │
                                    │    ├── /_pty (WebSocket PTY)    │
                                    │    └── heartbeat → platform     │
                                    │                                 │
                                    │  :8080  code-server (web IDE)   │
                                    │  :2468  sandbox-agent (Rivet)   │
                                    │  :3456  opencode-web            │
                                    │  :9000+ user services           │
                                    │                                 │
                                    └─────────────────────────────────┘
```

---

## DNS Records (per machine)

Created by `cloudflare.ts → addMachineDNS(slug, ip)`:

| Record | Type | Value | Proxied | Purpose |
|--------|------|-------|---------|---------|
| `SLUG.kortix.cloud` | A | VPS IP | Yes (orange) | Triggers CF Worker route |
| `*.SLUG.kortix.cloud` | A | VPS IP | Yes (orange) | Port subdomains (e.g. `4096.SLUG.kortix.cloud`) |
| `origin-SLUG.kortix.cloud` | A | VPS IP | No (grey) | Worker fetches this to bypass CF proxy |

**Why origin record?** CF Workers cannot `fetch()` an IP that's behind CF's own proxy (error 1003). The DNS-only `origin-SLUG` record lets the Worker reach the VPS directly.

**Why not `origin.SLUG`?** Two-level hostnames (`origin.SLUG.kortix.cloud`) are matched by the wildcard `*.SLUG.kortix.cloud` which is proxied. Single-level `origin-SLUG.kortix.cloud` avoids this conflict.

---

## Authentication

All auth happens at the CF Worker edge. The VPS has NO auth layer — it trusts all traffic from CF.

### Auth Methods (checked in order by Worker)

```
1. Authorization: Bearer sk_live_xxx      → SHA-256 hash → KV lookup → ownership check
2. Cookie: __justavps_proxy=JWT           → HS256 verify → ownership check
3. ?token=JWT (query param)               → same as cookie (for WebSocket from cross-origin)
4. No auth:
     Browser → 302 redirect to justavps.com/api/proxy-auth?redirect=...
     API     → 401 {"error": "Authentication required"}
```

### Browser Login Flow (proxy-auth)

```
1. Browser visits https://SLUG.kortix.cloud/
2. CF Worker: no cookie → 302 → justavps.com/api/proxy-auth?redirect=https://SLUG.kortix.cloud/
3. Platform: validates NextAuth session
     Not logged in → redirect to /login?callbackUrl=...
     Logged in → sign JWT {sub: userId} with PROXY_AUTH_SECRET
4. Platform: 307 → https://SLUG.kortix.cloud/?__proxy_token=JWT
5. CF Worker: reads __proxy_token → verifies JWT → sets cookie on .kortix.cloud → 302 → clean URL
6. Browser: now has __justavps_proxy cookie → subsequent requests authenticated
```

**Why token-in-URL?** `justavps.com` cannot set cookies on `.kortix.cloud` (different origin). The platform passes the JWT via URL, the Worker (running ON `.kortix.cloud`) sets the cookie.

### KV Data (Cloudflare Workers KV)

```
machine:SLUG → { owner_id, ip, origin_hostname, status, server_type }
apikey:SHA256 → { owner_id, name }
```

Written by the platform on machine provision / API key creation.

---

## Port Forwarding

Two methods, both authenticated:

### Path-Based (works now, any CF plan)
```
https://SLUG.kortix.cloud/_port/PORT/path
  → CF Worker parses /_port/PORT/ from path
  → fetches http://origin-SLUG.kortix.cloud:PORT/path
```

### Subdomain-Based (requires ACM cert — pending)
```
https://PORT.SLUG.kortix.cloud/path
  → CF Worker parses PORT from hostname
  → fetches http://origin-SLUG.kortix.cloud:PORT/path
```

Requires Cloudflare ACM ($10/mo) for `*.*.kortix.cloud` SSL certificate.
Currently ordered (Google CA) — status: initializing.

---

## Machine Provisioning

### Flow

```
1. POST /api/v1/machines { provider, server_type, region, name }
2. Platform:
     a. Generate SSH keypair (pure JS ed25519 — works on Vercel serverless)
     b. Build cloud-init script (machine-specific config)
     c. Hetzner API: create server from snapshot (HETZNER_BASE_SNAPSHOT_ID)
     d. Create CF DNS records (A + wildcard A + origin A)
     e. Write machine:SLUG to CF KV
     f. Insert into DB (status: provisioning)
3. Hetzner boots VPS from snapshot (~60-90s)
4. Cloud-init runs (~4s on snapshot — config only, no installs)
5. Daemon starts, sends heartbeat → platform marks as "ready"
```

### Base Snapshot (Hetzner Image 367950002)

Pre-installed software (zero install on boot):
- Docker CE, Node.js 22, Python 3
- code-server (web IDE)
- Caddy (reverse proxy)
- Claude Code (`claude.ai/install.sh`)
- OpenCode (`opencode.ai/install`)
- Sandbox Agent (Rivet — universal coding agent API)
- justavps-daemon (Go binary from R2)
- Systemd service templates

### Cloud-Init on Snapshot Boot (~4 seconds)

Since `code-server` is already installed, cloud-init SKIPS all package installs and only does:
1. Download latest daemon binary (from R2)
2. Write systemd service files (idempotent)
3. Create `user` account (if not exists)
4. Write SSH authorized_keys
5. Write `/etc/justavps/config.json` (slug, token, callback URL)
6. Write `/etc/justavps/env` (user environment variables)
7. Write Caddyfile (with `/_pty` route)
8. Write code-server config (`auth: none` — CF Worker handles auth)
9. Configure ufw firewall (SSH + 80 + 1024-65535)
10. Enable + start all services

### Cloud-Init on Fresh Ubuntu (~100 seconds)

If booting from `ubuntu-24.04` (no snapshot), installs everything from scratch.
Guard: `if ! command -v code-server &>/dev/null; then ... fi`

---

## Daemon (Go Binary)

Binary: `justavps-daemon` — downloaded from R2 on every boot.
Listens on `:7777` (localhost via Caddy, not exposed directly).

```
Responsibilities:
  /health              → JSON: CPU, memory, disk, uptime
  /services            → List systemd services + status
  /services/{name}/restart → Restart a managed service
  /info                → Machine slug, IP, daemon version
  /_pty                → WebSocket PTY (gorilla/websocket + creack/pty)
  heartbeat            → POST to platform every 30s
```

### PTY WebSocket Protocol

```
Client → Server:
  { "type": "input", "data": "ls\n" }
  { "type": "resize", "cols": 80, "rows": 24 }

Server → Client:
  { "type": "output", "data": "file1  file2\n" }
  { "type": "exit" }
  { "type": "error", "data": "..." }
```

### WebSocket Proxy Chain

```
Browser (justavps.com dashboard)
  → wss://SLUG.kortix.cloud/_pty?token=JWT
  → CF Worker (verifies JWT, proxies WebSocket)
  → http://origin-SLUG.kortix.cloud:80/_pty
  → Caddy (handle /_pty → reverse_proxy localhost:7777)
  → Daemon /_pty handler (gorilla/websocket → creack/pty → /bin/bash)
```

---

## Caddy Configuration (per machine)

Written by cloud-init to `/etc/caddy/Caddyfile`:

```
:80 {
    handle /_pty {
        reverse_proxy localhost:7777    # Daemon PTY WebSocket
    }
    reverse_proxy localhost:8080        # code-server (default)
    handle_path /agent/* {
        reverse_proxy localhost:2468    # Sandbox Agent API
    }
    handle_path /opencode/* {
        reverse_proxy localhost:3456    # OpenCode Web UI
    }
    handle_path /daemon/* {
        reverse_proxy localhost:7777    # Daemon API
    }
}
```

---

## Firewall

### Hetzner Firewall (external, tamper-proof)
Should be configured to allow:
- TCP 22 from 0.0.0.0/0 (SSH)
- TCP 80 + 1024-65535 from CF IP ranges only

### ufw on VPS (defense-in-depth)
```
22/tcp       ALLOW    (SSH)
80/tcp       ALLOW    (Caddy)
1024:65535   ALLOW    (user services — CF Worker handles auth)
```

---

## CF Worker (kortix-cloud-proxy)

Source: `workers/proxy/src/`

| File | Purpose |
|------|---------|
| `index.ts` | Entry point: auth → proxy → startup page on 502 |
| `auth.ts` | JWT verify, API key (SHA-256), cookie parsing, ownership check |
| `proxy.ts` | HTTP proxy (fetch to origin), WebSocket proxy (WebSocketPair), CORS |
| `hostname.ts` | Parse `PORT.SLUG.kortix.cloud` or `SLUG.kortix.cloud/_port/PORT/` |

### Error Handling

| Origin Response | Worker Action |
|----------------|---------------|
| 200-399 | Pass through to client |
| 502/521/523 | Browser: show "Machine is starting up" (503 auto-refresh). API: pass through |
| Timeout | 502 with error JSON |

---

## Platform (Next.js on Vercel)

Source: `src/server/`

| Component | Path | Purpose |
|-----------|------|---------|
| API Routes | `routes/v1/` | Hono + Zod OpenAPI (machines, images, API keys, etc.) |
| Auth | NextAuth v5 | GitHub OAuth + credentials |
| Database | Neon Postgres | Drizzle ORM |
| Billing | Stripe | Per-machine subscriptions |
| Proxy Auth | `app/api/proxy-auth/` | JWT issuance for browser→machine flow |
| SSH Keygen | `lib/ssh-keygen.ts` | Pure JS ed25519 (no `ssh-keygen` binary — works on Vercel) |
| Cloudflare | `lib/cloudflare.ts` | DNS A records + KV writes |
| Cloud Init | `lib/cloud-init.ts` | Bash script generator for machine boot |

### Key Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `PROXY_AUTH_SECRET` | Vercel + CF Worker | JWT signing/verification (must match!) |
| `HETZNER_BASE_SNAPSHOT_ID` | Vercel | Pre-built snapshot ID (367950002) |
| `CLOUDFLARE_ZONE_ID` | Vercel | kortix.cloud zone |
| `CF_KV_NAMESPACE_ID` | Vercel | KV namespace for Worker auth lookups |
| `PROXY_DOMAIN` | Vercel | `kortix.cloud` |
| `PLATFORM_URL` | Vercel + CF Worker | `https://justavps.com` |

**Critical:** `PROXY_AUTH_SECRET` must be identical on Vercel and CF Worker. Mismatch = JWT verification fails = 401 on all cookie auth.

---

## What's NOT Working Yet

| Issue | Status | Fix |
|-------|--------|-----|
| Port subdomains (`4096.SLUG.kortix.cloud`) | SSL cert initializing (Google CA) | Wait — or use path-based `/_port/4096/` |
| Terminal in dashboard | WebSocket proxy works, but PTY on some machines may need daemon update | New machines from snapshot have it |
| Old machines (pre-snapshot) | Missing PTY handler + Caddy route | Recreate or manually update daemon+Caddy |

---

## File Map

```
justavps.com/
├── src/
│   ├── server/
│   │   ├── lib/
│   │   │   ├── cloudflare.ts       # DNS A records + KV writes
│   │   │   ├── cloud-init.ts       # Bash script generator
│   │   │   ├── config.ts           # Env var config (trimmed)
│   │   │   ├── machine-lifecycle.ts # Provision, cleanup, sync
│   │   │   ├── proxy-token.ts      # JWT signing (jose)
│   │   │   └── ssh-keygen.ts       # Pure JS ed25519 keygen
│   │   ├── routes/v1/
│   │   │   ├── machines.ts         # CRUD + provision
│   │   │   ├── images.ts           # List (incl public), get, delete
│   │   │   ├── internal.ts         # Heartbeat, stage callback
│   │   │   └── stripe-webhooks.ts  # Billing
│   │   └── db/schema.ts            # Drizzle schema
│   ├── app/
│   │   ├── api/proxy-auth/route.ts # Browser auth flow
│   │   └── (dashboard)/            # Next.js pages
│   └── components/dashboard/
│       └── terminal.tsx            # XTerm.js + WebSocket PTY
├── workers/proxy/
│   └── src/
│       ├── index.ts                # Worker entry (auth → proxy → 503 page)
│       ├── auth.ts                 # JWT, API key, cookie verification
│       ├── proxy.ts                # HTTP + WebSocket proxy
│       └── hostname.ts             # Slug + port parser
├── daemon/
│   ├── main.go                     # Entry: health API + heartbeat
│   ├── pty.go                      # WebSocket PTY handler
│   ├── config.go                   # /etc/justavps/config.json
│   ├── api.go                      # /health, /services, /info
│   ├── health.go                   # CPU/mem/disk monitoring
│   └── heartbeat.go                # POST to platform every 30s
├── e2e/
│   └── 08-proxy-auth.spec.ts       # Playwright browser tests
├── src/__tests__/e2e/
│   └── machine-lifecycle.test.ts   # 28-test infra E2E (Hetzner + CF + SSH)
└── docs/
    └── ARCHITECTURE.md             # This file
```
