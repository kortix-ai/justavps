# JustAVPS — Full Product Spec

> Last updated: March 16, 2026
> Status: Pre-build. This is the canonical source of truth before any code is written.

---

## 0. Strategic Context

**JustAVPS is simultaneously:**
1. A **public product** — devs pay $9+/mo for a 1-click VPS with great DX
2. **Your own private cloud** — Kortix/computer provisions its agent machines via JustAVPS instead of calling Hetzner directly

Both use the same codebase. You are customer #1.

### The Kortix Integration

`computer/kortix-api` currently has a `hetzner` provider (`platform/providers/hetzner.ts`) that calls Hetzner directly. We replace this with a `justavps` provider that calls the JustAVPS API:

```typescript
// computer/kortix-api/src/platform/providers/justavps.ts
// Provisions Kortix sandbox machines via JustAVPS API
// Machines come pre-configured: code-server + Docker + justavps-agent
// Subdomain proxy included: abc123.kortix.cloud
// Uses justavps-agent PTY for terminal access
```

This means:
- Every Kortix user's compute runs on a JustAVPS machine
- JustAVPS bills Kortix (you) for the compute at your own pricing
- Kortix users get the proxy/code-server DX for free
- You dogfood the product from day 1

### What's Reused From `computer/`

The Hetzner provisioner in `computer/` is production-quality code we lift directly:
- `hetznerFetch()` — typed API wrapper with auth + timeout
- `waitForStatus()` — polling loop (3s intervals, 10min timeout)
- `listServerTypes()` — filters, location/disk compatibility, 1.2x markup
- `resolveSnapshot()` — finds snapshot by description, 5-min cache
- Stripe subscription item per instance with proration + rollback
- Background provisioning mode (202 Accepted, async)
- Full rollback on failure (Hetzner delete + Stripe cancel + DB archive)

We're not starting from scratch. We're productizing already-working infra code.

---

## 1. The Thesis

The AI agent space has split into two camps:

- **Burst/ephemeral compute** — e2b, Modal, Daytona. MicroVMs. Spin up in 200ms, killed after an hour. $500+/mo for 24/7. Built for stateless code execution.
- **24/7 always-on compute** — agents that run continuously, output tokens around the clock, live on triggers and heartbeats. These need a *home*. A real computer. A VPS.

The problem: raw VPS providers (Hetzner, OVH, Contabo) have terrible DX. No instant setup. No authenticated port proxying. No shareable machine URLs. No 1-click templates.

**JustAVPS is the premium DX wrapper over commodity VPS.** Same Hetzner hardware. 50-100x cheaper than microVM sandboxes for 24/7 workloads. Great DX out of the box.

Target user:
- Developer who wants a persistent, always-on machine to run Claude Code / OpenCode / OpenClaw / Kortix
- Team spinning up 10-100 AI agent machines programmatically
- Anyone who wants a dev container in the cloud without the enterprise BS

---

## 2. Core Value Proposition

**Least steps to a running VPS. Maximum out-of-box DX.**

1. Sign up
2. Click "New Machine"
3. Pick size + template
4. 3-5 minutes → you get:
   - `https://abc123.kortix.cloud` — VS Code in your browser (code-server), authenticated
   - `ssh user@1.2.3.4` — direct SSH, your key pre-loaded
   - `3000.abc123.kortix.cloud` — any port you run on the VPS, instantly proxied + auth-gated
   - Connection guides for VS Code, Cursor, Claude Code, OpenCode, OpenClaw — copy-paste ready
   - If you pick the **OpenCode template** → OpenCode Web UI is auto-served and accessible at `3456.abc123.kortix.cloud` (or whatever port OpenCode uses). No extra setup.

Everything proxied through `*.kortix.cloud` is authenticated by default. You bring your API key or you're logged in — that's it. If you run a bash API on :8000, it's immediately accessible at `8000.abc123.kortix.cloud` with your API key. We don't own the toolbox layer. The proxy IS the API gateway.

### Domain Architecture

```
justavps.com                → Marketing site + Dashboard (Next.js on Vercel)
api.kortix.cloud            → Platform API (Hono)
*.kortix.cloud              → Machine proxy subdomains (CF Worker auth gateway)
  abc123.kortix.cloud       → code-server (VS Code in browser)
  3000.abc123.kortix.cloud  → user's app on port 3000
  3456.abc123.kortix.cloud  → OpenCode Web UI (if template includes it)
  8000.abc123.kortix.cloud  → user's own API
```

**Multi-domain support (architecture-ready, not v1):**
The proxy layer is designed to support multiple domains. In v1 we ship `kortix.cloud`. The CF Worker can be extended to handle:
- `*.justavps.com` — same proxy, different brand domain
- Custom user domains — user points CNAME to us, we verify ownership, add to routing
- The machine DB stores a `domains[]` array per machine for future multi-domain binding

---

## 3. What Ships on Every VPS (The Base Image)

Every machine provisions via **cloud-init** on Ubuntu 24.04 LTS. The cloud-init script installs:

```
Ubuntu 24.04 LTS
├── code-server                    VS Code in browser @ :8080
│   └── configured with:
│       ├── --proxy-domain abc123.kortix.cloud  (port forwarding built-in)
│       ├── password auth disabled (CF Worker handles auth at edge)
│       └── systemd service (auto-restart on crash)
│
├── Caddy                          Reverse proxy @ :80/:443
│   ├── abc123.kortix.cloud → localhost:8080
│   └── *.abc123.kortix.cloud → code-server proxy-domain handles it
│
├── justavps-agent                 Tiny binary, :7777
│   ├── GET  /health               { ready, uptime, services }
│   ├── WS   /pty                  Full PTY over WebSocket
│   └── POST /heartbeat            Periodic callback to platform
│
├── Docker + Docker Compose        Users can run anything
├── SSH :22                        Key-auth only, user account
└── Dev tools:
    git, curl, wget, build-essential, unzip,
    node (via nvm, LTS), python3 + pip, uv,
    htop, tmux, vim, nano
```

### Template-Specific Additions

**OpenCode template:**
```
└── OpenCode                       Pre-installed + running as systemd service
    ├── opencode serve             Web UI on :3456 → auto-proxied at 3456.abc123.kortix.cloud
    └── opencode (CLI)             Available via SSH or PTY
```

**Claude Code template:**
```
└── Claude Code                    Pre-installed globally via npm
    └── claude                     Available via SSH or PTY
```

**OpenClaw template:**
```
└── OpenClaw                       Pre-installed + running
    └── Accessible via proxy       Whatever port OpenClaw uses
```

---

## 4. Security Model — The Proxy Protection Layer

### The Core Question: How Is the VPS Protected?

**All HTTP/WebSocket traffic goes through Cloudflare.** The VPS IP is never exposed directly for web traffic. This is enforced at two levels:

#### Level 1: Hetzner Firewall (network-level, user CANNOT modify)

Hetzner Firewall rules are applied via the Hetzner API at provision time. They exist OUTSIDE the VPS — the user has zero ability to change them even with root. This is our tamper-proof security boundary.

```
INBOUND ALLOW:
  22    → SSH             from anywhere (key-auth only)
  80    → HTTP            from Cloudflare IPs only (173.245.48.0/20, 103.21.244.0/22, etc.)
  443   → HTTPS           from Cloudflare IPs only
  7777  → agent           from platform IPs only (our CF Worker egress + API server)

INBOUND DENY:
  everything else from any source
```

**Key insight:** Because the Hetzner Firewall is EXTERNAL to the VPS, even if a user:
- Disables `ufw` inside the VPS → still blocked by Hetzner Firewall
- Opens random ports → only SSH (22) is accessible from the internet
- Tries to bypass the proxy → HTTP traffic only accepted from CF IPs

The user literally cannot expose anything to the internet except through our proxy layer. SSH is the only direct path, and it's key-only.

#### Level 2: Cloudflare Worker (auth layer, user CANNOT modify)

Every HTTP/WS request to `*.kortix.cloud` hits the CF Worker BEFORE reaching the VPS:

```
Internet → Cloudflare CDN → CF Worker (auth check) → VPS
                                  │
                                  ├── Has API key or session? → proxy to VPS
                                  └── No auth? → redirect to login / 401
```

The Worker validates:
1. `Authorization: Bearer sk_live_xxx` header → KV lookup
2. `__session` cookie → JWT verification
3. Ownership: does this user/key own machine `abc123`?

**If they pass → request is proxied to VPS_IP:port**
**If they fail → 401/403, request never reaches VPS**

#### Level 3: justavps-agent (on-VPS, resilience)

The agent runs as a `systemd` service with `Restart=always`. Even if the user kills it, systemd restarts it within seconds. The agent:
- Runs on `:7777` — only accessible from our platform IPs (Hetzner Firewall rule)
- Provides `/health` endpoint — platform polls this to know VPS is alive
- Provides `/pty` WebSocket — browser terminal
- Sends periodic heartbeats to `api.kortix.cloud` — if heartbeat stops, we know something's wrong

**Can the user break things from inside?**

| Action | Impact | Recovery |
|---|---|---|
| Kill code-server | Legacy service interruption | systemd restarts it in 5s |
| Kill justavps-agent | No PTY, no health checks | systemd restarts it in 5s |
| Kill Caddy | Proxy breaks | systemd restarts it in 5s |
| Disable systemd services | Services stay down until reboot | User clicks "Reboot" in dashboard → cloud-init re-enables |
| Modify Caddy config | Proxy may break | User's problem — they have root, they own the consequence |
| `ufw` / `iptables` changes | Could block internal traffic | Hetzner Firewall still enforces external rules |
| Format disk / rm -rf | Machine is bricked | User destroys, provisions new one |

**Bottom line:** The user has root. They CAN break their own machine. But they CANNOT:
- Expose ports to the internet without going through our proxy (Hetzner Firewall)
- Access another user's machine (CF Worker auth)
- Disable the Hetzner Firewall (it's external to the VPS)
- Remove their machine from our billing (we control the Hetzner account)

This is the same security model as any VPS provider. Root = you own the consequences inside your box. The network-level protection is ours.

---

## 5. Network & Proxy Architecture

### DNS Layout
```
BRAND (justavps.com):
  justavps.com               → Vercel (marketing + dashboard)
  www.justavps.com            → Vercel (redirect)

INFRASTRUCTURE (kortix.cloud):
  api.kortix.cloud            → Vercel (Hono API, Next.js API routes)
  *.kortix.cloud              → Cloudflare (proxied, orange-cloud)
    abc123.kortix.cloud       → CF Worker → VPS_IP:8080 (code-server)
    3000.abc123.kortix.cloud  → CF Worker → VPS_IP:3000 (user's app)
    8000.abc123.kortix.cloud  → CF Worker → VPS_IP:8000 (user's API)

FUTURE (extensible):
  *.justavps.com              → same CF Worker, same logic (second brand domain)
  custom.user-domain.com      → user CNAME → verified → same CF Worker routing
```

### Cloudflare Worker — The Auth Gateway

Single CF Worker handles ALL proxy domains. Deployed on `*.kortix.cloud` (and later `*.justavps.com`, custom domains).

The Worker:

1. **Parses the hostname:**
   - `abc123.kortix.cloud` → slug=`abc123`, port=`8080` (code-server default)
   - `3000.abc123.kortix.cloud` → slug=`abc123`, port=`3000`
   - `abc123.justavps.com` (future) → same parsing logic
   - `custom.example.com` (future) → KV lookup `domain:custom.example.com` → slug

2. **Authenticates:**
   - `Authorization: Bearer sk_live_xxx` → validate API key (KV lookup by hash)
   - `__session` cookie → validate JWT (signed with platform secret)
   - `?token=xxx` query param (for WebSocket connections that can't set headers)
   - No auth → redirect to `justavps.com/login?next=...`

3. **Authorizes:**
   - Does this authenticated user own machine with slug `abc123`?
   - KV lookup: `machine:{slug}` → `{ owner_id, ip, status }`
   - Mismatch → 403

4. **Proxies:**
   - HTTP: transparent proxy to `http://VPS_IP:port`
   - WebSocket: proxied with Upgrade headers preserved (needed for code-server, PTY, OpenCode Web UI SSE)
   - SSE: streamed through, no buffering

5. **PTY special case:**
   - `wss://abc123.kortix.cloud/_pty` → CF Worker → `ws://VPS_IP:7777/pty`
   - Same auth rules

### Proxy Robustness Requirements

The proxy MUST handle:
- **WebSocket** — code-server, PTY terminal, OpenCode Web UI
- **Server-Sent Events (SSE)** — LLM streaming, OpenCode events
- **Large file uploads** — code uploads, Docker image pushes
- **Long-lived connections** — no timeout on WebSocket/SSE (or very long: 24h+)
- **Any HTTP method** — GET, POST, PUT, DELETE, PATCH, OPTIONS
- **Binary data** — images, files, gRPC-web
- **CORS preflight** — handle OPTIONS before auth check (browsers send OPTIONS without auth headers)
- **Multiple concurrent connections** — user may have code-server + terminal + app all open
- **Hop-by-hop header stripping** — `Transfer-Encoding`, `Connection`, etc. must not be forwarded

This is critical because the proxy is how users expose ANY API/service to the internet. It's not just for code-server — it's their production gateway.

### KV Store (Cloudflare KV)
```
machine:{slug}          → { owner_id, ip, status, created_at, server_type }
apikey:{hash}           → { owner_id, name, created_at, last_used }
session:{jwt_id}        → { owner_id, expires_at }
domain:{custom_domain}  → { slug, owner_id }  (future: custom domain routing)
```

KV is the fast lookup layer. Postgres (Neon) is the source of truth. On provision, we write to both.

### SSL
Cloudflare handles SSL for `*.kortix.cloud` via their Universal SSL (wildcard). No Caddy SSL needed on the VPS since all traffic enters through Cloudflare.

---

## 6. Provisioning Flow (Step by Step)

### Snapshot-Based Provisioning

**We do NOT install from scratch.** A pre-built Hetzner snapshot contains everything:
- Ubuntu 24.04 + code-server + Caddy + Docker + Node + Python + justavps-agent + all dev tools

Cloud-init only injects user-specific config (SSH key, slug, password). This cuts provisioning from ~4 min to **~90–180 seconds** (depending on whether daemon/sandbox-agent are pre-baked in the snapshot).

#### Snapshot Build Process (done once, updated periodically)

Build the base snapshot via Packer or manually:
```
1. Create a temporary Hetzner server from ubuntu-24.04
2. Install everything (code-server, Caddy, Docker, Node, Python, justavps-agent, dev tools)
3. Clean up (apt cache, logs, tmp)
4. Hetzner API: create snapshot → "justavps-base-v{version}"
5. Delete the temporary server
6. Store snapshot ID/description in platform config
```

Automated via GitHub Actions: push to `main` → build new snapshot → update platform config.

The `computer/` codebase already has this exact pattern with `resolveSnapshot()` — finds snapshot by description with 5-min cache. We lift this.

#### Per-User Provisioning Flow

```
User clicks "Create Machine"
  │
  ├─ 1. API validates request (server_type, template, ssh_key_id, region)
  │      - server_type can be ANY Hetzner type (cx22, cx32, cx42, cx52, ccx13, cpx11, cax11, etc.)
  │      - validates server_type disk >= snapshot disk size
  │      - validates server_type available in requested region
  │
  ├─ 2. Create DB record: machine { status: "provisioning", owner_id }
  ├─ 3. Generate slug: abc123 (6 char nanoid, collision-checked)
  ├─ 4. Generate code-server password (20 char random)
  ├─ 5. Generate machine_token (per-machine auth)
  │
  ├─ 6. Hetzner API: POST /v1/servers
  │      {
  │        name: "justavps-{slug}",
  │        server_type: "cx22",             ← user's choice (ANY Hetzner type)
  │        image: snapshot_id,              ← pre-built snapshot (NOT ubuntu-24.04)
  │        location: "nbg1",               ← user's choice
  │        ssh_keys: [hetzner_ssh_key_id],
  │        user_data: <config-only cloud-init>,  ← just SSH key + slug + password (no installs)
  │        firewall: justavps-firewall-id,
  │        labels: { owner: user_id, slug: abc123 }
  │      }
  │
  ├─ 7. Hetzner returns: server_id, ip
  ├─ 8. Cloudflare API: create DNS A record
  │      abc123.kortix.cloud → VPS_IP (proxied, orange-cloud)
  ├─ 9. Cloudflare KV: write machine:{abc123} → { owner_id, ip, status: "provisioning" }
  ├─ 10. DB update: machine { hetzner_id, ip, slug, status: "provisioning" }
  │
  ├─ 11. Background job: poll VPS_IP:7777/health every 5s
  │       → when { ready: true } received:
  │         - DB: machine.status = "ready"
  │         - KV: machine:{slug}.status = "ready"
  │         - push notification to dashboard (SSE)
  │
  └─ 12. Dashboard shows machine as "Ready" with connect details
```

Total time from click to ready: **~90–180 seconds** (Hetzner boots snapshot in ~30s, cloud-init config injection ~10s, daemon/sandbox-agent download ~15–30s if not pre-baked, services start ~10s, DNS propagation ~5s). With pre-baked snapshots containing daemon + sandbox-agent, this drops to ~60s. A provisioning timeout watchdog marks machines as `error` after 5 min (10 min for Docker workloads) if no heartbeat is received.

#### Future: Warm Pool (get to ~10s)

Keep 2-3 pre-booted machines per region. On user request → assign immediately → replenish pool async. Not v1.

### Server Type Selection

Users can pick ANY Hetzner server type (not just our curated list). The dashboard shows all compatible types with pricing:

```
Shared vCPU (Intel):    cx22, cx32, cx42, cx52
Shared vCPU (AMD):      cpx11, cpx21, cpx31, cpx41, cpx51
Dedicated vCPU:         ccx13, ccx23, ccx33, ccx43, ccx53, ccx63
ARM (Ampere):           cax11, cax21, cax31, cax41
```

Filtered by:
- Snapshot disk size compatibility (server disk must be >= snapshot disk)
- Snapshot architecture compatibility (x86 snapshot → only x86 types, ARM → only ARM)
- Region availability

Pricing: Hetzner gross price × 1.2 markup = our price. Shown in dashboard per server type.

This is exactly how `computer/` does it — `listServerTypes()` filters by prefix, disk, architecture, location.

### Machine Resize

Users can resize a running machine to a different server type:

```
POST /v1/machines/:id/resize
  body: { server_type: "cx42" }
  → 202: { action_id, status: "resizing" }

Flow:
  1. Validate new server_type (disk >= current, same architecture)
  2. Hetzner API: POST /servers/{id}/actions/change_type
     { server_type: "cx42", upgrade_disk: true }
  3. Machine reboots automatically (~30s)
  4. Update DB: machine.size = "cx42"
  5. Update Stripe subscription item (new price)
  6. Dashboard shows updated specs + new price
```

**Resize rules (Hetzner-imposed):**
- Can only upgrade disk (never shrink)
- Requires server poweroff for some type changes (Hetzner handles this)
- Same datacenter, no cross-region resize
- x86 ↔ ARM requires new machine (different architecture)

---

## 7. Snapshot & cloud-init

### Base Snapshot (pre-built, everything installed)

The snapshot contains ALL software. Built once, used for every machine:

```
justavps-base-v{version} (Hetzner snapshot)
├── Ubuntu 24.04 LTS
├── code-server (installed, systemd service ready, NOT started)
├── Caddy (installed, systemd service ready, NOT started)
├── justavps-agent (installed at /usr/local/bin, NOT started)
├── Docker + Docker Compose
├── Node LTS (via nvm, user account)
├── Python 3 + pip + uv
├── Dev tools: git, curl, wget, build-essential, unzip, tmux, vim, htop, nano
├── Systemd service files (code-server, caddy, justavps-agent) — templated, waiting for config
└── /etc/justavps/ directory (empty, populated by cloud-init)
```

Services are installed but NOT started/enabled. Cloud-init writes config then starts them.

### cloud-init Script (config-only, no installs)

Since the snapshot has everything, cloud-init only injects per-machine configuration. This runs in ~10 seconds, not 4 minutes.

Templated with:
- `{{SLUG}}` — machine slug (abc123)
- `{{CODE_SERVER_PASSWORD}}` — generated password
- `{{SSH_PUBLIC_KEY}}` — user's SSH public key
- `{{MACHINE_TOKEN}}` — per-machine auth token
- `{{PLATFORM_CALLBACK_URL}}` — `https://api.kortix.cloud`
- `{{TEMPLATE_RUNCMD}}` — template-specific commands (may install additional software)

```yaml
#cloud-config
users:
  - name: user
    groups: users, admin, docker
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - {{SSH_PUBLIC_KEY}}

# NO packages, NO package_update — everything is in the snapshot

write_files:
  - path: /etc/justavps/config.json
    content: |
      {
        "slug": "{{SLUG}}",
        "callback_url": "{{PLATFORM_CALLBACK_URL}}",
        "machine_token": "{{MACHINE_TOKEN}}"
      }

  - path: /etc/caddy/Caddyfile
    content: |
      :80 {
        reverse_proxy localhost:8080
      }

  - path: /etc/justavps/code-server.env
    content: |
      PASSWORD={{CODE_SERVER_PASSWORD}}
      PROXY_DOMAIN={{SLUG}}.kortix.cloud

runcmd:
  # Inject per-machine config into systemd services
  - sed -i 's/__SLUG__/{{SLUG}}/g' /etc/systemd/system/code-server.service
  - sed -i 's/__SLUG__/{{SLUG}}/g' /etc/systemd/system/justavps-agent.service

  # Template-specific install (only templates that need extra software)
  # {{TEMPLATE_RUNCMD}}

  # Start all services (already installed in snapshot)
  - systemctl daemon-reload
  - systemctl enable --now code-server
  - systemctl enable --now caddy
  - systemctl enable --now justavps-agent
```

### Template `runcmd` injections

Templates that need additional software pay a small install-time cost. Most are pre-installed in the snapshot or install quickly.

**blank:** (nothing extra — fastest provision)

**claude-code:**
```bash
- su -c "source ~/.nvm/nvm.sh && npm install -g @anthropic-ai/claude-code" user
```

**opencode:**
```bash
- curl -fsSL https://opencode.ai/install.sh | sh
- |
  cat > /etc/systemd/system/opencode-web.service << 'EOF'
  [Unit]
  Description=OpenCode Web UI
  After=network.target
  [Service]
  Type=simple
  User=user
  ExecStart=/usr/local/bin/opencode serve --port 3456
  Restart=always
  RestartSec=3
  [Install]
  WantedBy=multi-user.target
  EOF
- systemctl enable --now opencode-web
```

**openclaw:**
```bash
- curl -fsSL https://openclaw.dev/install.sh | sh
```

**docker-compose:** (nothing extra, docker already in snapshot)

**Note:** Templates that install software (claude-code, opencode, openclaw) add ~30-60s to provisioning. The blank template provisions in ~60s total. Future optimization: bake popular templates into separate snapshots (e.g. `justavps-opencode-v{version}`) for instant provision of any template.

---

## 8. JustAVPS Agent (justavps-agent)

Small Go binary (~5MB static). Three functions:

```
GET  :7777/health      → { ready: bool, uptime: int, services: { code_server: bool, caddy: bool } }
WS   :7777/pty         → Full PTY WebSocket (xterm.js compatible)
POST :7777/heartbeat   → Agent initiates periodic heartbeat TO platform (outbound)
```

### Port 7777 Protection

Port 7777 is ONLY accessible from our platform IPs. This is enforced by:
1. **Hetzner Firewall** (external, user can't modify) — only allows 7777 from our IP range
2. **Agent-level check** — validates source IP against configured platform IPs
3. **Machine token** — all requests must include `Authorization: Bearer {{MACHINE_TOKEN}}`

### Heartbeat (agent → platform)

The agent sends an outbound HTTPS POST to `api.kortix.cloud/v1/internal/heartbeat` every 60s:
```json
{
  "slug": "abc123",
  "machine_token": "mt_xxx",
  "uptime": 3600,
  "services": { "code_server": true, "caddy": true },
  "load": { "cpu": 0.45, "memory": 0.62, "disk": 0.31 }
}
```

Platform uses heartbeats to:
- Know the machine is alive (no heartbeat for 5min → mark as unhealthy)
- Display resource usage in dashboard
- Detect if user killed services (services field shows what's running)

### PTY Auth
- Request comes through CF Worker (already authenticated at edge)
- Agent additionally validates `Authorization: Bearer <machine_token>` in the WebSocket upgrade
- CF Worker injects the machine token when proxying to :7777

### PTY WebSocket Protocol
```
Client → Server: { type: "resize", cols: 80, rows: 24 }
Client → Server: { type: "input", data: "ls -la\n" }
Server → Client: { type: "output", data: "total 48\n..." }
Server → Client: { type: "exit", code: 0 }
```

This gives the dashboard a browser-based terminal (xterm.js) with zero SSH client needed.

---

## 9. Platform API

Base URL: `https://api.kortix.cloud/v1`

Auth: `Authorization: Bearer sk_live_xxx` (API key) or session cookie for dashboard

Built with: **Hono + @hono/zod-openapi** on Next.js API routes

OpenAPI spec auto-generated at: `https://api.kortix.cloud/doc`
Swagger UI at: `https://api.kortix.cloud/ui`

### Machines

```
POST   /machines
  body: { server_type, template, ssh_key_id, name?, region? }
  server_type: any Hetzner type (cx22, cpx31, ccx13, cax11, etc.)
  → 201: { id, slug, status: "provisioning", created_at }

GET    /machines
  → 200: { machines: [...] }

GET    /machines/:id
  → 200: {
      id, slug, name, status,
      ip, server_type, template, region,
      specs: { vcpu, ram_gb, disk_gb, cpu_type, architecture },
      price_monthly: 10.99,
      created_at,
      urls: {
        vscode:     "https://abc123.kortix.cloud",
        pty:        "wss://abc123.kortix.cloud/_pty",
        opencode:   "https://3456.abc123.kortix.cloud" (if opencode template),
      },
      ssh: "ssh user@1.2.3.4",
      connect: {
        vscode_url:      "https://abc123.kortix.cloud",
        vscode_password: "xxxx",
        ssh_command:     "ssh user@1.2.3.4",
        cursor_guide:    "Add SSH Host: user@1.2.3.4",
        claude_code:     "claude --ssh user@1.2.3.4",
        opencode:        "opencode (pre-installed, Web UI at 3456.abc123.kortix.cloud)",
        openclaw:        "OpenClaw (pre-installed, accessible via proxy)",
      },
      health: {   ← from last heartbeat
        cpu: 0.45, memory: 0.62, disk: 0.31,
        services: { code_server: true, caddy: true },
        last_heartbeat_at: "..."
      }
    }

DELETE /machines/:id
  → 204

POST   /machines/:id/reboot
  → 202: { action_id }

POST   /machines/:id/resize
  body: { server_type: "cx42" }
  → 202: { action_id, old_type, new_type, old_price, new_price }
  Notes:
    - disk can only grow (Hetzner restriction)
    - same architecture required (x86↔ARM = new machine)
    - Stripe subscription item updated with new price (prorated)
    - Machine reboots during resize (~30s downtime)
```

### Server Types (dynamic from Hetzner)

```
GET    /server-types
  query: { region? }
  → 200: { server_types: [
    {
      name: "cx22",
      description: "CX22",
      vcpu: 2, ram_gb: 4, disk_gb: 40,
      cpu_type: "shared", architecture: "x86",
      price_monthly: 10.99,    ← our price (Hetzner × 1.2)
      hetzner_price: 4.35,     ← raw Hetzner price (EUR)
      available: true
    },
    ...
  ]}
```

### Snapshots

```
POST   /machines/:id/snapshots
  body: { name? }
  → 202: { snapshot_id, status: "creating" }

GET    /snapshots
  → 200: { snapshots: [...] }

GET    /snapshots/:id
  → 200: { id, name, size_gb, created_at, machine_id }

DELETE /snapshots/:id
  → 204

POST   /machines (snapshot_id: x)
  body: { snapshot_id, size, ssh_key_id }
  → 201: { id, slug, status: "provisioning" }
```

### Templates

```
GET    /templates
  → 200: { templates: [
    { id: "blank",       name: "Blank Ubuntu",   description: "..." },
    { id: "claude-code", name: "Claude Code",     description: "..." },
    { id: "opencode",    name: "OpenCode",        description: "...", auto_serve: { port: 3456, name: "OpenCode Web UI" } },
    { id: "openclaw",    name: "OpenClaw",        description: "..." },
    { id: "docker",      name: "Docker",          description: "..." },
  ]}
```

### SSH Keys

```
POST   /ssh-keys
  body: { name, public_key }
  → 201: { id, name, fingerprint }

GET    /ssh-keys
  → 200: { ssh_keys: [...] }

DELETE /ssh-keys/:id
  → 204
```

### API Keys

```
POST   /api-keys
  body: { name }
  → 201: { id, name, key: "sk_live_xxx" }   ← key only shown ONCE

GET    /api-keys
  → 200: { api_keys: [{ id, name, created_at, last_used }] }   ← no key value

DELETE /api-keys/:id
  → 204
```

### Machines — PTY

```
WS     /machines/:id/pty
  → Upgrades to WebSocket
  → Proxied through to VPS:7777/pty
  → Same auth (Bearer or session cookie)
```

### Account

```
GET    /account
  → 200: { id, email, plan, machines_count, created_at }

GET    /account/usage
  → 200: { current_period: { machines: [...], total_compute_hours, estimated_cost } }

GET    /account/billing
  → 200: { portal_url: "https://billing.stripe.com/session/..." }
```

### Internal (not public, used by agent + CF Worker)

```
POST   /internal/heartbeat
  body: { slug, machine_token, uptime, services, load }
  → 200: { ack: true }
  [Validated by machine_token]

GET    /internal/validate-key
  query: { key_hash, machine_slug }
  → 200: { valid: true, owner_id }
  → 401: { valid: false }
  [IP-restricted to CF Worker IPs]
```

---

## 10. Database Schema (Postgres via Neon + Drizzle ORM)

```sql
-- Users
users (
  id                 uuid PK,
  email              text UNIQUE,
  github_id          text UNIQUE,
  created_at         timestamp,
  stripe_customer_id text
)

-- SSH Keys
ssh_keys (
  id              uuid PK,
  owner_id        uuid FK users,
  name            text,
  public_key      text,
  fingerprint     text,
  hetzner_key_id  bigint,
  created_at      timestamp
)

-- Machines
machines (
  id                    uuid PK,
  owner_id              uuid FK users,
  slug                  text UNIQUE,
  name                  text,
  status                text,       -- provisioning | ready | error | stopped | deleted
  server_type           text,       -- ANY Hetzner type: cx22, cx32, cpx31, ccx13, cax11, etc.
  template              text,       -- blank | claude-code | opencode | openclaw | docker
  region                text,       -- nbg1 | fsn1 | hel1
  ip                    text,
  hetzner_id            bigint,
  hetzner_fw_id         bigint,
  machine_token         text,       -- per-machine token for agent ↔ platform auth
  code_server_password  text,       -- encrypted at rest
  snapshot_id           uuid,       -- if provisioned from user snapshot
  base_snapshot_id      text,       -- hetzner snapshot image ID used at provision
  stripe_sub_item_id    text,       -- stripe subscription item for this machine
  domains               jsonb,      -- future: ["abc123.kortix.cloud", "custom.example.com"]
  last_heartbeat_at     timestamp,  -- last agent heartbeat
  last_heartbeat        jsonb,      -- { cpu, memory, disk, services }
  created_at            timestamp,
  ready_at              timestamp,
  deleted_at            timestamp
)

-- Snapshots
snapshots (
  id                uuid PK,
  owner_id          uuid FK users,
  machine_id        uuid FK machines,
  name              text,
  hetzner_image_id  bigint,
  size_gb           int,
  status            text,       -- creating | ready | error
  created_at        timestamp
)

-- API Keys
api_keys (
  id          uuid PK,
  owner_id    uuid FK users,
  name        text,
  key_prefix  text,           -- "sk_live_abc" (first 12 chars, for display)
  key_hash    text,           -- bcrypt hash, never store plain
  last_used   timestamp,
  created_at  timestamp
)

-- Billing / Subscriptions
subscriptions (
  id                       uuid PK,
  owner_id                 uuid FK users,
  stripe_subscription_id   text,
  stripe_price_id          text,
  status                   text,
  current_period_start     timestamp,
  current_period_end       timestamp
)

-- Machine billing records (for usage tracking)
machine_billing (
  id          uuid PK,
  machine_id  uuid FK machines,
  owner_id    uuid FK users,
  started_at  timestamp,
  ended_at    timestamp,
  server_type text,
  hours       decimal
)
```

---

## 11. Pricing

### Pricing — Curated Default + Full Hetzner Catalog

**Formula:** `our_price = ceil(hetzner_gross_price_eur × 2.5 × eur_to_usd)`

Round up to nearest dollar. Simple, generous margin that covers infra (proxy, agent, platform, support).

Prices are **per-region** — Hetzner charges differently per location. The API returns real-time pricing from Hetzner for the selected region with our markup applied.

#### Default Picks (shown by default in dashboard)

3-4 curated options shown prominently. These cover 90% of use cases:

| Name | Type | vCPU | RAM | Disk | Hetzner/mo | Our Price/mo |
|------|------|------|-----|------|------------|--------------|
| Starter | CX22 | 2 | 4GB | 40GB | ~€4.35 | **$12/mo** |
| Pro | CX32 | 4 | 8GB | 80GB | ~€8.21 | **$22/mo** |
| Power | CX42 | 8 | 16GB | 160GB | ~€16.60 | **$45/mo** |
| Beast | CX52 | 16 | 32GB | 320GB | ~€33.50 | **$90/mo** |

*(Prices approximate — actual depends on region, fetched from Hetzner API)*

#### "More Options" (expandable section)

Click "More Options" to see the full Hetzner catalog for the selected region:

| Category | Types | Note |
|----------|-------|------|
| Shared AMD | CPX11, CPX21, CPX31, CPX41, CPX51 | Better price/perf than Intel |
| Dedicated vCPU | CCX13, CCX23, CCX33, CCX43, CCX53, CCX63 | No noisy neighbors, higher price |
| ARM (Ampere) | CAX11, CAX21, CAX31, CAX41 | Cheapest option, requires ARM snapshot |

All with the same 2.5x markup formula. User picks any, we provision it.

#### Region Selection

User picks region at machine creation. Available regions (Hetzner):
- `nbg1` — Nuremberg, Germany
- `fsn1` — Falkenstein, Germany
- `hel1` — Helsinki, Finland
- `ash` — Ashburn, USA (East)
- `hil` — Hillsboro, USA (West)

Pricing varies by region. The dashboard shows prices for the selected region.

**Notes:**
- ARM types require a separate ARM snapshot (different architecture) — v2
- All types filtered by snapshot disk size + architecture compatibility
- Resize changes Stripe subscription to new price (prorated)

### Billing Model

- **Per machine, monthly.** Stripe subscription item per machine.
- **Machine created** → subscription item added (immediate prorated invoice)
- **Machine deleted** → subscription item removed (prorated credit)
- **Machine resized** → subscription item updated (prorated to new price)
- **Snapshots:** $0.05/GB/month (Hetzner charges €0.0119/GB, we round up)
- **Stripe customer portal** for self-service billing management

---

## 12. Tech Stack

```
Frontend + API:
  Next.js 15 (App Router)
  TypeScript
  Tailwind CSS
  shadcn/ui
  Hono (API layer, mounted at /api/*)
  @hono/zod-openapi (routes + OpenAPI spec generation)
  Zod (validation, shared between frontend + backend)

Database:
  Neon (serverless Postgres)
  Drizzle ORM

Auth:
  TBD (Clerk / Supabase Auth / custom — decision pending)

Payments:
  Stripe (subscriptions, customer portal)

Infra:
  Vercel (Next.js deployment)
  Cloudflare (DNS for kortix.cloud, Workers, KV)
  Hetzner Cloud API (VPS provisioning)

Agent binary:
  Go (static binary, ~5MB)
  Endpoints: /health, /pty (WebSocket), /heartbeat (outbound)

Background jobs:
  Vercel Cron (poll provisioning status every 30s)
  OR QStash (Upstash) for reliable job queue

Real-time:
  Server-Sent Events (SSE) for provisioning status push to dashboard
  WebSocket (PTY terminal in dashboard, proxied through CF Worker)

SDK (later):
  @justavps/sdk → hono/client wrapper (TypeScript, zero extra maintenance)
  Python SDK → generated from OpenAPI spec via openapi-python-client
```

---

## 13. Repository Structure

```
justavps.com/
├── app/                          Next.js App Router
│   ├── (marketing)/              Landing page, pricing
│   ├── (dashboard)/              Authenticated dashboard
│   │   ├── machines/             Machine list + detail
│   │   ├── machines/new/         Provision flow
│   │   ├── snapshots/            Snapshot management
│   │   ├── settings/             SSH keys, API keys, billing
│   │   └── docs/                 In-app documentation (see §17)
│   └── api/
│       └── [[...route]]/         Hono mounted here
│           └── route.ts
│
├── server/
│   ├── routes/                   Hono route definitions
│   │   ├── machines.ts
│   │   ├── snapshots.ts
│   │   ├── templates.ts
│   │   ├── ssh-keys.ts
│   │   ├── api-keys.ts
│   │   └── account.ts
│   ├── lib/
│   │   ├── hetzner.ts            Hetzner API client
│   │   ├── cloudflare.ts         CF API + KV client
│   │   ├── cloud-init.ts         cloud-init template generator
│   │   ├── provisioner.ts        Full provision flow orchestration
│   │   └── stripe.ts             Stripe helpers
│   └── db/
│       ├── schema.ts             Drizzle schema
│       └── index.ts              DB connection
│
├── agent/                        Go binary source
│   ├── main.go
│   ├── health.go
│   ├── pty.go
│   └── heartbeat.go
│
├── workers/                      Cloudflare Worker source
│   └── proxy/
│       └── index.ts              Auth gateway Worker
│
├── lib/
│   ├── schemas.ts                Shared Zod schemas
│   └── types.ts                  Shared TypeScript types
│
├── content/                      Documentation content (MDX)
│   ├── getting-started.mdx
│   ├── api-reference.mdx
│   ├── connect-vscode.mdx
│   ├── connect-cursor.mdx
│   ├── connect-claude-code.mdx
│   ├── connect-opencode.mdx
│   ├── connect-openclaw.mdx
│   ├── agent-toolbox.mdx
│   ├── proxy-guide.mdx
│   ├── templates.mdx
│   ├── snapshots.mdx
│   └── billing.mdx
│
└── components/
    ├── terminal.tsx              xterm.js PTY terminal
    ├── machine-card.tsx
    └── provision-wizard.tsx
```

---

## 14. Connection Guides (shown in dashboard)

For every machine, the dashboard shows copy-paste instructions for:

### VS Code / Cursor
```
1. Open Command Palette → "Remote-SSH: Add New SSH Host"
2. Enter: ssh user@1.2.3.4
3. Connect → you're in. Port forwarding works natively in VS Code.
```

### Claude Code
```
ssh user@1.2.3.4
# Claude Code is pre-installed (claude-code template)
# Or install manually:
npm install -g @anthropic-ai/claude-code
claude
```

### OpenCode
```
# Web UI (already running if you picked the OpenCode template):
https://3456.abc123.kortix.cloud

# CLI via SSH:
ssh user@1.2.3.4
opencode
```

### OpenClaw
```
ssh user@1.2.3.4
# OpenClaw is pre-installed (openclaw template)
# Access via proxy: https://{port}.abc123.kortix.cloud
```

### Browser (code-server)
```
Open: https://abc123.kortix.cloud
```

### API / Agent access
```bash
# Hit any port your VPS exposes, through our proxy:
curl https://8000.abc123.kortix.cloud/your-api \
  -H "Authorization: Bearer sk_live_xxx"

# PTY (WebSocket terminal):
wscat -c wss://abc123.kortix.cloud/_pty \
  -H "Authorization: Bearer sk_live_xxx"
```

---

## 15. Documentation (In-App)

The dashboard includes **full in-depth documentation** as a first-class section. Not a separate docs site — it's IN the product at `justavps.com/docs/*`.

### Doc Sections

1. **Getting Started**
   - Create your first machine (step-by-step with screenshots)
   - Connect from your IDE (VS Code, Cursor)
   - Connect from Claude Code / OpenCode / OpenClaw
   - Understanding the proxy layer

2. **API Reference**
   - Full OpenAPI-powered reference (auto-generated from Hono route definitions)
   - Interactive examples (Swagger UI embedded at `api.kortix.cloud/ui`)
   - Authentication guide (API keys, session cookies)
   - Rate limits, error codes

3. **Proxy Guide**
   - How the proxy works (subdomain routing, auth)
   - Exposing your own APIs through the proxy
   - WebSocket and SSE through the proxy
   - Using the proxy as an API gateway for your agents

4. **Agent Toolbox Guide**
   - How to run your own bash/FS/exec API on the VPS
   - Accessing it via the proxy with your API key
   - Example: running a simple bash API that agents can call
   - Example: deploying a REST API and accessing it at `8000.abc123.kortix.cloud`
   - PTY WebSocket API documentation (protocol, examples)

5. **Templates**
   - What each template includes
   - How to create your own (Docker image → snapshot → template)
   - Template marketplace (future)

6. **Snapshots**
   - Creating and restoring snapshots
   - Sharing snapshots (future)

7. **Billing**
   - Pricing breakdown
   - How billing works (per-machine, monthly, prorated)
   - Stripe customer portal

### Doc Implementation
- MDX files in `/content/` directory
- Rendered via Next.js App Router pages at `/docs/*`
- Sidebar navigation, search, code blocks with copy buttons
- API reference auto-generated from OpenAPI spec

---

## 16. Build Order (MVP Milestones)

### M1 — Core Infrastructure (Days 1-3)
- [ ] Next.js 15 project scaffold + Tailwind + shadcn
- [ ] Hono mounted at `/api/[[...route]]` with `@hono/zod-openapi`
- [ ] Neon Postgres + Drizzle schema (all tables)
- [ ] Auth setup (TBD provider)
- [ ] Hetzner API client (create, delete, list, reboot)
- [ ] cloud-init template generator
- [ ] Cloudflare API client (DNS record create/delete, KV read/write)
- [ ] Provisioner orchestration (Hetzner → DNS → KV → DB → poll agent health)

### M2 — API Complete (Days 3-5)
- [ ] All `/v1/machines` endpoints
- [ ] All `/v1/snapshots` endpoints
- [ ] `/v1/templates`, `/v1/ssh-keys`, `/v1/api-keys`
- [ ] `/v1/account`, `/v1/account/billing`
- [ ] `/v1/machines/:id/pty` WebSocket proxy
- [ ] OpenAPI spec at `/api/doc` + Swagger UI at `/api/ui`
- [ ] Internal `/internal/heartbeat` + `/internal/validate-key`

### M3 — Agent Binary (Days 4-6, parallel)
- [ ] Go binary: `/health` endpoint
- [ ] Go binary: `/pty` WebSocket (xterm.js protocol)
- [ ] Go binary: heartbeat (outbound POST to platform every 60s)
- [ ] Auth: machine token validation
- [ ] Build + CDN publish pipeline (GitHub Actions → upload to CF R2)

### M4 — Cloudflare Worker (Days 5-6)
- [ ] Worker: parse hostname (slug / port.slug) — works for kortix.cloud, extensible
- [ ] Worker: auth (API key from KV / JWT cookie / ?token= param)
- [ ] Worker: ownership check (KV lookup)
- [ ] Worker: HTTP proxy to VPS_IP:port (with hop-by-hop header stripping)
- [ ] Worker: WebSocket proxy (code-server + PTY + OpenCode Web UI)
- [ ] Worker: SSE passthrough
- [ ] Worker: CORS preflight handling

### M5 — Dashboard UI (Days 5-8)
- [ ] Landing page (marketing, pricing table)
- [ ] Provision wizard (size picker, template picker, SSH key selector)
- [ ] Machine list (status, connect button, URL)
- [ ] Machine detail (status, connect guide tabs, terminal, resource usage from heartbeat)
- [ ] xterm.js terminal component (connected to PTY WebSocket)
- [ ] Snapshot management page
- [ ] Settings (SSH keys, API keys, billing portal link)

### M6 — Documentation (Days 6-8, parallel)
- [ ] Docs layout (sidebar, search, MDX renderer)
- [ ] Getting started guide
- [ ] API reference (auto-generated from OpenAPI)
- [ ] Proxy guide
- [ ] Agent toolbox guide
- [ ] Connection guides (VS Code, Cursor, Claude Code, OpenCode, OpenClaw)

### M7 — Billing + Polish (Days 7-9)
- [ ] Stripe integration (subscription create on machine provision)
- [ ] Stripe webhook (subscription cancelled → delete machine)
- [ ] Stripe customer portal link
- [ ] SSE for provisioning status (dashboard updates in real-time)
- [ ] Error states, loading states, empty states
- [ ] Send "your machine is ready" email

### M8 — Ship
- [ ] Vercel deployment (justavps.com)
- [ ] Cloudflare Worker deployment (*.kortix.cloud)
- [ ] Agent binary v0.1 published to CF R2
- [ ] E2E test: provision → ready → connect → PTY works → proxy works → destroy
- [ ] Soft launch

---

## 17. What We're NOT Building (Scope Control)

- No multi-provider (Hetzner only for now. OVH/Contabo later)
- No custom domains on the proxy (architecture-ready, not v1)
- No team/org accounts (v2)
- No agent toolbox API built-in (/exec, /fs, /processes) — user runs their own, accesses via proxy
- No marketplace / public snapshot sharing (v2)
- No Windows / macOS templates
- No GPU instances (v2)
- No managed databases (not our product)
- No built-in CI/CD
- No log aggregation / monitoring (user's problem, can run their own via proxy)

---

## 18. Key Design Decisions (Record)

| Decision | Choice | Reason |
|---|---|---|
| VPS Provider | Hetzner only | Best API, EU privacy, cheapest reliable option |
| Base image | Ubuntu 24.04 + OpenCode/platform services | Prewired machine access plus authenticated proxying |
| Brand domain | justavps.com (marketing + dashboard) | Clean brand, separate from infra |
| Infra domain | kortix.cloud (API + proxy subdomains) | Shared infra domain, extensible to multi-brand |
| Machine URLs | abc123.kortix.cloud | Infra domain, not brand — allows multi-brand later |
| Multi-domain | Architecture-ready (domains[] on machine, CF Worker parses any) | v2: *.justavps.com, custom domains |
| Proxy | Cloudflare Worker | Zero infra to maintain, auth at edge, free tier covers MVP |
| Port proxy | code-server `--proxy-domain` | Native feature, no extra work |
| Proxy auth | CF Worker validates API key / JWT / ?token= | Single auth layer, VPS is dumb compute |
| VPS security | Hetzner Firewall (external, user can't modify) | Only CF IPs can reach HTTP. SSH direct. Tamper-proof |
| Agent | Tiny Go binary, /health + /pty + heartbeat | Minimal footprint, auto-restart via systemd |
| Toolbox API | Not built-in. User runs their own, accesses via proxy | Keeps JustAVPS simple. Proxy IS the gateway. Full guide in docs |
| OpenCode | Auto-served with Web UI when template selected | 3456.abc123.kortix.cloud accessible out of box |
| API framework | Hono + @hono/zod-openapi | REST-native, OpenAPI for free, TypeScript SDK via hono/client |
| Database | Neon + Drizzle | Serverless Postgres, no connection pool management |
| Auth provider | TBD | Decision pending |
| Billing | Stripe | Industry standard, subscription model |
| Docs | In-app, MDX, includes API ref + agent toolbox guide + proxy guide | First-class, not afterthought |
| SDK | hono/client (TS), OpenAPI codegen (Python later) | Write once, get typed SDK free |
| Monorepo | Single Next.js repo | UI + API + types in one place, no coordination overhead |
