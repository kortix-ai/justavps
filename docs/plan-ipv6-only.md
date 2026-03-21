# Plan: Drop IPv4, Go IPv6-Only

## Goal
Eliminate the €0.50/month per-machine IPv4 Primary IP cost by switching to IPv6-only networking on Hetzner. All traffic already routes through Cloudflare (which provides IPv4→IPv6 translation for end users) or through DNS hostnames (which resolve IPv6 transparently).

## Savings
- €0.50/month per machine (Hetzner IPv4 Primary IP)
- At 100 machines: €50/month. At 1000: €500/month.
- IPv6 Primary IPs: **free**

## Current Architecture
```
End User → Cloudflare (anycast IPv4/IPv6)
         → CF Worker (proxy.ts) → origin-slug.kortix.cloud (DNS-only A record → VPS IPv4)
         → VPS :80 (daemon)

Platform (Vercel) → http://{machine.ip}:80/toolbox/... (direct IPv4 fetch)
User SSH → ssh root@{machine.ip} (direct IPv4)
```

## Target Architecture
```
End User → Cloudflare (anycast IPv4/IPv6)
         → CF Worker (proxy.ts) → origin-slug.kortix.cloud (DNS-only AAAA record → VPS IPv6)
         → VPS :80 (daemon)     [NO CHANGE — Worker uses hostname, not raw IP]

Platform (Vercel) → http://origin-slug.domain:80/toolbox/... (DNS hostname → IPv6)
User SSH → ssh root@{ipv6} OR ssh root@slug.kortix.cloud
```

## Success Criteria
- [ ] Servers created with IPv6-only (`enable_ipv4: false, enable_ipv6: true`)
- [ ] IPv6 address extracted from Hetzner API response and stored in DB
- [ ] Cloudflare DNS creates AAAA records instead of A records
- [ ] CF Worker proxy still works (already uses `origin_hostname`, no change needed)
- [ ] Toolbox proxy uses DNS hostname instead of raw IP
- [ ] Cloud-init iptables has ip6tables equivalent
- [ ] SSH commands display correctly to users
- [ ] All existing tests updated and passing
- [ ] Linter clean

## Plan

### Step 1: Hetzner provider — IPv6 server creation
**File:** `src/server/lib/providers/hetzner.ts`

Changes:
- **Line 103-106:** Update `HetznerServer` interface — `ipv6.ip` returns a network like `2a01:4f8:c17:e4c4::/64`. We need to strip the `/64` suffix to get a usable IP address.
- **Line 225:** Change `public_net: { enable_ipv4: true, enable_ipv6: false }` → `{ enable_ipv4: false, enable_ipv6: true }`
- **Line 240:** Change `result.server.public_net.ipv4.ip` → extract from `public_net.ipv6.ip`, stripping the `/64` CIDR suffix (Hetzner returns `2a01:4f8:c17:e4c4::/64`, we need `2a01:4f8:c17:e4c4::`)
- **Lines 247-249:** Same change in the fallback poll loop
- Add a helper: `function extractIPv6(raw: string): string` that strips `/64` suffix

**Acceptance:** Server creation returns an IPv6 address. The `publicIp` field contains a bare IPv6 address like `2a01:4f8:c17:e4c4::1`.

### Step 2: Cloudflare DNS — AAAA records
**File:** `src/server/lib/cloudflare.ts`

Changes:
- **Line 1-9:** Update module docstring — mention AAAA records
- **Line 57-69:** Update `addMachineDNS` docstring
- **Line 91:** `type: 'A'` → `type: 'AAAA'` (proxied record)
- **Line 93:** Update log message
- **Line 100:** `type: 'A'` → `type: 'AAAA'` (wildcard record)
- **Line 102:** Update log message
- **Line 109:** `type: 'A'` → `type: 'AAAA'` (origin DNS-only record)
- **Line 111:** Update log message

**Note:** `deleteAllDNSRecords` already cleans up `A`, `AAAA`, and `CNAME` — no change needed there.

**Acceptance:** DNS records are AAAA type. CF proxied AAAA records work identically to proxied A records for end users (CF serves IPv4 to visitors regardless).

### Step 3: Toolbox proxy — use DNS hostname instead of raw IP
**File:** `src/server/routes/v1/toolbox.ts`

Changes:
- **Line 73-81:** Change `proxyToToolbox` to accept a hostname/slug parameter and build the URL using the origin DNS hostname instead of the raw IP. This makes it IP-version-agnostic.
  - Before: `http://${machineIp}${daemonPath}`
  - After: `http://origin-${slug}.${proxyDomain}${daemonPath}`
- **Lines 108, 245, 306, 532, 602:** Update all callsites to pass `machine.slug` instead of `machine.ip!`
- **Line 64:** Keep the `machine.ip` null check (still validates the machine was provisioned)

**Alternative approach:** Just bracket-wrap IPv6 in the URL (`http://[${ip}]${path}`). But using DNS hostnames is cleaner and future-proof — we don't care what address family the IP is.

**Acceptance:** Toolbox proxy resolves the VPS via DNS hostname. No raw IP in HTTP URLs.

### Step 4: Cloud-init — dual-stack iptables
**File:** `src/server/lib/cloud-init.ts`

Changes:
- **Lines 323-333:** The Docker guard script uses `iptables` only. Add `ip6tables` equivalents for each rule. The guard blocks Docker containers from reaching the internet except via established connections. On an IPv6-only host, *only* ip6tables matters, but making it dual-stack is safer.

**Acceptance:** Docker guard works on IPv6-only hosts.

### Step 5: SSH command display
**File:** `src/server/routes/v1/machines.ts`

Changes:
- **Lines 83-87, 121:** SSH commands currently use `root@${m.ip}`. OpenSSH handles IPv6 addresses natively (`ssh root@2a01:4f8::1`), so this works as-is. But for UX, we should also offer the DNS hostname as an alternative.
  - The `connect.ssh_command` could use `root@${m.slug}.${proxyDomain}` for a cleaner display, while keeping the raw IP as fallback.
  - **Decision:** Keep `root@${ip}` for now — it works and avoids introducing DNS dependency for SSH. IPv6 addresses are uglier but functional. We can improve UX later.

**No code change needed here.** Just confirming SSH works with IPv6 addresses.

### Step 6: Update tests
**Files:**
- `src/__tests__/lib/cloudflare.test.ts` — Change expected `type: 'A'` → `type: 'AAAA'` in all assertions
- `src/__tests__/lib/ssh-key-lifecycle.test.ts:162` — Change mock `public_net` to use `ipv6.ip` with CIDR suffix

### Step 7: Update machine-lifecycle docstrings
**File:** `src/server/lib/machine-lifecycle.ts`

Changes:
- **Lines 140-143:** Update comment from "DNS A records" to "DNS AAAA records"
- **Line 153:** Same

## Anti-Patterns
- **Don't touch the CF Worker proxy code** — it already uses `origin_hostname` (DNS), not raw IPs. Zero changes needed.
- **Don't touch the firewall rules** — they already include both IPv4 and IPv6 CF ranges + `::/0` for SSH.
- **Don't touch the KV data structure** — the `ip` field stores a string, works with any IP format.
- **Don't touch the DB schema** — `ip` is a `text` column.
- **Don't try to make toolbox proxy use `http://[ipv6]:port`** — using the DNS hostname is cleaner and more robust.

## Risks
1. **Hetzner IPv6 format:** The API returns `2a01:4f8:c17:e4c4::/64` (network with CIDR). We need to strip the `/64`. If the format varies, the `extractIPv6` helper handles it.
2. **Vercel outbound IPv6:** The toolbox proxy runs on Vercel. By switching it to use DNS hostnames (which Vercel resolves via its own DNS), we sidestep the question entirely — Vercel's DNS resolver handles IPv4/IPv6 preference.
3. **Existing machines:** This only affects NEW machines. Existing ones keep their IPv4 until recreated.

## Verification
1. `npx vitest run src/__tests__/lib/cloudflare.test.ts` — DNS record tests pass with AAAA
2. `npx vitest run src/__tests__/lib/ssh-key-lifecycle.test.ts` — SSH key GC tests pass with IPv6 mock data
3. `pnpm exec eslint` on all changed files — no lint errors
4. Manual: Review all changed files for correctness
