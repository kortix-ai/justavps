# Proxy Auth — Plan

## Goal

Remove code-server's password auth. Replace with a single auth layer at the Cloudflare Worker that validates against our DB. One login → access to all ports/services on the machine. Persist auth state via cookie.

---

## Current State

```
Browser → slug.kortix.cloud (HTTPS via CF)
  → CF Worker (has auth code but NOT deployed/active)
  → VPS:8080 (code-server with its own password prompt) ← REDUNDANT
```

**Problems:**
1. Code-server has `auth: password` — user sees a password prompt after already being logged into JustAVPS
2. The CF Worker has auth logic but uses KV-based API key hashing (`sha256_of_${key}` — placeholder, not real crypto)
3. No login flow that issues a proxy auth cookie
4. Worker isn't deployed to Cloudflare

---

## Target State

```
Browser → slug.kortix.cloud
  → CF Worker checks cookie `__justavps_proxy`
  → Cookie valid + user owns machine → proxy to VPS (no further auth)
  → Cookie missing/invalid → redirect to justavps.com/machines/:id?auth=proxy
  → User is already logged into justavps.com (NextAuth session)
  → Platform issues a signed proxy token → sets `__justavps_proxy` cookie on *.kortix.cloud
  → Redirect back → Worker sees cookie → proxy through
  → code-server has auth: none (Worker handles all auth)
```

---

## Components

### 1. Proxy Auth Token (signed JWT)

**Issued by:** JustAVPS platform (Next.js API route)
**Consumed by:** CF Worker
**Format:** JWT signed with a shared secret (`PROXY_AUTH_SECRET` env var)

```json
{
  "sub": "user-uuid",
  "slug": "vupxgm5q",        // optional — if set, only valid for this machine
  "iat": 1710000000,
  "exp": 1710086400           // 24h expiry
}
```

**Why JWT and not session lookup:**
- Worker can validate locally without calling the platform API
- No KV read latency on every request
- Stateless — scales to any number of machines
- Short expiry (24h) limits exposure if token is leaked

### 2. Cookie: `__justavps_proxy`

**Domain:** `.kortix.cloud` (wildcard — works for all machine subdomains)
**Value:** The signed JWT
**Attributes:** `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`
**Set by:** Platform API route via redirect response

### 3. Auth Flow (step by step)

```
1. User visits https://vupxgm5q.kortix.cloud
2. CF Worker: no `__justavps_proxy` cookie → redirect to:
   https://justavps.com/api/proxy-auth?slug=vupxgm5q&redirect=https://vupxgm5q.kortix.cloud/
3. Platform API route `/api/proxy-auth`:
   a. Validate user is logged in (NextAuth session)
   b. Validate user owns machine with slug=vupxgm5q (DB query)
   c. If valid: sign JWT with { sub: userId, slug: vupxgm5q }
   d. Set cookie `__justavps_proxy` on domain `.kortix.cloud`
   e. Redirect back to the original URL
4. Browser follows redirect to https://vupxgm5q.kortix.cloud/
5. CF Worker: cookie present → verify JWT signature + expiry → check sub owns the machine → proxy through
6. VPS receives request with no auth barrier (code-server auth: none)
```

### 4. API Key Auth (for programmatic access)

Keep existing: `Authorization: Bearer sk_live_xxx` header bypasses cookie check.
Worker validates API key → hash → KV lookup → check ownership.

**Fix needed:** The current `hashApiKey` in the Worker is a placeholder (`sha256_of_${key}`). Must use real `crypto.subtle.digest('SHA-256', ...)` matching the platform's bcrypt or SHA-256 hashing.

Actually, bcrypt can't be verified in a Worker (no bcrypt in Workers runtime). Options:
- **Option A:** Store a SHA-256 hash of API keys in KV (alongside bcrypt in DB). Worker verifies against SHA-256.
- **Option B:** Worker calls platform API to validate API key (adds latency).
- **Option C:** API keys issue a short-lived JWT token via platform API, then use JWT for Worker auth.

**Recommendation:** Option A. When an API key is created, compute both bcrypt (for DB) and SHA-256 (for KV). Store SHA-256 in KV as `apikey:{sha256_hash} → { owner_id, name }`.

### 5. Token via Query Param (for iframe/embed)

Keep existing: `?token=xxx` query parameter. Same JWT format as the cookie.
Useful for embedding machine UIs in iframes where cookies may be blocked.

---

## Files to Change

### Platform (Next.js)

| File | Change |
|---|---|
| `src/app/api/proxy-auth/route.ts` | **NEW** — Issue proxy JWT, set cookie, redirect back |
| `src/server/lib/proxy-token.ts` | **NEW** — Sign/verify proxy JWTs using `PROXY_AUTH_SECRET` |
| `src/server/lib/config.ts` | Add `PROXY_AUTH_SECRET` env var |
| `src/server/lib/cloud-init.ts` | Change code-server to `auth: none` |
| `.env.example` | Add `PROXY_AUTH_SECRET` |

### CF Worker

| File | Change |
|---|---|
| `workers/proxy/src/auth.ts` | Rewrite: verify JWT cookie, verify API key (SHA-256), check machine ownership from JWT claims or KV |
| `workers/proxy/src/index.ts` | Update auth flow: cookie check → redirect to platform for login |
| `workers/proxy/wrangler.toml` | Add `PROXY_AUTH_SECRET` as a secret, configure KV namespace IDs |

### Machine (cloud-init)

| Change | Detail |
|---|---|
| code-server config | `auth: none` (no password, Worker handles auth) |
| Remove password generation | No more `codeServerPassword` in machine identity |

---

## Security Considerations

1. **JWT secret rotation:** If `PROXY_AUTH_SECRET` is compromised, all proxy tokens are invalid after rotation. Users just re-auth (redirect to login).

2. **Machine ownership check:** The JWT contains the user ID. The Worker checks that the user owns the machine (via KV `machine:{slug}.owner_id === jwt.sub`). Even if a user has a valid cookie, they can't access someone else's machine.

3. **Cookie scope:** `.kortix.cloud` wildcard means the cookie is sent to ALL machine subdomains. The Worker validates ownership per-slug, so having the cookie doesn't grant access to machines you don't own.

4. **No auth on VPS:** code-server runs with `auth: none`. This is safe because the Worker is the only entry point (Cloudflare proxied, VPS IP not directly accessible on port 8080 from the internet). The VPS firewall should block direct access to 8080 from non-Cloudflare IPs.

5. **API key in KV:** SHA-256 hash stored in KV. If KV is compromised, attacker gets hashes, not keys. SHA-256 is not reversible.

---

## Implementation Order

1. **`proxy-token.ts`** — JWT sign/verify utility
2. **`/api/proxy-auth` route** — Issue cookie, redirect
3. **Worker auth rewrite** — Verify JWT cookie, API key SHA-256
4. **Cloud-init** — code-server `auth: none`
5. **KV sync for API keys** — SHA-256 hash written on key creation
6. **Deploy Worker** — wrangler deploy
7. **VPS firewall** — Block direct 8080 access (Cloudflare IPs only)
8. **Test e2e**

---

## Open Questions

1. **Should the JWT be slug-scoped or user-scoped?**
   - Slug-scoped: one cookie per machine. More secure (leaked cookie only gives access to one machine). But user needs to re-auth for each machine.
   - User-scoped: one cookie for all machines. Better UX (login once, access all). Less isolated.
   - **Recommendation:** User-scoped. The cookie is on `.kortix.cloud` anyway. Worker checks ownership per-request from KV.

2. **Cookie expiry: 24h or longer?**
   - 24h is reasonable for security. User re-auths once a day.
   - Could extend to 7 days with a refresh mechanism.
   - **Recommendation:** 24h initially. Can extend later.

3. **What about WebSocket auth?**
   - WebSocket upgrade requests don't re-send cookies in all browsers.
   - The initial HTTP upgrade request DOES include cookies.
   - The Worker already handles WebSocket — it checks auth on the upgrade request.
   - **No issue.** Cookie is sent on the upgrade request.

4. **What about the terminal/PTY in the dashboard?**
   - The dashboard at justavps.com connects to `wss://slug.kortix.cloud/_pty`
   - This goes through the Worker → needs auth
   - The dashboard should include the proxy JWT as a query param or the cookie should be set
   - Since the user is logged into justavps.com, the `/api/proxy-auth` can set the `.kortix.cloud` cookie via a hidden iframe or redirect
   - **Simplest:** Dashboard calls `/api/proxy-auth?slug=xxx` before connecting to WebSocket. The API sets the cookie. Then WebSocket connection includes the cookie.
