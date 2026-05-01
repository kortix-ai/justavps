# Incus 6.23 cluster-join managed-bridge quirk

## Symptom

Joining a fresh node into an existing 2+ member Incus cluster via
`incus admin init --preseed` consistently fails with:

```
Error: Failed to join cluster: Failed to initialize member: Failed to
initialize storage pools and networks: Failed to update local member
network "incusbr0" in project "default": Failed loading network: Network not found
```

This happens regardless of which preseed format is used — minimal,
maximal, with or without `member_config` for the network entry, with all
documented per-member keys (`bridge.external_interfaces`, `parent`, etc.)
set to "", "none", or omitted.

## Root cause (read from upstream source)

`client/incus_server.go::applyNetwork()` does GET → if found UPDATE, else
CREATE. The error is from the UPDATE branch when GetNetwork found the
record but the subsequent UpdateNetwork's internal `network.LoadByName`
returns "Network not found". This is a race between cluster DB sync and
local network instantiation during the join transaction.

## Workarounds tried, all failed

1. Minimal preseed (no `member_config` at all) — same error.
2. `member_config` for the network with `bridge.external_interfaces: ""` — same error.
3. Same with `value: none` (literal string) — same error.
4. Same with `parent: ""` — same error.
5. Pre-init the new node as standalone (`incus admin init --auto`)
   then run the join preseed — different error: `Config key "source"
   is cluster member specific`. Pre-init creates a local pool that
   conflicts with the cluster's pool.
6. Pre-create only the bridge as managed with the cluster's exact
   IPv4 config, then join — exec timed out / unclear failure.

## Workarounds NOT tried in this session (next steps)

- **Rebuild the cluster fresh with all members at bootstrap time.**
  The 2-member cluster was built before any of the join code paths
  here. A 3-member bootstrap done via `incus admin cluster bootstrap`
  on all hosts simultaneously sidesteps the post-hoc join entirely.
- **Switch to OVN networking.** OVN networks don't go through
  `applyNetwork`'s managed-bridge code path. Larger architectural move.
- **Convert `incusbr0` to per-member-declared (unmanaged at the
  cluster level, recreated locally on each member).** Requires draining
  running instances first.
- **Upgrade Incus to a 6.24+ that may fix this.** Wait for upstream.

## What this DOESN'T block

- The node-provisioning runner (`apps/v2-api/src/services/nodeProvisioning.ts`)
  is otherwise functional — it correctly walks all 7 steps; only the
  `cluster-join` step hits this Incus quirk. Every other step
  (probe-ssh, prereqs, install-incus, wipe, mint-token, verify) works.
- IncusOS install pipeline is independent — when we move to IncusOS hosts,
  the cluster will be re-bootstrapped fresh and this quirk goes away.
- All Hetzner ordering API integration is solid (live order placed and
  delivered in under 5 min).

## Operational stance

Treat the existing 2-node cluster as fixed-size for now. New capacity
arrives via:
- **Vertical**: bump per-host limits (more containers per node).
- **Parallel cluster**: a second `hel2` cluster with its own bootstrap;
  V2 API already supports multi-cluster routing.

When we cross the per-cluster ceiling we either:
1. Rebuild `hel1` fresh with whatever-many members we want (downtime
   window required — drain instances to a parallel cluster first).
2. Move to IncusOS, which gets a fresh cluster bootstrap as part of
   the OS migration.

Either of those is a planned operation, not a hot-path scaling event.
