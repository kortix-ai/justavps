# Context Snapshot — 2026-04-02 — Incus V2 Provider

## Branch / state

- Branch: `feat/incus-v2-provider`
- Base commit on branch: `3a5a2d3` — `wip: scaffold bare-metal incus provider v1`
- Working tree currently includes additional uncommitted changes to:
  - `runnerd/src/index.ts`
  - `src/server/routes/v1/admin-baremetal.ts`
  - `runnerd/package.json`
  - `scripts/bootstrap-baremetal-host.sh`
  - `scripts/wait-and-bootstrap-baremetal-host.sh`
  - `src/__tests__/routes/admin-baremetal-hosts.test.ts`

## Proven live infrastructure state

- Real Hetzner dedicated server ordered programmatically through Robot-backed flow
- Host details:
  - Hetzner server number: `2921540`
  - Host id: `ed822eae-59ef-4601-8782-a17cc85196ab`
  - Public IPv4: `135.181.129.188`
  - Region/location: `hel1` / `HEL1`
- `runnerd` deployed and reachable on `http://135.181.129.188:7779`
- Incus initialized on host with:
  - `default` storage pool (currently `dir`, not final ZFS production layout)
  - `incusbr0` managed bridge
  - working default profile with `root` disk + bridged NIC

## Proven live behavior

### Fleet / control plane
- Hetzner Robot product listing via admin fleet API works
- Procurement create/approve/sync works against live Hetzner Robot
- Host bootstrap config endpoint works
- Host registration endpoint works
- Host appears in control plane as `active`

### Host / runner layer
- `runnerd` stop/start/reboot/publish/delete lifecycle works against a real Incus VM
- `runnerd` create path now works on real hardware after detached-init + busy/etag retry fixes
- Successful runnerd-created VM result:
  - `instanceId: justavps-e2e-9`
  - `privateIpv4: 10.104.145.226`
  - `sshPort: 22279`

### Gaps still present
- No production ZFS-first bootstrap yet; live host is still validated on `dir`
- No warm-pool orchestration yet
- No real metered billing accumulation/Stripe metering yet (only API + FE scaffolding)
- Baremetal/Incus resize is intentionally disabled in the public V2 FE until implemented properly
- Public V2 API/FE now exists for catalog, machines, images, snapshots, billing, and admin fleet, but some routes still lean on transitional V1 internals under the hood

## Architectural decisions already converged

1. Customer-facing API must expose **product concepts**, not substrate concepts
2. Internal fleet API may expose procurement, hosts, runners, capacity, and orders
3. Public untrusted workloads should default to **Incus VMs**, not containers
4. Start with **Hetzner-only** and add providers later behind the same fleet abstraction
5. Start with **pinned-to-node VMs**; no live migration or distributed storage in V1/V2 initial release
6. Warm pools are desirable, but not required for the initial V2 cut
7. Billing must support two future shapes:
   - flat monthly persistent pricing
   - hybrid metered pricing with storage-always-on and compute-only-while-running

## Key repo surfaces already touched

- `src/server/routes/v2/catalog.ts`
- `src/server/routes/v2/index.ts`
- `src/server/routes/v2/machines.ts`
- `src/server/routes/v2/images.ts`
- `src/server/routes/v2/snapshots.ts`
- `src/server/routes/v2/billing.ts`
- `src/server/routes/v1/admin-baremetal.ts`
- `src/server/lib/providers/baremetal.ts`
- `src/server/lib/providers/index.ts`
- `src/server/lib/baremetal/*`
- `src/server/lib/v2/*`
- `src/server/db/schema.ts`
- `runnerd/src/index.ts`
- `src/hooks/use-machines.ts`
- `src/hooks/use-images.ts`
- `src/hooks/use-account.ts`
- `src/hooks/use-fleet.ts`
- `src/components/checkout-modal.tsx`
- `src/app/(dashboard)/machines/[id]/page.tsx`
- `src/app/(dashboard)/billing/page.tsx`
- `src/app/(dashboard)/admin/fleet/page.tsx`

## Main product insight from research + live work

Incus on bare metal is the simplest practical path to a production-grade, persistent, 24/7 agent-computer platform with snapshots/images/backups semantics and strong operator control. It is not the fastest possible substrate, but it is the easiest good one. Warm pools can hide most boot-time concerns later. The product moat is **persistent, agent-native compute at VPS-like economics**, not raw hypervisor novelty.
