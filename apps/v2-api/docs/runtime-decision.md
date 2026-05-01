# Runtime decision — Incus, permanently

Status: locked. This is the architectural call, not a "for now."

## The call

JustAVPS runs on **Incus**. LXC containers + QEMU/KVM VMs. No hybrid runtime,
no CubeSandbox/Firecracker/Kata layer, no Kubernetes-as-control-plane rewrite.

The trade is explicit: cold-start floor is **~3 seconds** for both containers
and VMs (warm cache, measured). That ceiling stays. We don't chase sub-second
boot through DIY runtime work.

## Why

1. **Incus IS the cloud.** Resize, snapshots, backups, volume pools, multi-host
   scheduling, live migration, image catalog, hardened idmap isolation, OCI
   imports, KVM VMs — all of it is one upstream, one operations model, one
   bug tracker. Every one of those features in our V2 API is a thin wrapper
   on an Incus primitive that already works in production at LXC's scale.
2. **Reliability over speed.** Three seconds is acceptable for code-interpreter
   workloads, dev sandboxes, build agents — the actual things users do with
   us. A platform that boots in 300 ms and loses your snapshot is worse than
   one that boots in 3 s and never loses anything.
3. **Engineering time is finite.** Every hour spent on a parallel
   Firecracker control plane is an hour not spent on product, billing,
   networking, customer onboarding, the dashboard, the SDK ergonomics. We're
   not in the "make a runtime" business.
4. **Daytona / E2B advertise "millions of sandboxes" but they mean per-month
   short-lived, not concurrent.** Incus on a properly scaled cluster handles
   that volume. The benchmark we'd lose is per-host density (Cube hits 10k+
   per host via kernel-share; Incus tops out around 500–1000), and that's
   fine if we add hosts horizontally. Hosts are cheap on Hetzner.

## What this means concretely

| Decision | Why |
|---|---|
| **No runtime swap, ever, in V2/V3/V4.** Incus stays. | Reliability + simplicity per above. |
| **No K8s migration.** | We already have a working control plane (Incus + our V2 API). K8s + Kata is a 6-month rebuild for problems we don't have. |
| **No "fast tier" bolt-on.** | Kills the simplicity premise. Two control planes is more failure surface than 3-second boot is worth. |
| **The 3-second cold-start budget is the SLA.** | If a workload genuinely can't tolerate it, that workload doesn't fit JustAVPS, and that's OK. |
| **Performance work stays inside Incus.** | The real wins still on the table without leaving Incus: ZFS on a raw partition (vs the current loopback file), faster cluster network, more aggressive prewarm policy, image cache hot-tiering. None require a runtime change. |

## What we still build, all on Incus

The product roadmap is unchanged in shape — only the underlying runtime
question is settled. Features still to ship:

- **Live resize** — `PATCH /machines/:id` driving Incus's instance config update.
- **Per-machine HTTPS proxy** — slug routing through `kortix-dev.cloud`.
- **Per-machine SSH grants** — expiring keys via `pushFile` into `authorized_keys`.
- **Per-machine non-shared volumes** — Incus storage volume attach.
- **Multi-pool storage tiering** — NVMe pool + HDD pool, user picks at create.
- **OCI-as-VM image imports** — flip `image_type` flag at OCI pull time.
- **Multi-cluster scaling** — auto-add nodes to existing region clusters.
- **Multi-region** — second cluster in `us`, then more regions.
- **Per-account API keys** — replace the global `V2_ADMIN_TOKEN`.
- **IncusOS host migration** — atomic immutable host OS, drift-free upgrades.
- **Live migration exposed in V2 API** — `POST /machines/:id/migrate`.

All of these are Incus primitives. We're a wrapper, not a runtime.

## What we explicitly don't do

- Don't write a custom microVM runtime.
- Don't add a CRI shim.
- Don't run two control planes.
- Don't optimize for the wrong benchmark (sub-second cold start) at the
  cost of the right one (zero-incident lifecycle ops).

## Revisit policy

This decision is locked. The only thing that changes it is a customer
contract that explicitly requires sub-second cold start AND attaches
revenue large enough to fund the parallel-runtime build. Until then,
new engineering hours go to product, not runtime.
