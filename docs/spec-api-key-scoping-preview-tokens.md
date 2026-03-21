# Spec: API Key Scoping, Expiration & Proxy Tokens

**Status:** Draft  
**Date:** 2026-03-21  
**Authors:** Marko, Agent  

---

## Problem

API keys today are unscoped — every key has full account access with no expiration. There is no way to:

1. Restrict a key to specific machines
2. Grant only read or proxy access
3. Set a key to expire automatically
4. Share temporary proxy access to a machine with someone who doesn't have an account

We want two things:
- **Scoped API keys** — for infrastructure (CI/CD, Kortix, integrations). The caller IS a JustAVPS user.
- **Proxy tokens** — for sharing machine access. The caller is NOT a user. Proxy-only, short-lived, machine-scoped.

---

## Current State

### API Keys

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `owner_id` | uuid | FK → users |
| `name` | text | Human label |
| `key_prefix` | text | `sk_live_abcdef12...` (display only) |
| `key_hash` | text | bcrypt hash |
| `key_sha256` | text | SHA-256 hash (added by Saumya for O(1) lookups) |
| `last_used` | timestamp | |
| `created_at` | timestamp | |

- Format: `sk_live_<64-hex>`
- Auth: SHA-256 O(1) fast path, bcrypt O(n) fallback for old keys (auto-backfills)
- CF KV: `apikey:{sha256hex}` → `{ owner_id, name }`
- No scope, no permissions, no expiration

### Proxy Auth (CF Worker)

All machine traffic goes through the CF Worker:

```
Client → CF Worker (*.kortix.cloud) → auth → fetch(http://VPS_IP:80/_port/{port}/...) → response
```

Auth methods (checked in order):
1. `Authorization: Bearer sk_live_xxx` → SHA-256 KV lookup
2. `?token=<jwt>` query param → JWT verify
3. `__justavps_proxy` cookie → JWT verify

After auth: ownership check via KV `machine:{slug}` → `{ owner_id, ip, ... }`.

**No way to share access with non-owners today.**

### ⚠️ Saumya's proxy.ts — Deprecated, Scheduled for Deletion

Saumya merged `src/server/routes/v1/proxy.ts` which creates a second proxy path:

```
ALL /api/v1/machines/:machineId/proxy/:port/*
```

This proxies through the platform (justavps.com) directly to the machine IP, bypassing the CF Worker.

**This is architecturally wrong and marked `@deprecated`:**

1. **Bypasses the CF Worker** — all the security logic, CORS handling, WebSocket support, error pages, cookie refresh in the Worker is skipped
2. **Routes through the platform server** — every proxied byte goes through Vercel/Node instead of CF's edge network. Terrible for latency and bandwidth
3. **Duplicates auth logic** — does its own inline API key validation instead of using `apiGuard`, creating a maintenance surface that drifts from the canonical auth path
4. **The CF Worker already supports API keys** — `Authorization: Bearer sk_live_xxx` works at `{port}--{slug}.kortix.cloud`. There is no gap to fill.

**Current status:** Kept temporarily because Kortix Computer API (Saumya) has a dependency on it. Marked `@deprecated` in the file header with clear instructions on what to use instead.

**Migration path:** Kortix Computer should call `https://2468--{slug}.kortix.cloud` with the API key. If it only knows the machine UUID, use `GET /api/v1/machines/:id` to get the slug.

---

## Feature 1: API Key Scoping & Expiration

### Goal

Let users create API keys restricted to specific machines and/or specific permissions, with optional expiration.

### Schema Changes

Add columns to `api_keys`:

```sql
ALTER TABLE api_keys ADD COLUMN scope text NOT NULL DEFAULT 'account';
ALTER TABLE api_keys ADD COLUMN machine_ids uuid[] DEFAULT NULL;
ALTER TABLE api_keys ADD COLUMN permissions text[] NOT NULL DEFAULT ARRAY['*'];
ALTER TABLE api_keys ADD COLUMN expires_at timestamp DEFAULT NULL;
```

| Column | Type | Default | Notes |
|---|---|---|---|
| `scope` | text | `'account'` | `'account'` (full access) or `'machine'` (restricted) |
| `machine_ids` | uuid[] | NULL | Which machines. NULL = all (only valid for `scope='account'`) |
| `permissions` | text[] | `['*']` | What the key can do. `*` = everything |
| `expires_at` | timestamp | NULL | NULL = never expires |

### Permissions

| Permission | Allows |
|---|---|
| `*` | Everything (default, backwards-compatible) |
| `read` | GET endpoints: list/get machines, images, server-types, keys, webhooks, account |
| `write` | POST/PUT/PATCH: create/update machines, images, filesystem writes, SSH keys, webhooks |
| `delete` | DELETE: machines, images, keys, webhooks |
| `exec` | Process execution: exec, code-run, coding agents (sandbox-agent) |
| `proxy` | Access machine services through CF Worker proxy |

Verb-based rather than resource-scoped (Daytona's `write:sandboxes` style) because:
- Simpler to implement and enforce
- Our resource surface is small (machines, images, keys)
- Can split to resource-level later if needed

### API Changes

**POST /api/v1/api-keys** — updated request body:

```json
{
  "name": "CI Deploy Key",
  "scope": "machine",
  "machine_ids": ["uuid-1", "uuid-2"],
  "permissions": ["read", "write", "exec"],
  "expires_in_seconds": 2592000
}
```

All new fields are optional. Omitting them = current behavior (`scope=account`, `permissions=[*]`, no expiry).

**Response** adds `scope`, `machine_ids`, `permissions`, `expires_at`.

**GET /api/v1/api-keys** — response includes the new fields per key.

### Enforcement

| Location | Change |
|---|---|
| `api-guard.ts` | Reject expired keys (`expires_at < now`). Attach scope/permissions to Hono context. |
| `api-guard.ts` context | New vars: `apiKeyScope`, `apiKeyMachineIds`, `apiKeyPermissions` |
| Route-level | New `requirePermission('write')` middleware helper |
| `validate-key` internal route | Return `scope`, `machine_ids`, `permissions` so CF Worker can enforce |
| CF Worker `auth.ts` | Check `proxy` permission. For machine-scoped keys, verify slug's machine ID is in `machine_ids`. |
| `proxy-kv.ts` | Include new fields in KV value for edge enforcement |

### KV Value (updated)

```json
{
  "owner_id": "uuid",
  "name": "CI Key",
  "scope": "machine",
  "machine_ids": ["uuid-1", "uuid-2"],
  "permissions": ["read", "proxy"],
  "expires_at": "2026-04-20T00:00:00Z"
}
```

CF Worker checks `permissions.includes('proxy') || permissions.includes('*')` and validates `machine_ids` if scope is `machine`.

### UI Changes (Keys page)

Create dialog:
- **Scope** toggle: "Full account access" / "Specific machines"
- When "Specific machines" → machine multi-select dropdown (fetches user's machines)
- **Permissions** checklist: Read, Write, Delete, Execute, Proxy — or "Full access" toggle
- **Expiration** picker: Never / 30 days / 90 days / 1 year / Custom date

List view additions:
- Scope badge ("Account" / "3 machines")
- Permission badges (compact)
- Expiration: "Expires in 28 days" / "Expired" (red badge)
- Expired keys shown greyed out with option to delete

### Migration

- All existing keys get `scope='account'`, `permissions=['*']`, `expires_at=NULL`
- Defaults make this a zero-breaking-change migration
- `db:push` safe (all additive, all with defaults)

---

## Feature 2: Proxy Tokens

### Goal

Let users generate short-lived tokens that grant proxy access to a specific machine (and optionally specific ports). The recipient does NOT need a JustAVPS account. This is a **proxy-only access token**, not a full API key.

### Core Distinction

| | API Key (`sk_live_xxx`) | Proxy Token (`pt_xxx`) |
|---|---|---|
| **Who uses it** | JustAVPS user (you, your CI, your integrations) | Anyone you share the link with |
| **What it can do** | Full API access (scoped by permissions) | Proxy access only (reach services on the machine) |
| **Lifetime** | Long-lived or custom expiry | Always expires (default 1h, max 7 days) |
| **Scope** | Account-wide or machine-scoped | Always single-machine, optionally port-scoped |
| **Auth flow** | `Authorization: Bearer` header | `X-Proxy-Token` header or `?__proxy_token=` URL param |

### When Do You Need a Proxy Token?

| Scenario | Without | With proxy tokens |
|---|---|---|
| Share a running web app with a designer | Give them your account creds, or screenshot | Send them a link that works for 1 hour |
| Let a stakeholder see a staging deploy | Walk them through login, or screen-share | Send a `?__proxy_token=pt_xxx` link |
| CI health check on a specific port | Full API key with account access | Proxy token scoped to that port, 30 min |
| Embed a machine service in an iframe | JWT query param (requires account) | Proxy token (no account needed) |
| Temporary access for a contractor | Create user account + API key, remember to revoke | Proxy token with 7-day expiry, auto-revokes |

### Token Format

`pt_<64-char-hex>` — distinct prefix from `sk_live_` so the CF Worker can distinguish immediately.

### Schema

```sql
CREATE TABLE proxy_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES users(id),
  machine_id   uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  token_hash   text NOT NULL,
  token_sha256  text NOT NULL,
  token_prefix text NOT NULL,
  label        text,
  ports        integer[] DEFAULT NULL,
  expires_at   timestamp NOT NULL,
  revoked_at   timestamp,
  created_at   timestamp NOT NULL DEFAULT now()
);
```

| Column | Notes |
|---|---|
| `machine_id` | Always single-machine scoped. Cascade delete when machine is deleted. |
| `token_sha256` | SHA-256 for O(1) lookups (same pattern as API keys) |
| `ports` | NULL = all ports. `[3000, 8080]` = only those ports. |
| `expires_at` | Always set. Default 1 hour, max 7 days. |
| `revoked_at` | NULL = active. Set = manually revoked before expiry. |

No `permissions` column — proxy tokens are always proxy-only by definition.

### API Routes

**POST /api/v1/proxy-tokens** — Create

```json
{
  "machine_id": "uuid",
  "label": "Share with designer",
  "ports": [3000, 8080],
  "expires_in_seconds": 3600
}
```

Response:

```json
{
  "id": "uuid",
  "token": "pt_<64hex>",
  "token_prefix": "pt_abc1...",
  "label": "Share with designer",
  "machine_id": "uuid",
  "machine_slug": "my-box",
  "ports": [3000, 8080],
  "expires_at": "2026-03-21T10:00:00Z",
  "proxy_url": "https://3000--my-box.kortix.cloud?__proxy_token=pt_<64hex>",
  "created_at": "..."
}
```

The `token` and `proxy_url` are only shown once.

**GET /api/v1/proxy-tokens** — List active tokens  
**GET /api/v1/proxy-tokens?machine_id=uuid** — Filter by machine  
**DELETE /api/v1/proxy-tokens/:id** — Revoke (sets `revoked_at`, deletes from KV)

### Authentication Flow

Two modes:

**1. Header mode** — programmatic access

```
GET https://3000--my-box.kortix.cloud/some-page
X-Proxy-Token: pt_xxx
```

Good for: curl, CI pipelines, programmatic access.

**2. URL mode** — shareable links

```
GET https://3000--my-box.kortix.cloud?__proxy_token=pt_xxx
```

Good for: sharing with humans who open it in a browser.

When the CF Worker sees `?__proxy_token=pt_xxx`:
1. Validate the token (SHA-256 → KV lookup)
2. Check: not expired, not revoked, machine slug matches, port allowed
3. Strip `__proxy_token` from the URL
4. Set a short-lived cookie `__justavps_pt` scoped to the machine subdomain (TTL = remaining token life, capped at 4h)
5. Redirect to the clean URL

Subsequent requests use the cookie — no `?__proxy_token=` needed on every page navigation.

### CF Worker Changes

`auth.ts` — `extractAuth()` updated priority order:

```
1. X-Proxy-Token header        → type: 'proxy_token'
2. ?__proxy_token= query param → type: 'proxy_token'
3. __justavps_pt cookie        → type: 'proxy_token'
4. Authorization: Bearer       → type: 'apikey' or 'jwt'
5. ?token= query param         → type: 'jwt'
6. __justavps_proxy cookie     → type: 'jwt'
```

For proxy tokens: **no ownership check** — the token IS the authorization. We verify:
- Token exists in KV and is not expired
- Machine slug matches the KV entry's machine
- Requested port is allowed (if `ports` is set)

Everything goes through the CF Worker. No platform-level proxy needed.

### KV Sync

On create:

```
KV key:   pt:{sha256(pt_xxx)}
KV value: { owner_id, machine_id, machine_slug, ports, expires_at }
KV TTL:   expires_in_seconds (auto-cleanup by Cloudflare)
```

On revoke: delete from KV immediately.

KV TTL ensures auto-cleanup even without explicit revocation.

### UI

**Machine detail page** — "Share" button:
1. Opens dialog: select port(s), expiration (1h / 8h / 24h / 7d)
2. Creates proxy token
3. Shows copyable proxy URL
4. "Active share links" list with revoke buttons

**Keys page** — optional "Proxy Tokens" tab showing all active tokens across machines.

---

## Feature 3: Docs Article — "Access Control & Sharing"

### Where

New section in `/docs` page. Add "Access Control" to the nav between Security and Billing.

### Content

1. **API Key Scoping** — creating machine-restricted keys with permissions and expiration
   - Dashboard walkthrough
   - API examples (curl)
   - Permission reference table

2. **Proxy Tokens** — sharing temporary machine access
   - When to use (vs scoped API keys)
   - Creating via API
   - Using the URL (browser — share link)
   - Using the header (programmatic)
   - Revoking

3. **E2E Example**

```bash
# 1. Create a machine-scoped API key (30-day expiry, read+proxy only)
curl -X POST https://justavps.com/api/v1/api-keys \
  -H "Authorization: Bearer sk_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ci-readonly",
    "scope": "machine",
    "machine_ids": ["<machine-uuid>"],
    "permissions": ["read", "proxy"],
    "expires_in_seconds": 2592000
  }'

# 2. Use the scoped key to access a machine port via CF Worker
curl https://3000--my-box.kortix.cloud \
  -H "Authorization: Bearer sk_live_<scoped-key>"

# 3. Create a 1-hour proxy token for sharing with a non-user
curl -X POST https://justavps.com/api/v1/proxy-tokens \
  -H "Authorization: Bearer sk_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "machine_id": "<machine-uuid>",
    "ports": [3000],
    "expires_in_seconds": 3600,
    "label": "design-review"
  }'
# Response includes proxy_url — share it

# 4. Recipient opens in browser — no login needed
# https://3000--my-box.kortix.cloud?__proxy_token=pt_xxx

# 5. Revoke early if needed
curl -X DELETE https://justavps.com/api/v1/proxy-tokens/<token-id> \
  -H "Authorization: Bearer sk_live_xxx"
```

---

## Daytona Comparison

| Aspect | Daytona | JustAVPS |
|---|---|---|
| URL format | `{port}-{sandboxId}.proxy` | `{port}--{slug}.kortix.cloud` |
| Token in URL | Replaces sandbox ID: `{port}-{token}.proxy` | Query param: `?__proxy_token=pt_xxx` |
| Cookie flow | Warning page → user accepts → cookie | Auto-set cookie on first `?__proxy_token=` visit |
| Token reset on restart | Standard tokens reset | Tokens survive restarts (explicit expiry only) |
| Custom proxy | Supported (proxy samples repo) | Not needed — CF Worker is the only proxy |
| API key permissions | Resource-scoped (`write:sandboxes`) | Verb-scoped (`read`, `write`, `exec`, etc.) |
| Naming | "Preview tokens" | "Proxy tokens" (clearer — it's proxy access) |

We use query params instead of embedding the token in the subdomain because:
- Our URL format already uses `--` separator for port routing
- Embedding tokens in subdomains requires wildcard DNS per-token
- Query param → cookie flow is simpler and works the same way

---

## Implementation Phases

### Implementation Status

| Phase | What | Status |
|---|---|---|
| **0** | Deprecate `proxy.ts` (kept temporarily, marked `@deprecated`) | ✅ Done |
| **1** | API key scoping + expiration: DB schema, API, api-guard, KV sync, CF Worker, validate-key | ✅ Done |
| **2** | API key scoping UI: list badges for scope/permissions/expiry | ✅ Done (basic) |
| **3** | Proxy tokens: DB schema, API routes, KV sync, CF Worker | ✅ Done |
| **4** | Proxy token UI: share button on machine page | ⬜ TODO |
| **5** | Docs article: access control, proxy tokens, custom proxy | ✅ Done |
| **6** | Worker tests: 13 new tests for proxy tokens + scoped keys + expiry | ✅ Done (58 total, all passing) |

### Remaining Work

- **Proxy token UI** — "Share" button on machine detail page (create token, show URL, revoke)
- **API key create dialog** — scope/permissions/expiry form in dashboard (currently only name)
- **Delete `proxy.ts`** — once Kortix Computer migrates to CF Worker path

### Migration Safety

- All existing keys: `scope='account'`, `permissions=['*']`, `expires_at=NULL`
- All new columns have defaults → `db:push` safe, zero downtime
- CF Worker deploy must follow platform deploy (KV format is additive)
- Proxy tokens are a new table → no migration conflicts
