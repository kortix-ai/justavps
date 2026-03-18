# Proxy Architecture Evaluation: "Deploy & It Just Works"

> **Goal:** Every VPS gets `{port}.{slug}.kortix.cloud` routing for HTTP, WebSocket, SSE — automatically, reliably, zero manual config.

---

## Current Architecture (What You Have Today)

```
Browser/API
    │
    ▼
Cloudflare CDN (orange-cloud)
    │
    ▼
CF Worker "kortix-cloud-proxy"        ← auth (JWT/API key) + route parsing
    │
    ▼ fetch(http://origin-{slug}.kortix.cloud:{port})
    │
VPS IP:{port}
    │
    ▼
Caddy (:80) → code-server / daemon / agent / opencode
```

**Per-machine DNS records created at provision time:**
| Record | Type | Value | Proxied |
|--------|------|-------|---------|
| `{slug}.kortix.cloud` | A | VPS_IP | ✅ orange |
| `*.{slug}.kortix.cloud` | A | VPS_IP | ✅ orange |
| `origin-{slug}.kortix.cloud` | A | VPS_IP | ❌ grey (DNS-only) |

**Auth flow:**
1. JWT cookie (`__justavps_proxy`) set on `.kortix.cloud` domain
2. OR `Authorization: Bearer sk_live_*` API key (SHA-256 hash in CF KV)
3. OR `?token=<jwt>` query param (WebSocket/iframe fallback)

**What works:**
- HTTP proxying ✅
- WebSocket proxying (xterm.js PTY, code-server) ✅
- SSE streaming ✅
- CORS preflight ✅
- Auth + ownership check ✅
- Port-based subdomains (`3000.slug.kortix.cloud`) ✅
- Path-based port fallback (`slug.kortix.cloud/_port/3000/`) ✅

---

## Current Architecture: Honest Assessment

### ✅ Strengths

| Strength | Why it matters |
|----------|---------------|
| **Already built & deployed** | ~600 lines of battle-tested Worker code |
| **Global edge auth** | Auth happens at 300+ CF PoPs, before traffic touches VPS |
| **Free TLS everywhere** | CF handles certs for `*.kortix.cloud` — zero cert management |
| **DDoS protection** | CF's network absorbs attacks, VPS never exposed directly |
| **Smart Placement** | `placement.mode = "smart"` runs Worker close to origin |
| **No infra to maintain** | Worker is serverless — no proxy server to keep alive |
| **Integrated KV** | Machine lookup is sub-10ms at the edge |

### ⚠️ Weaknesses / Risks

| Issue | Severity | Detail |
|-------|----------|--------|
| **DNS propagation delay** | 🟡 Medium | Creating 3 DNS records per machine takes 2-5s via API, and propagation can take 30-60s. New machines may not be reachable immediately. |
| **CF Worker WebSocket limits** | 🟡 Medium | WebSocket messages limited to 1MB per frame. Binary data works but has overhead. No raw TCP passthrough. |
| **CF Worker CPU limits** | 🟢 Low | 50ms CPU (paid), 10ms (free). Proxy pass-through uses minimal CPU. Not a real concern. |
| **CF Worker subrequest limits** | 🟢 Low | 1000 subrequests per invocation. Each proxy = 1 subrequest. Fine. |
| **KV eventual consistency** | 🟡 Medium | KV writes propagate globally in ~60s. New machine → Worker can't find it in KV for up to 60s. |
| **Per-machine DNS records** | 🟡 Medium | N machines = 3N DNS records. At scale (1000+ machines), this is a lot of DNS records to manage, and CF has zone-level limits. |
| **CF can't fetch CF-proxied IPs** | 🟡 Medium | Why `origin-{slug}` DNS-only records exist. Extra complexity, extra DNS record per machine. |
| **No TCP/UDP passthrough** | 🔴 High | CF Workers only handle HTTP/WS. Can't proxy SSH, databases, game servers, raw TCP. Hetzner Firewall blocks direct access. |
| **Vendor lock-in** | 🟡 Medium | Deep dependency on CF Workers, KV, DNS API, and their proxy behavior. |
| **Wildcard DNS depth** | 🟡 Medium | CF free/pro only supports single-level wildcards. `*.slug.kortix.cloud` works, but `a.b.slug.kortix.cloud` won't. |
| **Cloudflare 100-error pages** | 🟡 Medium | If VPS is down, CF shows its ugly 502/522/524 pages. No custom error control. |
| **Cost at scale** | 🟢 Low | Workers Paid ($5/mo + $0.50/M requests) is cheap. But CF Argo/Spectrum add up. |

### 🔴 The Biggest Gap: No Raw TCP

Right now if a user runs a Postgres on port 5432, or an SSH server, or a game server — **they can't reach it through the proxy**. The CF Worker only handles HTTP/WS. The Hetzner Firewall is locked to CF IPs only on ports 80 + 1024-65535, so direct IP access won't work either.

**Current workaround:** Users SSH directly to VPS IP (port 22 is open to all in Hetzner FW). But for anything else TCP-based, they're stuck.

---

## Option Analysis: What Exists in the Market

### Option 1: Keep Current CF Worker (Status Quo + Improvements)

**What:** Keep the existing architecture, fix the gaps.

**Improvements possible:**
- Pre-warm KV: Write machine info before DNS records, add retry/poll in Worker
- Health-check endpoint: Worker returns custom error page if VPS unreachable
- Cache machine info: Use CF Cache API (not just KV) for faster lookups
- TCP: Open Hetzner FW for direct IP access on user ports (bypass proxy for TCP)

**Verdict:**
| Aspect | Score |
|--------|-------|
| Reliability | 8/10 — CF's network is extremely reliable |
| "Just works" | 7/10 — DNS propagation delay, KV sync delay |
| WebSocket | 8/10 — Works, with frame size limits |
| TCP support | 2/10 — Only through direct IP (no proxy) |
| Maintenance | 9/10 — Serverless, no infra |
| Cost | 9/10 — Pennies at current scale |
| Vendor lock-in | 3/10 — Deep CF dependency |

---

### Option 2: Traefik on a Dedicated Proxy Server

**What:** Single Traefik instance on a dedicated VPS as the central proxy. Wildcard DNS `*.kortix.cloud` points to this box. Traefik routes based on hostname → upstream VPS IP.

```
*.kortix.cloud → Proxy VPS (Traefik)
                     │
                     ├─ slug1.kortix.cloud → VPS_1:80
                     ├─ 3000.slug1.kortix.cloud → VPS_1:3000
                     ├─ slug2.kortix.cloud → VPS_2:80
                     └─ ...
```

**How it works:**
- ONE wildcard DNS record: `*.kortix.cloud → PROXY_IP`
- Traefik watches a config source (Redis, HTTP API, file) for backends
- When machine provisioned → add entry to config store → Traefik picks it up in <1s
- Traefik handles TLS via Let's Encrypt (wildcard cert via DNS-01 challenge)
- Traefik natively supports HTTP, WebSocket, SSE, gRPC
- TCP/UDP routing via Traefik's TCP routers (SNI-based)

**Pros:**
- ✅ Single wildcard DNS record (no per-machine DNS)
- ✅ Instant routing (config update = immediate, no DNS propagation)
- ✅ Native WebSocket/SSE/gRPC support
- ✅ TCP/TLS passthrough possible (SNI routing)
- ✅ Built-in Let's Encrypt (wildcard via DNS-01)
- ✅ Built-in health checks, circuit breakers, retry
- ✅ Dashboard for monitoring
- ✅ Middleware: auth, rate-limit, headers, IP whitelist
- ✅ Hot reload — no downtime for config changes

**Cons:**
- ❌ **Single point of failure** — proxy box dies, ALL machines unreachable
- ❌ **Bandwidth bottleneck** — ALL traffic flows through one box
- ❌ **Must maintain a server** — updates, monitoring, disk, certificates
- ❌ **No edge auth** — auth happens at proxy, not at CF edge
- ❌ **Geography** — proxy in EU means US users get extra latency
- ❌ **DDoS target** — single IP, single box, easy to overwhelm
- ❌ **Scaling** — need to upgrade or add proxy nodes as traffic grows

**Mitigations:**
- Run 2+ Traefik nodes behind CF load balancer (orange-cloud wildcard A)
- Use CF in front for DDoS + TLS termination, Traefik behind for routing
- Use Redis/Consul for config storage (multi-node sync)

**Verdict:**
| Aspect | Score |
|--------|-------|
| Reliability | 6/10 — SPOF unless HA setup |
| "Just works" | 9/10 — Config update = instant routing |
| WebSocket | 10/10 — Native, no limits |
| TCP support | 8/10 — SNI-based TCP routing works |
| Maintenance | 5/10 — Server to babysit |
| Cost | 7/10 — €5-20/mo for proxy box |
| Vendor lock-in | 9/10 — Open source, portable |

---

### Option 3: Caddy on a Dedicated Proxy Server

**What:** Same as Traefik but with Caddy. Caddy is simpler, auto-HTTPS by default.

**Differences from Traefik:**
- Simpler config (Caddyfile or JSON API)
- Auto-HTTPS with zero config (just use domain names)
- Admin API for dynamic config updates (`POST /config/...`)
- No built-in dashboard (but Prometheus metrics available)
- Less middleware ecosystem than Traefik
- No native TCP/UDP routing (HTTP only, WebSocket via HTTP upgrade)

**Caddy Dynamic Backend Example:**
```
# POST to Caddy admin API when machine provisioned:
curl -X POST http://localhost:2019/config/apps/http/servers/srv0/routes \
  -H "Content-Type: application/json" \
  -d '{
    "match": [{"host": ["slug1.kortix.cloud", "*.slug1.kortix.cloud"]}],
    "handle": [{"handler": "reverse_proxy", "upstreams": [{"dial": "1.2.3.4:80"}]}]
  }'
```

**Verdict:**
| Aspect | Score |
|--------|-------|
| Reliability | 6/10 — Same SPOF issue |
| "Just works" | 9/10 — Admin API = instant |
| WebSocket | 10/10 — Native |
| TCP support | 3/10 — No native TCP routing |
| Maintenance | 6/10 — Simpler than Traefik |
| Cost | 7/10 — Same box cost |
| Vendor lock-in | 9/10 — Open source |

---

### Option 4: Nginx + Lua / OpenResty (Dynamic Upstream)

**What:** Nginx with Lua scripting for dynamic upstream resolution. Query Redis/API for backend IP per request.

**How:**
- Wildcard DNS → Nginx box
- Lua script on each request: parse hostname → lookup backend IP in Redis → proxy
- No reload needed — Lua resolves dynamically

**Pros:**
- ✅ Battle-tested, highest performance proxy
- ✅ Dynamic resolution via Lua (no reloads)
- ✅ TCP/UDP stream modules
- ✅ Massive community, known technology

**Cons:**
- ❌ Complex config (Lua + Nginx = steep learning curve)
- ❌ Same SPOF/bottleneck issues
- ❌ TLS cert management more manual (need cert-manager or acme.sh)
- ❌ No admin API — must script everything

**Verdict:**
| Aspect | Score |
|--------|-------|
| Reliability | 6/10 — SPOF |
| "Just works" | 7/10 — Needs Lua scripting |
| WebSocket | 9/10 — Works with config |
| TCP support | 9/10 — Stream module |
| Maintenance | 4/10 — Complex |
| Cost | 7/10 — Box cost |
| Vendor lock-in | 9/10 — Open source |

---

### Option 5: Hybrid — CF Worker + Dedicated Proxy for TCP

**What:** Keep CF Worker for HTTP/WS (it works), add a dedicated proxy for TCP-only traffic.

```
HTTP/WS traffic:
  *.kortix.cloud → CF CDN → CF Worker → VPS_IP:port     (existing)

TCP traffic (SSH, DB, etc.):
  tcp.kortix.cloud:PORT → Proxy VPS → VPS_IP:PORT        (new)
  OR: VPS_IP directly (open Hetzner FW for user ports)
```

**This is the pragmatic middle ground.** Don't throw away working code. Add TCP capability where needed.

---

### Option 6: frp (Fast Reverse Proxy) / rathole / bore

**What:** Tunnel-based approach. Agent on each VPS connects outbound to a central relay server.

```
VPS Agent → outbound connection → Relay Server ← Client connects
```

**Tools:**
- **frp** (Go, 85k GitHub stars) — most popular, mature
- **rathole** (Rust, 10k stars) — faster, lighter, newer
- **bore** (Rust, 8k stars) — simplest, minimal config

**Pros:**
- ✅ No inbound ports needed on VPS (agent connects outbound)
- ✅ Works behind NAT/firewalls
- ✅ TCP/UDP/HTTP all supported
- ✅ Single relay server, wildcard DNS

**Cons:**
- ❌ Same SPOF on relay server
- ❌ Extra agent process on every VPS
- ❌ Latency: VPS↔Relay↔Client (double hop)
- ❌ You already have direct IP access — tunneling adds unnecessary complexity
- ❌ Auth is basic (token-based, not user-scoped)

**Verdict: NOT recommended.** You already killed CF Tunnels for good reason. Your VPS machines have public IPs. Tunneling is for when you DON'T have a public IP. Adding another tunnel layer is going backwards.

---

### Option 7: Pangolin / Gerbil (Self-Hosted Tunnel Platform)

**What:** Pangolin is a self-hosted alternative to Cloudflare Tunnels. Gerbil is its WireGuard-based agent.

**Same tunnel anti-pattern as Option 6.** Your VPSes have public IPs. Don't tunnel.

**Verdict: NOT recommended** for same reasons as Option 6.

---

## Recommendation Matrix

| Option | Reliability | Just Works | WS | TCP | Maintenance | Cost | Score |
|--------|:-----------:|:----------:|:--:|:---:|:-----------:|:----:|:-----:|
| **1. CF Worker (current)** | 8 | 7 | 8 | 2 | 9 | 9 | **43** |
| **2. Traefik** | 6 | 9 | 10 | 8 | 5 | 7 | **45** |
| **3. Caddy** | 6 | 9 | 10 | 3 | 6 | 7 | **41** |
| **4. Nginx+Lua** | 6 | 7 | 9 | 9 | 4 | 7 | **42** |
| **5. Hybrid (CF + TCP proxy)** | 8 | 8 | 8 | 7 | 7 | 8 | **46** |
| **6. frp/rathole** | 5 | 6 | 7 | 8 | 5 | 7 | **38** |
| **7. Pangolin** | 5 | 6 | 7 | 7 | 5 | 7 | **37** |

---

## 🏆 Recommended Architecture: Enhanced CF Worker (Option 1+)

**Why:** You already have 90% of what you need. The CF Worker is the right architecture for a VPS platform where every machine has a public IP. Don't throw it away and rebuild. Fix the gaps.

### The 3 Problems to Solve

#### Problem 1: DNS Propagation Delay (New machines take 30-60s to be reachable)

**Root cause:** Creating 3 DNS records per machine via CF API, then waiting for global propagation.

**Fix: Eliminate per-machine DNS records entirely.**

Instead of:
```
slug.kortix.cloud       → A → VPS_IP (proxied)     ← created per machine
*.slug.kortix.cloud     → A → VPS_IP (proxied)     ← created per machine
origin-slug.kortix.cloud → A → VPS_IP (DNS-only)   ← created per machine
```

Use:
```
*.kortix.cloud          → A → DUMMY_IP (proxied)   ← ONE record, set once
```

**How:** CF Worker route `*.kortix.cloud/*` already catches everything. The DNS record just needs to EXIST so CF serves the route. Point it at any IP (or a dummy origin). The Worker ignores the DNS-resolved IP — it looks up the real VPS IP from KV and fetches `http://VPS_IP:port` directly.

**Wait — CF Workers can't fetch raw IPs on CF's network (Error 1003).**

That's why you have `origin-{slug}` records. But there's a better way:

**Use `cf-resolve-override` or fetch the IP directly:**
- CF Workers CAN fetch raw IPs that are NOT on CF's network
- Your VPS IPs are on Hetzner, not CF
- The error 1003 only happens when fetching a CF-proxied hostname
- Solution: Fetch `http://${VPS_IP}:${port}${path}` directly — **no DNS needed**

**Test this.** If `fetch("http://1.2.3.4:80/")` works from a CF Worker to a Hetzner IP, you can eliminate ALL per-machine DNS records.

If it doesn't work (some CF plans restrict IP fetches), keep the origin records but make them dynamic:
- Add a single wildcard: `*.origin.kortix.cloud → DUMMY_IP (DNS-only)`
- Worker fetches `http://origin.kortix.cloud` with a `Host` header override
- Or use Cloudflare's `resolve_override` in fetch options

**Result:** Zero DNS records per machine. Instant availability. Machine is reachable the moment KV is written.

#### Problem 2: KV Eventual Consistency (New machine not found for ~60s)

**Root cause:** CF KV writes propagate globally in ~60s. Worker in a different PoP may not see the new entry yet.

**Fixes (pick any/all):**
1. **Write KV from Worker, not API:** Use `kv.put()` inside the Worker (or via Worker-to-Worker call). This writes to the nearest PoP first, so the user who just created the machine (same PoP) sees it immediately.
2. **Fallback to API:** If KV miss, Worker calls your platform API (`GET /api/v1/internal/machine/{slug}`) as fallback. Cache the result in KV. Adds ~100ms on first request, but machine is reachable instantly.
3. **Use Durable Objects:** For real-time consistency, use a CF Durable Object per machine. Instant reads/writes, no eventual consistency. Costs more ($0.15/M requests).

**Recommended: Option 2 (API fallback).** Simplest, most reliable. KV is the fast path, API is the safety net.

#### Problem 3: No TCP Passthrough

**Fix: Don't proxy TCP. Open the firewall.**

Your VPSes have public IPs. For TCP services (Postgres, Redis, custom daemons), users should connect directly:

```
ssh user@VPS_IP               ← already works (port 22 open)
psql -h VPS_IP -p 5432        ← open in Hetzner FW
redis-cli -h VPS_IP -p 6379   ← open in Hetzner FW
```

**Implementation:**
- Hetzner Firewall: Allow ports 1024-65535 from ANY (not just CF IPs) for TCP
- Keep port 80 restricted to CF IPs (HTTP proxy still goes through Worker)
- Dashboard: Let users manage which ports are open (Hetzner FW API supports per-rule management)

**OR if you want TCP through the subdomain:**
- Use Cloudflare Spectrum ($1/GB, Enterprise feature) — expensive
- Use a dedicated TCP relay (HAProxy on a proxy box) — adds SPOF
- Use Traefik TCP router on a proxy box — adds SPOF

**Recommendation:** Direct IP for TCP. It's simpler, faster, and your VPSes already have public IPs. That's the whole point of VPS vs containers.

---

## Implementation Plan: "Deploy & It Just Works"

### Phase 1: Eliminate Per-Machine DNS (Instant Availability)

**Goal:** New machine reachable within 2 seconds of provisioning (KV write time), not 60s.

1. **Test direct IP fetch from CF Worker**
   ```ts
   // In Worker: can we fetch a raw Hetzner IP?
   const res = await fetch(`http://${machineInfo.ip}:${port}${path}`, { headers });
   ```
   If this works → delete all per-machine DNS code.

2. **Add single wildcard DNS record** (one-time setup)
   ```
   *.kortix.cloud → A → 127.0.0.1 (proxied, orange-cloud)
   ```
   This ensures CF's Worker route matches all subdomains. The IP doesn't matter — Worker handles routing.

3. **Update `cloudflare.ts`**
   - `addMachineDNS()` → no-op (or just write KV)
   - `removeMachineDNS()` → no-op (or just delete KV)
   - Keep KV write/delete

4. **Update Worker `proxy.ts`**
   - Remove `origin_hostname` logic
   - Fetch `http://${machineInfo.ip}:${port}${path}` directly

### Phase 2: KV Fallback (Zero Misses)

1. **Add API fallback in Worker auth**
   ```ts
   // In checkMachineAccess():
   let raw = await kv.get(`machine:${slug}`);
   if (!raw) {
     // KV miss — fallback to platform API
     const res = await fetch(`${PLATFORM_URL}/api/v1/internal/machine/${slug}`, {
       headers: { 'Authorization': `Bearer ${INTERNAL_SECRET}` }
     });
     if (res.ok) {
       const data = await res.json();
       // Write to KV for future requests
       await kv.put(`machine:${slug}`, JSON.stringify(data), { expirationTtl: 3600 });
       raw = JSON.stringify(data);
     }
   }
   ```

2. **Add internal API endpoint** (if not exists)
   - `GET /api/v1/internal/machine/{slug}` — returns machine info (IP, owner, status)
   - Authed via internal secret, not user auth

### Phase 3: Reliability Hardening

1. **Health-check aware routing**
   - Worker caches last-known health status in KV (updated by daemon heartbeat)
   - If VPS unreachable, return a branded error page (not CF's 502)

2. **Custom error pages**
   - Worker catches fetch errors → returns branded HTML/JSON
   - Different pages for: machine not found, machine offline, auth required

3. **Monitoring**
   - Worker analytics (CF dashboard) for request volume, error rates
   - Alert on elevated 502/504 rates
   - Daemon heartbeat monitoring (already exists)

### Phase 4: TCP Access (Optional)

1. **Open Hetzner Firewall** for user ports from any source (not just CF IPs)
2. **Dashboard UI** for users to see their VPS IP + open ports
3. **Connection string generator** (SSH, DB, etc.) in dashboard

---

## Architecture After Improvements

```
HTTP/WebSocket/SSE:
  *.kortix.cloud (single wildcard A)
       │
       ▼
  CF CDN (TLS, DDoS, cache)
       │
       ▼
  CF Worker (auth + ownership check via KV → API fallback)
       │
       ▼
  fetch(http://VPS_IP:port)  ← direct IP, no DNS hop
       │
       ▼
  VPS Caddy (:80) → services

TCP (SSH, DB, custom):
  VPS_IP:port ← direct connection (Hetzner FW allows)
```

**DNS records needed (total, for the entire platform):**
```
*.kortix.cloud    → A → 127.0.0.1 (proxied)   ← ONE record, set once forever
kortix.cloud      → varies (platform)           ← existing
```

**Per-machine DNS records: ZERO.**

**Time to reachability: ~2 seconds** (time to write KV after Hetzner returns IP).

---

## Cost Comparison

| Component | Current | After |
|-----------|---------|-------|
| CF Workers Paid | $5/mo | $5/mo |
| CF KV | Included | Included |
| CF DNS records | 3N (3 per machine) | 1 total |
| Proxy server | $0 | $0 |
| Bandwidth | $0 (CF free egress) | $0 |
| Maintenance | Low | Lower |
| **Total** | **$5/mo** | **$5/mo** |

---

## TL;DR

1. **Your CF Worker proxy is the right architecture.** Don't replace it.
2. **Kill per-machine DNS records.** Use one wildcard + direct IP fetch from Worker.
3. **Add KV→API fallback.** Eliminates the 60s consistency gap.
4. **Open Hetzner FW for TCP.** Direct IP for non-HTTP protocols.
5. **Total effort: ~1-2 days.** Most of the code already exists.
6. **Result: Machine reachable in <5s after provision, every port, HTTP+WS+TCP, zero DNS management, $5/mo.**
