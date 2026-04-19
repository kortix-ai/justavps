# VM boot ladder verification — 2026-04-07

## Verified paths

### Warm pool path
- exact CPU-bucket warm reserve VMs
- measured end-to-end ready time: ~3.67s in latest CPU1 A/B
- earlier optimized runner measurement reached 1.37s total before bucketed refactor
- current production claim: under 5s when warm reserve available

### Stateful fallback path
- exact CPU-bucket stateful-stopped reserve VMs
- measured end-to-end ready time: 10.53s for 2 vCPU / 16 GiB / 100 GiB request
- measured directly: stateful resume took ~8.9s to return and ~9.8-12.2s to agent/ready depending on memory
- memory cannot be changed before stateful resume; CPU can change before resume; RAM can be hotplugged upward after resume; disk can be expanded online after resume

### Cold boot path
- no reserve available
- measured end-to-end ready time: 27.24s for 2 vCPU / 4 GiB / 40 GiB request
- runnerd breakdown: init ~3.8s, start ~4.6s, IP/agent ~24.3s, identity inject ~27.0s, proxies ~29.3s

## Conclusions
- Default fallback ladder should be:
  1. warm reserve
  2. stateful reserve
  3. cold boot
- Statefulness is useful as a fallback reserve, not as a general reusable image primitive.
- Warm reserve remains the only sub-5s path within Incus/QEMU.
- Cold boot remains dominated by OVMF/q35 firmware overhead.
