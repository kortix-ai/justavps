# Warm-only VM path verification — 2026-04-07

## Decision
Stateful fallback was removed from the runtime path.
Current VM provisioning model is now:
1. exact-CPU warm reserve
2. full cold boot fallback

Stateful resume remains documented as research only, not active runtime behavior.

## Live verification
- local app health: ok
- host runnerd health: ok
- host incus health: ok
- warm pool status after rollback: 4/4 ready
- stateful pool status: removed from healthz/runtime

## Measured timings
- warm reserve hit (latest live run): ~4.62s end-to-end for slug `uxa2xiko`
  - runnerd warm claim: +4ms
  - identity injected: +1871ms
  - proxies ready: +4417ms
  - machine DB ready_at: ~4.62s after create
- previous optimized warm path best-case measurement in this session: 1.37s end-to-end
- cold boot baseline (measured earlier today): 27.24s end-to-end

## Current host reserve inventory
- warm buckets only:
  - cpu=1: 1 running reserve
  - cpu=2: 1 running reserve
  - cpu=4: 1 running reserve
  - cpu=8: 1 running reserve

## Notes
- Removing stateful fallback simplifies the mental model and product behavior.
- Cold path is unchanged by this rollback; still ~27s when no warm reserve is available.
- Warm reserve remains the only fast path within Incus/QEMU/OVMF.
