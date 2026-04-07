# Cold Boot Optimization Spec — Getting Incus VMs Under 5 Seconds

## Current State

- **Cold boot (host wall clock)**: ~18s
- **VM internal boot**: ~2.5s
- **Gap**: ~15.5s = OVMF firmware + Incus agent connection
- **Warm pool perceived**: ~2.7s (hides the cold boot entirely)

## Where the 18 Seconds Goes (Measured)

| Phase | Time | % of total |
|-------|------|-----------|
| QEMU process startup | ~0.3s | 2% |
| OVMF firmware init (PCI, memory, boot device) | ~12s | 67% |
| Device enumeration (GPU, spice, USB, PCIe) | ~1.5s | 8% |
| Linux kernel boot | ~1.0s | 6% |
| systemd userspace | ~1.5s | 8% |
| Incus agent connecting via vsock | ~1.5s | 8% |
| **Total** | **~18s** | 100% |

## What We've Tried

### ✅ Strip unnecessary QEMU devices (via raw.qemu.conf/scriptlet)
- Removed: GPU, spice, USB, audio, keyboard, tablet, 8 unused PCIe ports
- **Result: 18s → 17.2s (saved 1.5s)**
- Limited impact because OVMF firmware init is the bottleneck, not device count

### ❌ Direct kernel boot (-kernel flag)
- Incus **explicitly blocks** `-kernel` and `-bios` in both `raw.qemu` and scriptlets
- Error: `Addition or deletion of -bios or -kernel is unsupported`
- **Cannot bypass OVMF firmware within Incus**

### ❌ Change machine type to microvm
- `raw.qemu.conf` can override `[machine] type = "microvm"`
- **Fails**: microvm doesn't support pflash (UEFI firmware), and Incus always injects pflash drives
- Error: `machine type does not support if=pflash`

### ❌ BIOS mode (security.csm=true)
- Golden image has EFI partition, won't boot in BIOS mode
- Would need a completely different image format
- SeaBIOS is ~2s faster than OVMF but still not fast enough alone

### ✅ security.secureboot=false
- **Saves ~1s** by skipping secure boot key verification
- Already applied

## Optimizations Still Available Within Incus

### 1. Custom OVMF firmware with reduced timeout (est. save 3-5s)

OVMF has internal timeout settings during firmware init:
- **PXE boot timeout**: OVMF waits for network boot responses (~3s)
- **Boot device selection**: OVMF enumerates all boot options (~2s)
- **Memory training**: OVMF validates memory layout (~1-2s)

**Action**: Build a custom OVMF firmware with:
- PXE boot disabled
- Boot timeout = 0
- Single boot device (no enumeration)
- Place at `/opt/incus/share/qemu/OVMF_CODE.4MB.fd` (replaces default)

**Risk**: Medium. Custom firmware needs to be maintained across Incus updates.
**Effort**: 1-2 days (build EDK2/OVMF from source with modified config)

### 2. OVMF VARS pre-seeding (est. save 2-3s)

OVMF stores boot configuration in the VARS file. On first boot, OVMF initializes VARS from scratch (slow). On subsequent boots, it reads existing VARS (faster).

**Action**: Pre-seed the OVMF VARS file in the golden image so OVMF skips first-boot initialization. Copy the VARS from a VM that's already booted once.

**Risk**: Low. VARS file is per-VM but the structure is shared.
**Effort**: Half a day.

### 3. Reduce Incus agent startup time (est. save 0.5-1s)

The Incus agent inside the VM:
- Mounts 9p shares for config and agent binaries
- Connects to host via vsock
- Reports IP and state

**Action**: 
- `security.agent.metrics=false` — skip metrics collection on agent start
- Investigate if agent binary can be pre-loaded in golden image instead of mounting from 9p

**Risk**: Low.
**Effort**: Hours.

### 4. Optimized GRUB inside the VM (est. save 0.5-1s)

Even with `GRUB_TIMEOUT=0`, GRUB still:
- Loads from EFI partition
- Reads grub.cfg
- Loads kernel + initrd from disk

**Action**: 
- Ensure GRUB_RECORDFAIL_TIMEOUT=0 is actually in the EFI grub.cfg (not just /etc/default/grub)
- Rebuild grub inside the golden image targeting the EFI partition specifically
- Consider using GRUB's `GRUB_FORCE_PARTUUID` to skip disk probing

**Risk**: Low.
**Effort**: Hours.

### 5. Minimal initrd (est. save 0.5-1s)

The current initrd is ~21MB and loads many modules at boot. A stripped initrd with only the virtio drivers needed for Incus VMs would be faster.

**Action**: Build a custom initrd with only: virtio_blk, virtio_net, virtio_scsi, ext4, nls_ascii
**Risk**: Medium (missing a driver = unbootable)
**Effort**: 1 day

### 6. Kernel command line optimizations (est. save 0.3-0.5s)

Already partially done. Additional options:
- `lpj=<value>` — pre-set loops-per-jiffy to skip calibration (~100ms)
- `tsc=reliable` — trust TSC, skip calibration
- `raid=noautodetect` — skip RAID scanning
- `noapic` — might break, but saves enumeration time
- `nokaslr` — skip kernel address randomization

**Risk**: Low for most, medium for `noapic`.
**Effort**: Hours.

### 7. Pre-warm the ZFS ARC cache (est. save 0-0.5s)

After a warm VM in the pool is claimed, the next warm VM created does a ZFS clone. The clone is fast (~0.5s) but the first read hits disk. Pre-reading the golden image blocks into the ARC cache keeps them in memory.

**Action**: After golden image build, read the entire image into page cache:
```bash
dd if=/var/lib/incus/storage-pools/zfs-pool/images/<fingerprint>/root.img of=/dev/null bs=4M
```

**Risk**: None.
**Effort**: Minutes.

## Combined Impact Estimate

| Optimization | Estimated saving | Cumulative |
|--------------|-----------------|------------|
| Baseline | 0 | 18.0s |
| Device stripping (done) | -1.5s | 16.5s |
| security.secureboot=false (done) | -1.0s | 15.5s |
| Custom OVMF (reduced timeouts) | -3 to -5s | 10.5-12.5s |
| OVMF VARS pre-seeding | -2 to -3s | 8.5-9.5s |
| Minimal initrd | -0.5 to -1s | 7.5-9.0s |
| GRUB EFI optimization | -0.5s | 7.0-8.5s |
| Kernel cmdline opts | -0.3s | 6.7-8.2s |
| Agent metrics off | -0.5s | 6.2-7.7s |

**Realistic best case with all optimizations: ~7-8s cold boot.**

## The Hard Truth

**With Incus + QEMU + OVMF, sub-5s cold boot is extremely unlikely.** The OVMF firmware alone takes 10-12 seconds and Incus won't let us bypass it.

**To get under 5 seconds cold boot, you need ONE of:**

| Path | Cold boot | Effort |
|------|-----------|--------|
| Incus warm pool (current) | **~2.7s perceived** | Done ✅ |
| Custom OVMF + all optimizations | **~7-8s** (still >5s) | 1-2 weeks |
| Cloud Hypervisor replacing runnerd | **~200ms** | 6-8 weeks |
| Firecracker replacing runnerd | **~125ms** | 6-8 weeks |
| QEMU microvm (bypass Incus) | **~3-5s** | 4-6 weeks |

## Recommendation

**The warm pool IS the sub-5s solution.** At 2.7s perceived, it already beats the 5s target. The cold boot only matters for:
1. When the pool is empty (edge case, solvable with larger pool)
2. Pool replenishment speed (determines recovery from burst traffic)

**Investment priority:**
1. **Increase pool size dynamically** based on demand (e.g., 5 during business hours, 2 at night)
2. **Apply device stripping + secureboot=false** to warm pool VMs (save 2.5s on replenishment → faster pool recovery)
3. **Custom OVMF firmware** if pool replenishment speed becomes critical (save 3-5s → replenish in ~12s instead of 18s)
4. **Cloud Hypervisor runnerd** as V3 when you need sub-1s cold start without warm pools
