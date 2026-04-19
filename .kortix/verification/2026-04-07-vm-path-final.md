# VM path final verification — 2026-04-07

## Current runtime ladder
1. warm pool (running reserve) → measured ~4.19s
2. stopped reserve (booted-once, tuned OVMF vars, stopped) → measured ~10.73s
3. full cold boot → measured ~27.24s

## A/B evidence
### CPU1 warm vs stopped reserve
- warm (`cpu1-warm-final`) → 4.19s
- stopped reserve (`cpu1-stopped-final`) → 10.73s

## Why stopped reserve works better than stateful
- preserves tuned OVMF vars on the same VM
- avoids stateful RAM dump / restore complexity
- no memory immutability constraint before boot
- materially simpler product/runtime model

## Key conclusion
The active VM-only model can now satisfy:
- sub-5s on warm hits
- sub-15s on non-warm fallback
without stateful snapshot/resume in the runtime path.
