# Plan: Kill Cloudflare Tunnels → Direct IP Proxy + Full Auth

> Status: DRAFT — Awaiting approval
> Author: Kortix
> Date: 2026-03-18

---

## Goal

Replace Cloudflare Tunnels with **direct IP proxying** through the CF Worker, and consolidate the auth layer into a single, clean system. The result:

```
https://lt957ucx.kortix.cloud/           → VPS default (code-server)
https://3000.lt957ucx.kortix.cloud/      → VPS port 3000
https://lt957ucx.kortix.cloud:443        → same as above (CF only supports 443 for proxied)
```

Auth on every request: API key (`Authorization: Bearer sk_live_...`) OR session JWT cookie.

---

## Current Architecture (What We're Killing)

```
Browser → CF CDN → CF Worker (auth) → CF Tunnel → cloudflared on VPS → daemon:7777 → code-server:8080
```

**Components involved in tunnel path:**
1. `cloudflare.ts` — Manages per-machine tunnel ingress rules + CNAME DNS records
2. `cloud-init.ts` — Installs `cloudflared`, runs `cloudflared service install <token>`
3. `config.ts` — Has `CLOUDFLARE_TUNNEL_ID` + `CLOUDFLARE_TUNNEL_TOKEN`
4. `machine-lifecycle.ts` — Calls `addMachineToTunnel()` on provision, `removeMachineFromTunnel()` on delete
5. `.env` — Stores tunnel ID + token
6. `daemon/` — Go binary that listens on :7777, receives tunnel traffic, checks JWT, proxies to code-server:8080
7. `workers/proxy/` — CF Worker that auth-checks then passes through to tunnel via subrequest

**What's broken/bad today:**
- Tunnel ingress API is non-atomic (get → modify → put) — can race with concurrent provisions
- DNS CNAME propagation is unreliable — `cloudflare.ts` has a 3-retry verification loop with `dig`
- `cloudflared` is an extra process on every VPS
- Port proxying (`3000.slug.kortix.cloud`) doesn't actually work — tunnel ingress maps all traffic to `localhost:7777` (daemon), and the daemon only proxies to code-server:8080
- Two separate auth layers: CF Worker verifies JWT/API key, daemon ALSO verifies JWT — redundant
- Login flow is split: daemon has its own login page (`login.go`), platform has `/api/proxy-auth`

---

## New Architecture

```
Browser → CF CDN → CF Worker (auth + proxy) → VPS_IP:port
```

**That's it.** Three hops. The CF Worker does auth AND proxying. The VPS just listens.

### Traffic Flow

```
1. Request hits *.kortix.cloud
2. CF Worker intercepts (Worker Route: *.kortix.cloud/*)
3. Worker parses hostname → slug + port
4. Worker checks auth (API key OR JWT cookie)
5. Worker checks ownership (KV: machine:{slug} → {owner_id, ip})
6. Worker fetches http://VPS_IP:port directly
7. Response flows back through CF to client
```

### Port Proxying

```
slug.kortix.cloud         → Worker → http://VPS_IP:80 (Caddy → code-server)
3000.slug.kortix.cloud    → Worker → http://VPS_IP:3000 (user's app directly)
8000.slug.kortix.cloud    → Worker → http://VPS_IP:8000 (user's API directly)
```

The Worker parses port from hostname (already implemented in `hostname.ts`). Default port = 80 (Caddy).

### What Opens on the VPS

**Hetzner Firewall (external, tamper-proof):**
```
ALLOW port 22      from 0.0.0.0/0           (SSH)
ALLOW port 80      from CF IPv4 ranges       (Caddy — default proxy target)
ALLOW port 1-65535 from CF IPv4 ranges       (any port the user runs services on)
DENY  everything else
```

**Simplification:** Since all traffic from CF IPs is already authenticated by the Worker, we can allow all ports from CF IPs. The Hetzner Firewall blocks everything from non-CF IPs. This is equivalent security to the tunnel — nothing reaches the VPS without going through our auth layer.

**Alternative (tighter):** Allow only port 80 + a defined range (e.g. 3000-9999) from CF IPs. This means users can only expose services on those ports.

### Why This Is Equally Secure

| Threat | Tunnel approach | Direct IP approach |
|---|---|---|
| Random internet scanner | Sees only port 22 | Sees port 22. Ports 80+ respond but only to CF IPs — scanner gets connection refused |
| Someone hits VPS_IP:3000 directly | Connection refused (no inbound port) | Connection refused (Hetzner FW blocks non-CF IPs) |
| Unauthenticated request via CF | Worker rejects (401) | Worker rejects (401) — identical |
| CF IP spoofing | Not possible (TCP, not UDP) | Not possible (TCP, not UDP) — identical |

The effective security is identical. The "zero open ports" of tunnels is cosmetic — with Hetzner FW allowing only CF IPs, the result is the same.

---

## Auth Architecture (Consolidated)

### The Problem Today

There are **three** auth implementations:
1. **CF Worker** (`workers/proxy/src/auth.ts`) — JWT cookie + API key (SHA-256 in KV) + machine ownership check
2. **Daemon** (`daemon/auth.go`) — JWT cookie verification + local login page (`login.go`)
3. **Platform API** (`src/server/lib/api-guard.ts`) — API key (bcrypt in DB) + NextAuth session cookie

This is redundant and confusing. The daemon auth exists ONLY because the tunnel architecture meant traffic hit the daemon before the Worker. With direct IP proxying, the Worker is the ONLY entry point — the daemon doesn't need auth.

### New Auth: Single Layer at CF Worker

**Auth methods (checked in order):**

1. **`Authorization: Bearer sk_live_xxx`** (API key)
   - Worker computes SHA-256 of the key
   - Looks up `apikey:{hash}` in CF KV → gets `{ owner_id }`
   - Checks `machine:{slug}` in KV → verifies `owner_id` matches
   - ✅ Proxy through

2. **`__justavps_proxy` cookie** (JWT, HS256)
   - Worker verifies JWT signature using `PROXY_AUTH_SECRET`
   - JWT payload: `{ sub: userId, iat, exp }`
   - Checks `machine:{slug}` in KV → verifies `owner_id` matches JWT `sub`
   - ✅ Proxy through

3. **`?token=xxx` query param** (JWT — for WebSocket/SSE where headers aren't settable)
   - Same verification as cookie
   - ✅ Proxy through

4. **No auth:**
   - Browser (Accept: text/html) → **302 redirect** to `https://justavps.com/api/proxy-auth?redirect=<original_url>`
   - API (everything else) → **401 JSON** `{ error: "Authentication required" }`

### Cookie Issuance Flow (Browser Users)

```
1. User visits https://abc123.kortix.cloud
2. CF Worker: no cookie, no API key → redirect to https://justavps.com/api/proxy-auth?redirect=https://abc123.kortix.cloud
3. Platform: validates NextAuth session (user is logged in to justavps.com)
   - If not logged in → redirect to /login?callbackUrl=/api/proxy-auth?redirect=...
   - If logged in → sign JWT { sub: userId } with PROXY_AUTH_SECRET
4. Platform sets cookie: __justavps_proxy=<jwt>; Domain=.kortix.cloud; HttpOnly; Secure; SameSite=Lax
5. Platform redirects back to https://abc123.kortix.cloud
6. CF Worker: cookie present → verify → check ownership → proxy through
```

This flow already exists and works (`/api/proxy-auth/route.ts`). No changes needed.

### What Gets Removed from Auth

- **Daemon auth** (`daemon/auth.go`, `daemon/login.go`) — DELETE entirely. Daemon no longer receives external traffic.
- **Daemon proxy** (`daemon/proxy.go`) — DELETE. No longer reverse-proxying code-server.
- **CF Worker subrequest loop** (`X-JustAVPS-Authed` header trick) — DELETE. Worker fetches VPS IP directly now.

### KV Data Model (Unchanged)

```
machine:{slug}    → { owner_id, ip, status, server_type }
apikey:{sha256}   → { owner_id, name }
```

Written by the platform on machine provision / API key creation. Read by the Worker on every request.

---

## Daemon Simplification

### Current Daemon (Overloaded)

The daemon does 5 things:
1. Auth gateway (JWT check) — **REMOVE** (Worker handles this)
2. Reverse proxy to code-server — **REMOVE** (Worker proxies directly)
3. Login page — **REMOVE** (Platform handles this)
4. Health monitoring + heartbeat — **KEEP**
5. API (/health, /services, /info, /services/{name}/restart) — **KEEP**

### New Daemon

```go
// daemon listens on :7777 (internal only — Hetzner FW blocks external access)
// Responsibilities:
//   1. Heartbeat: POST to platform every 30s with health data
//   2. Local API: /health, /services, /info, /services/{name}/restart
//
// NO auth, NO proxying, NO login page.
// Port 7777 is only accessible from platform IPs (Hetzner Firewall).
```

**Files to modify:**
- `daemon/main.go` — Remove auth proxy handler, simplify to just API routes + heartbeat
- `daemon/proxy.go` — DELETE entirely
- `daemon/auth.go` — DELETE entirely
- `daemon/login.go` — DELETE entirely
- `daemon/config.go` — Remove `ProxyAuthSecret` and `ProxyDomain` fields

### Hetzner Firewall for Daemon

Port 7777 stays restricted to platform IPs only (API server / monitoring). Not from CF IPs — the Worker never needs to hit the daemon directly.

```
ALLOW port 7777   from [platform_server_ips]    (daemon API + heartbeat polling)
```

---

## File-by-File Change List

### DELETE

| File | Reason |
|---|---|
| `daemon/proxy.go` | No longer proxying traffic |
| `daemon/auth.go` | Auth handled by CF Worker |
| `daemon/login.go` | Login handled by platform |

### MODIFY — Platform (`src/server/lib/`)

| File | Changes |
|---|---|
| `cloudflare.ts` | Gut tunnel code. Replace `addMachineToTunnel()` with `addMachineDNS()` (creates A record, not CNAME). Replace `removeMachineFromTunnel()` with `removeMachineDNS()`. Remove all tunnel ingress functions. Keep KV functions. |
| `cloud-init.ts` | Remove `cloudflared` install. Remove `cloudflared service install`. Remove `tunnelToken` param. Change firewall rules to allow CF IPs on port 80 + port range. Remove `proxy_auth_secret` from config.json (daemon doesn't need it). |
| `config.ts` | Remove `CLOUDFLARE_TUNNEL_ID` and `CLOUDFLARE_TUNNEL_TOKEN`. |
| `machine-lifecycle.ts` | Rename `setupProxyKV` → `setupProxyDNS` (better name). Remove `tunnelToken` from `buildMachineUserData()`. The function now: 1) creates A record, 2) writes KV. No tunnel. |

### MODIFY — CF Worker (`workers/proxy/`)

| File | Changes |
|---|---|
| `index.ts` | Remove `X-JustAVPS-Authed` subrequest hack. After auth passes, call `proxyHTTPRequest()` or `proxyWebSocket()` directly using VPS IP from KV. |
| `proxy.ts` | Remove `origin.slug.kortix.cloud` hostname trick. Use raw IP fetch: `fetch("http://VPS_IP:port/path")`. CF Workers CAN fetch raw IPs — no hostname needed. |
| `auth.ts` | Unchanged — already correct. |
| `hostname.ts` | Unchanged — already correct. |

### MODIFY — Daemon (`daemon/`)

| File | Changes |
|---|---|
| `main.go` | Remove auth proxy setup. Simplify to: API routes on mux + heartbeat goroutine. Listen on :7777. No more proxying. |
| `config.go` | Remove `ProxyAuthSecret` and `ProxyDomain` fields. |
| `api.go` | Unchanged. |
| `health.go` | Unchanged. |
| `heartbeat.go` | Unchanged. |

### MODIFY — Config

| File | Changes |
|---|---|
| `.env.example` | Remove `CLOUDFLARE_TUNNEL_ID`, `CLOUDFLARE_TUNNEL_TOKEN`. Add comment about CF IPs in Hetzner FW. |
| `.env` | Same removals. |

### MODIFY — Tests

| File | Changes |
|---|---|
| `workers/proxy/test/index.test.ts` | Update to test direct IP proxying instead of subrequest pass-through |
| `workers/proxy/test/proxy.test.ts` | Update to test raw IP fetch |
| `src/__tests__/lib/cloudflare.test.ts` | Update to test A record creation instead of tunnel ingress |
| `daemon/daemon_test.go` | Update to reflect simplified daemon (no proxy, no auth) |

---

## Cloudflare DNS Setup (One-Time)

### Wildcard A Record (Already Needed)

For `port.slug.kortix.cloud` to work, we need a **wildcard DNS record** at the Cloudflare zone level:

```
*.kortix.cloud → any IP (proxied, orange-cloud)
```

BUT — Cloudflare wildcard DNS only matches **one level**. So:
- `*.kortix.cloud` matches `abc123.kortix.cloud` ✅
- `*.kortix.cloud` does NOT match `3000.abc123.kortix.cloud` ❌

For two-level subdomains, we need **per-machine wildcard records**:

```
abc123.kortix.cloud       → A record → VPS_IP (proxied)
*.abc123.kortix.cloud     → A record → VPS_IP (proxied)
```

Both created at provision time. The Worker Route `*.kortix.cloud/*` catches all.

**Wait — Worker Routes and wildcards:**
- Route `*.kortix.cloud/*` matches `abc123.kortix.cloud` ✅
- Route `*.kortix.cloud/*` does NOT match `3000.abc123.kortix.cloud` ❌ (two levels deep)

We need an additional Worker Route: `*.*.kortix.cloud/*` OR use a Custom Domain on the Worker.

**Solution:** Use **Cloudflare for SaaS (SSL for SaaS)** which gives us coverage for `*.kortix.cloud` + `*.*.kortix.cloud`. Or simpler: add two Worker Routes:
1. `*.kortix.cloud/*`
2. `*.*.kortix.cloud/*`

This is a one-time Cloudflare dashboard config.

### Per-Machine DNS (On Provision)

```typescript
// cloudflare.ts — addMachineDNS()
async addMachineDNS(slug: string, ip: string): Promise<void> {
  const hostname = `${slug}.${domain}`;    // abc123.kortix.cloud
  const wildcard = `*.${hostname}`;        // *.abc123.kortix.cloud

  // Delete any stale records
  await deleteAllDNSRecords(zid, hostname);
  await deleteAllDNSRecords(zid, wildcard);
  
  // Create A record: abc123.kortix.cloud → VPS_IP (proxied)
  await cfFetch(`/zones/${zid}/dns_records`, {
    method: 'POST',
    body: { type: 'A', name: hostname, content: ip, proxied: true, ttl: 1 },
  });

  // Create wildcard A: *.abc123.kortix.cloud → VPS_IP (proxied)
  await cfFetch(`/zones/${zid}/dns_records`, {
    method: 'POST',
    body: { type: 'A', name: wildcard, content: ip, proxied: true, ttl: 1 },
  });
}
```

**Note:** Cloudflare **proxied wildcard A records require an Enterprise plan or Advanced Certificate Manager** ($10/month) for SSL coverage on `*.*.kortix.cloud`. On free/pro plans, `*.abc123.kortix.cloud` won't get a certificate.

**Alternative if not on Enterprise:** Don't use two-level subdomains for ports. Instead:
- `abc123.kortix.cloud/` → code-server (default)
- `abc123.kortix.cloud/_port/3000/` → rewrite to port 3000

This is path-based rather than subdomain-based. Less elegant but works on any CF plan.

**OR** use **Cloudflare for SaaS** (previously SSL for SaaS) which enables wildcard coverage at all levels for $0.10/hostname/month. At scale this is pennies.

### Recommendation

Check your current CF plan. If Enterprise or you have Advanced Certificate Manager → subdomain port routing works. Otherwise → path-based fallback or add ACM ($10/mo).

---

## CF Worker Changes (Detailed)

### `index.ts` — New Flow

```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const parsed = parseHostname(url.hostname, url.pathname);
    if (!parsed) return errorResponse(400, 'Invalid hostname');

    // CORS preflight — no auth
    if (request.method === 'OPTIONS') {
      const cors = handleCORSPreflight(request);
      if (cors) return cors;
    }

    // Authenticate
    const authResult = await validateAuth(request, parsed.slug, env.KV, env.PROXY_AUTH_SECRET);
    if (!authResult.success) {
      return isBrowserRequest(request) && request.method === 'GET'
        ? createLoginRedirect(request, env.PLATFORM_URL)
        : createUnauthorizedResponse(authResult.error || 'Authentication required');
    }

    // Proxy to VPS
    const { machineInfo } = authResult;
    if (isWebSocketUpgrade(request)) {
      return proxyWebSocket(request, machineInfo!, parsed.port);
    }
    return proxyHTTPRequest(request, machineInfo!, parsed.port);
  },
};
```

No subrequest loop. No `X-JustAVPS-Authed`. Direct proxy.

### `proxy.ts` — Direct IP Fetch

```typescript
export async function proxyHTTPRequest(
  request: Request,
  machineInfo: MachineInfo,
  port: number,
): Promise<Response> {
  const url = new URL(request.url);
  
  // Direct IP fetch — CF Workers can fetch raw IPs
  const targetUrl = `http://${machineInfo.ip}:${port}${url.pathname}${url.search}`;
  
  const headers = new Headers(request.headers);
  // Set Host to original hostname so apps can use it
  headers.set('X-Forwarded-Host', url.hostname);
  headers.set('X-Forwarded-Proto', 'https');
  headers.set('X-Real-IP', request.headers.get('CF-Connecting-IP') || '');
  
  const response = await fetch(targetUrl, {
    method: request.method,
    headers: stripHopByHopHeaders(headers),
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
    redirect: 'manual',
  });

  const responseHeaders = new Headers(response.headers);
  addCORSHeaders(responseHeaders, request);
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
```

**Important:** Cloudflare Workers can fetch raw IPs (`http://1.2.3.4:80/path`). No hostname needed. No DNS tricks. No `origin.slug` subdomain. Just direct fetch.

---

## Hetzner Firewall (One-Time Setup)

Create a shared Hetzner Firewall applied to all JustAVPS machines:

```
Name: justavps-machines

Rules:
  # SSH — from anywhere (key-auth only on VPS)
  IN  TCP  22     0.0.0.0/0

  # HTTP from Cloudflare IPv4 ranges
  IN  TCP  80     173.245.48.0/20
  IN  TCP  80     103.21.244.0/22
  IN  TCP  80     103.22.200.0/22
  IN  TCP  80     103.31.4.0/22
  IN  TCP  80     141.101.64.0/18
  IN  TCP  80     108.162.192.0/18
  IN  TCP  80     190.93.240.0/20
  IN  TCP  80     188.114.96.0/20
  IN  TCP  80     197.234.240.0/22
  IN  TCP  80     198.41.128.0/17
  IN  TCP  80     162.158.0.0/15
  IN  TCP  80     104.16.0.0/13
  IN  TCP  80     104.24.0.0/14
  IN  TCP  80     172.64.0.0/13
  IN  TCP  80     131.0.72.0/22

  # All user ports from Cloudflare (1024-65535)
  IN  TCP  1024-65535  [same CF ranges as above]

  # Daemon (platform only)
  IN  TCP  7777   [platform_server_ip]/32

  # Default deny all other inbound
```

**Why allow 1024-65535 instead of specific ports:** Users run services on arbitrary ports. If we restrict to 3000-9999, someone running on port 12345 is blocked. Since ALL traffic from CF IPs is authenticated by the Worker, opening the full user port range is safe.

**Low ports (1-1023):** Only 22 (SSH) and 80 (Caddy) are needed. Don't open others.

### CF IP List Maintenance

Cloudflare publishes their IP ranges: https://www.cloudflare.com/ips/

These change rarely (a few times per year). Options:
1. **Manual:** Update Hetzner FW rules when CF publishes changes (simplest)
2. **Automated:** Cron job fetches `https://api.cloudflare.com/client/v4/ips` and updates Hetzner FW rules via API (better at scale)

For v1, manual is fine.

---

## VPS Caddy Config (Updated)

```
:80 {
    # code-server (default — web IDE)
    reverse_proxy localhost:8080

    # Sandbox Agent API
    handle_path /agent/* {
        reverse_proxy localhost:2468
    }

    # OpenCode Web UI
    handle_path /opencode/* {
        reverse_proxy localhost:3456
    }

    # Daemon local API (not exposed via proxy, but available locally)
    handle_path /daemon/* {
        reverse_proxy localhost:7777
    }
}
```

Caddy listens on `:80`. CF Worker hits VPS:80 for the default route (code-server). For port-specific subdomains like `3000.abc123.kortix.cloud`, the Worker hits VPS:3000 directly — bypasses Caddy entirely.

---

## VPS Firewall (ufw in cloud-init)

```bash
# Allow SSH
ufw allow 22/tcp

# Allow HTTP from Cloudflare IPs (port 80 = Caddy)
# CF IPs are enforced by Hetzner Firewall externally,
# but belt-and-suspenders locally too
ufw allow 80/tcp

# Allow all high ports (user services) — CF Worker handles auth
ufw allow 1024:65535/tcp

# Enable
ufw --force enable
```

The Hetzner Firewall is the real security boundary (external, user can't modify). `ufw` is defense-in-depth.

---

## Implementation Order

### Step 1: CF Worker — Direct IP Proxy (no tunnel dependency)

Change `workers/proxy/src/index.ts` + `proxy.ts` to:
1. Remove `X-JustAVPS-Authed` subrequest loop
2. After auth passes, read `machineInfo.ip` from KV
3. Fetch `http://VPS_IP:port/path` directly
4. Handle WebSocket proxy with raw IP

**Test:** Deploy Worker. Manually set a KV entry `machine:testslug → { ip: "1.2.3.4", owner_id: "..." }`. Verify proxy works.

**Acceptance:** Worker proxies HTTP + WebSocket to a VPS IP directly. No tunnel involved.

### Step 2: Cloudflare DNS — Switch from CNAME to A Record

Change `src/server/lib/cloudflare.ts`:
1. Remove ALL tunnel ingress functions (`getTunnelIngress`, `setTunnelIngress`)
2. Replace `addMachineToTunnel()` with `addMachineDNS(slug, ip)` — creates A record (+ wildcard A)
3. Replace `removeMachineFromTunnel()` with `removeMachineDNS(slug)` — deletes A record (+ wildcard)
4. Keep KV functions as-is

**Acceptance:** New machines get A records instead of CNAME to tunnel. DNS resolves.

### Step 3: Cloud-Init — Remove cloudflared

Change `src/server/lib/cloud-init.ts`:
1. Remove `cloudflared` apt install
2. Remove `cloudflared service install` block
3. Remove `tunnelToken` parameter
4. Update firewall rules (allow port 80 + user ports instead of SSH-only)
5. Remove `proxy_auth_secret` from config.json (daemon doesn't need it)

**Acceptance:** New machines boot without cloudflared. UFW allows CF IPs.

### Step 4: Daemon — Simplify

Delete `daemon/proxy.go`, `daemon/auth.go`, `daemon/login.go`.
Simplify `daemon/main.go` — just health API + heartbeat.
Update `daemon/config.go` — remove `ProxyAuthSecret`, `ProxyDomain`.

**Acceptance:** Daemon builds, runs, sends heartbeats. No auth, no proxy.

### Step 5: Config Cleanup

- Remove `CLOUDFLARE_TUNNEL_ID` and `CLOUDFLARE_TUNNEL_TOKEN` from `config.ts` and `.env.example`
- Update `machine-lifecycle.ts` to use new function names
- Remove `tunnelToken` from `buildMachineUserData()`

### Step 6: Hetzner Firewall

Create the shared Hetzner Firewall via API with CF IP ranges. Apply to all machines at provision time.

### Step 7: Worker Route for Two-Level Subdomains

Add `*.*.kortix.cloud/*` Worker Route in CF dashboard (or via API). Verify `3000.abc123.kortix.cloud` hits the Worker.

Verify SSL works on two-level subdomains (may need ACM or Cloudflare for SaaS).

### Step 8: Update Tests

Update all test files to reflect new architecture.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| CF Worker can't fetch raw IPs | Low (docs say it works) | High | Test immediately in step 1. Fallback: use `origin.slug` A record (grey cloud) |
| Two-level wildcard SSL | Medium (depends on CF plan) | Medium | Check plan first. Fallback: path-based port routing |
| Existing machines break during migration | High | High | Don't delete tunnel until all machines are reprovisioned or transitioned |
| Hetzner Firewall rules exceed limit | Low | Medium | Hetzner allows 50 rules per FW — CF has 15 IPv4 ranges = 30 rules (port 80 + port range) |
| CF IP ranges change | Low (rare) | Medium | Monitor https://www.cloudflare.com/ips/. Automate later |

## Migration Path for Existing Machines

Existing machines have `cloudflared` running. To migrate without downtime:

1. Deploy new Worker (direct IP proxy) — it reads IP from KV, works for both tunnel and direct
2. For each existing machine: create A record alongside CNAME. Worker will use IP from KV.
3. On next reboot/reprovision: new cloud-init without `cloudflared` kicks in
4. After all machines migrated: delete tunnel from CF account

Or simpler: just reprovision (destroy + create). JustAVPS machines are ephemeral by nature.

---

## Success Criteria

- [ ] `curl -H "Authorization: Bearer sk_live_xxx" https://abc123.kortix.cloud/` → 200 (code-server)
- [ ] `curl -H "Authorization: Bearer sk_live_xxx" https://3000.abc123.kortix.cloud/` → 200 (user app on port 3000)
- [ ] `curl https://abc123.kortix.cloud/` (no auth) → 302 redirect to login
- [ ] `curl -H "Authorization: Bearer sk_live_xxx" https://abc123.kortix.cloud/` → 401 for wrong user's machine
- [ ] WebSocket works through the proxy (code-server terminal)
- [ ] SSE works through the proxy (streaming)
- [ ] No `cloudflared` process on new machines
- [ ] Daemon runs, sends heartbeats, responds to /health
- [ ] Provision time is faster (no tunnel ingress setup, no `cloudflared` install)
- [ ] Port proxying actually works (it doesn't today with tunnels)
