# Per-machine features plan (proxy / SSH / volumes)

Status: design notes. Nothing in this doc is implemented yet — captured here so
the next session can pick up cleanly.

## 1. Per-machine HTTPS proxy (Daytona's `https://22222-<hash>.daytonaproxy.net`)

**End state**: every V2 machine gets a stable, slug-based subdomain on
`kortix-dev.cloud` (dev) / `kortix.cloud` (prod). HTTPS-only. Auth required by
default; user can mint short-lived "share tokens" (proxy tokens) for
unauthenticated public access if they want.

URL shape (mirrors V1):
```
https://<slug>.kortix-dev.cloud                  # default port (80/443 inside)
https://<port>--<slug>.kortix-dev.cloud          # any TCP port
```

Auth (bearer) options on the proxy:
- `Authorization: Bearer sk_live_<api-key>` — full-access API key (must include `proxy` permission)
- `X-Proxy-Token: pt_<token>` — short-lived, machine-scoped (optionally port-scoped)
- `?__proxy_token=pt_xxx` — browser-friendly query param for share links
- session cookie / proxy JWT for logged-in dashboard users

V1 already implements all of this end-to-end (`apps/v1-api/src/server/v1/services/proxy-kv.ts`, Cloudflare Worker that reads the KV cache). What's missing for V2:

1. **Slug minting** — `v2_core.machine` row needs a `proxy_slug` field
   (lowercase, hyphenated, globally unique). Generate at create time
   (`<account-prefix>-<random6>`) so it's stable for the machine's lifetime.
2. **Backend resolution** — proxy KV needs to know "slug X → instance Y in
   cluster Z, currently at IP A.B.C.D". Two options:
   - **Reuse V1's KV namespace** (`CF_KV_NAMESPACE_ID=30b11d4b...`). Add V2-prefixed
     keys (`v2:slug:<slug>`) so V1 + V2 entries don't collide. Same Worker
     reads both.
   - **Spin up a new Worker for V2 only.** Cleaner blast-radius story long-term but doubles ops surface.
   
   Recommendation: reuse the V1 KV; V2 keys are namespaced. Single Worker.
3. **IP discovery** — Incus instances get a DHCP IP from `incusbr0` (10.189.108.0/24).
   The IP is in `incus.observed.state.network.eth0.addresses[0].address`.
   We surface it in `serializeMachine`. The KV sync job reads it on every
   machine create / start / stop and writes to KV.
4. **Routing edge** — Cloudflare Worker fronts `*.kortix-dev.cloud`. It does:
   - parse `<port>--<slug>.kortix-dev.cloud` → look up `v2:slug:<slug>` in KV
   - validate auth header / cookie / token against `v2:api-key:<hash>` or `v2:proxy-token:<hash>`
   - reverse-proxy to the bridge IP via Cloudflare Tunnel (`cloudflared` running on the Incus host, reaching `10.189.108.X:port`)

**API surface to add to V2:**
- Field on `Machine` envelope: `proxy: { slug: string, base_url: string }`
- `POST /machines/:id/proxy-tokens` — mint a proxy token (returns `pt_xxx`, scope, expiry)
- `GET /machines/:id/proxy-tokens` — list active tokens
- `DELETE /machines/:id/proxy-tokens/:token` — revoke
- Sync hook: every machine create/start/stop → push KV update

**Effort**: medium. ~1 day backend (slug + KV writes + token routes), 0.5 day
Worker update (V2 key prefix handling), 0.5 day SDK + UI ("Open in browser" button on the machine sheet that opens `https://<slug>.kortix-dev.cloud`).

## 2. Per-machine SSH access with expiring tokens

Daytona pattern: dashboard generates a temporary SSH key pair scoped to one
machine, valid for N seconds, dropped onto the machine's `authorized_keys`,
auto-removed when the timer fires.

**Implementation sketch:**
- New table `v2_core.ssh_grant` — `(id, machineId, publicKey, fingerprint, expiresAt, accountId, revoked)`.
- `POST /machines/:id/ssh-grants` body `{ expires_in_min }` → server generates Ed25519 keypair, writes pub to `~/root/.ssh/authorized_keys` via the existing `pushFile` helper (with `mkdir=true`), persists row, returns `{ private_key, expires_at, ssh_command }`.
- `DELETE /machines/:id/ssh-grants/:id` → removes the matching line from `authorized_keys` (re-write the file via pushFile).
- Background job (same lifecycle sweeper, new pass): expire-based cleanup that re-writes `authorized_keys` to drop expired grants.
- `ssh_command` shape: `ssh -i ~/.ssh/justavps_<slug> -o ProxyCommand="cloudflared access ssh --hostname ssh-<slug>.kortix-dev.cloud" root@<slug>` — leverages the same Cloudflare tunnel infrastructure that proxies HTTP, with cloudflared SSH access.

**Effort**: small backend (~3h), needs Cloudflare Access app config for the SSH side.

## 3. Volumes (S3-backed shared filesystems)

Daytona volumes are **shared between sandboxes**. Real implementation:
- Backing storage = S3 (Cloudflare R2 in our case — already configured: `CLOUDFLARE_ACCOUNT_ID`, `CF_KV_NAMESPACE_ID`).
- Mount technique = `s3fs` or `rclone mount` inside each sandbox at create-time.
- API: `POST /volumes`, `GET /volumes`, `DELETE /volumes/:id`. Then `POST /machines` body gets a `volumes: [{ volume_id, mount_path }]` field.

**Cheaper interim option** (per-machine non-shared volumes, reuses Incus storage):
- `incus storage volume create zfs-pool <volname>` + attach as a device on the instance.
- Per-machine, not shared — simpler, no S3.

**Recommendation**: ship the per-machine path first (1 day), keep "shared volumes" as a phase-2 with R2. Don't try to launch shared in the same session as everything else.

## Sequencing

If you want me to ship next session, in priority order:
1. **Proxy slug + KV write** (3h) — biggest UX win, the "wow" Daytona moment.
2. **Per-machine non-shared volumes** (1d) — easy, useful, real Incus feature.
3. **Per-machine SSH grants** (3h) — depends on Cloudflare Access SSH being configured.
4. **Shared volumes via R2** (1d) — only if we explicitly need cross-sandbox sharing.

Each is independently shippable; nothing is gated on anything else (proxy can use IP-direct for local-dev before the Cloudflare Worker is updated).
