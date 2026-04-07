# justavps.com

1-click VPS provisioner with templates for AI agents (OpenCode, Claude Code, Kortix). Fancy UI over Hetzner/OVH/Contabo. SSH-first, always-on compute.

Created: 2026-03-15T22:58:20.398Z

- 2026-04-07: VM fast path now uses exact-CPU warm reserve (~<5s) with exact-CPU stateful reserve (~10s) as default fallback before full cold boot (~27s). Cold boot is still dominated by Incus/QEMU q35+OVMF firmware overhead; direct kernel boot and microvm machine type are blocked by Incus.

- 2026-04-07: Removed stateful fallback from the live VM runtime path. Current VM model is exact-CPU warm reserve + full cold boot fallback only. Warm reserve measured ~4.6s live after rollback; cold boot remains ~27s.

- 2026-04-07: Added internal GTM doc at `docs/plan-icp-persona.md`. Primary ICP is technical users/small teams running long-lived AI agent workflows who need persistent Linux machines, care about 24/7 economics, and want better DX/security than a raw VPS. Primary persona is the “agent infrastructure operator.”

- 2026-04-07: Custom user images can use the same reserve model as the platform golden image, but reserves should be keyed by (image_id, cpu_bucket) and exposed as explicit billable product options rather than hidden infra.
