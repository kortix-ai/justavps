# justavps.com

1-click VPS provisioner with templates for AI agents (OpenCode, Claude Code, Kortix). Fancy UI over Hetzner/OVH/Contabo. SSH-first, always-on compute.

Created: 2026-03-15T22:58:20.398Z

- 2026-04-07: VM fast path now uses exact-CPU warm reserve (~<5s) with exact-CPU stateful reserve (~10s) as default fallback before full cold boot (~27s). Cold boot is still dominated by Incus/QEMU q35+OVMF firmware overhead; direct kernel boot and microvm machine type are blocked by Incus.

- 2026-04-07: Removed stateful fallback from the live VM runtime path. Current VM model is exact-CPU warm reserve + full cold boot fallback only. Warm reserve measured ~4.6s live after rollback; cold boot remains ~27s.

- 2026-04-07: Added internal GTM doc at `docs/plan-icp-persona.md`. Primary ICP is technical users/small teams running long-lived AI agent workflows who need persistent Linux machines, care about 24/7 economics, and want better DX/security than a raw VPS. Primary persona is the “agent infrastructure operator.”

- 2026-04-07: Custom user images can use the same reserve model as the platform golden image, but reserves should be keyed by (image_id, cpu_bucket) and exposed as explicit billable product options rather than hidden infra.

- 2026-04-10: V2 E2E required local benchmark Postgres plus a live public callback tunnel. Browser E2E fixtures had drifted from the current V2 API (`resources` instead of `plan`, updated provisioning copy), and the runtime script now treats `warm_pool.target=0` as cold-fallback mode instead of a hard failure.

- 2026-04-10: V2 proxy routing was fixed by writing the baremetal runner `http_port` into Cloudflare KV and having the Worker/Broker dial the machine via that origin port. The dev Worker also needed a live broker origin during verification; direct broker availability can still break runtime proxy E2E even when machine provisioning succeeds.

- 2026-04-10: A second real Hetzner host was ordered and registered: `a1e0cdbc-72d9-46dd-9a03-983d15d50326` / `bm-general-small-HEL1-a1e0cdbc` / `65.109.65.169`. Full pinned V2 E2E passed on that host using the `justavps standard` template row (`4baec0c1-aaec-4093-aa71-bd0dcc1b5d8a`) after forcing the non-golden path through full cloud-init.

- 2026-04-10: V2 needed a real fallback for non-golden images. Fixes made: V2 now uses full cloud-init (not minimal V2 cloud-init) whenever the resolved image is not `justavps-golden`; full cloud-init now explicitly installs/enables `openssh-server`; runnerd’s non-golden create path now sets up SSH/HTTP proxy devices and returns `httpPort` so proxy + SSH work end to end on raw/template images.

- 2026-04-10: Host 2 golden/warm-pool path is now healthy too. Root causes were: (1) the image builder’s GRUB tweaks caused published `justavps-golden` clones to drop to a raw `grub>` prompt; (2) the builder’s in-VM daemon download produced a zero-byte `/usr/local/bin/justavps-daemon` in the published image. Fixes: removed aggressive GRUB tuning from `scripts/build-golden-image.sh`, added support to inject a known-good host daemon binary (`HOST_DAEMON_BIN`) into the build VM, rebuilt the image on host 2, then verified pinned runtime E2E on the default golden path, pinned baremetal E2E, and the pinned cold benchmark. Host 2 was left with `WARM_POOL_PER_CPU=1`, `POOL_CPU_BUCKETS=1`, and health showing warm pool ready `1/1`.
