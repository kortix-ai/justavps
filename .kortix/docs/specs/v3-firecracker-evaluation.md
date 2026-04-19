# V3 Evaluation: Firecracker / Cloud Hypervisor / Kata Containers

## The Three Options

### 1. Firecracker (direct)
- **What**: Minimal VMM by AWS, purpose-built for Lambda/Fargate
- **API**: REST over Unix socket (`/tmp/firecracker.socket`)
- **Boot**: Direct kernel boot (no firmware) → ~125ms cold start
- **Snapshot restore**: ~5-50ms (full memory snapshot)
- **Used by**: AWS Lambda, AWS Fargate, Fly.io, Koyeb

### 2. Cloud Hypervisor
- **What**: General-purpose Rust VMM, shares `rust-vmm` crates with Firecracker
- **API**: REST over Unix socket or HTTP
- **Boot**: Direct kernel boot OR firmware → ~200ms cold start  
- **Extras over Firecracker**: PCI hotplug, live migration, vfio, pmem, Windows support
- **Used by**: Intel, various cloud providers

### 3. Kata Containers (with Firecracker backend)
- **What**: OCI-compatible container runtime that uses VMs for isolation
- **API**: Standard Docker/containerd interface (CRI)
- **Boot**: Uses Firecracker or Cloud Hypervisor or QEMU as backend
- **Key value**: Docker compatibility — `docker run` → launches a microVM

## How Different Are the APIs?

### Current (Incus/QEMU)
```bash
# Create VM
incus init <image> <name> --vm
incus config set <name> limits.cpu 2
incus config set <name> limits.memory 4GiB
incus start <name>

# Execute inside
incus exec <name> -- bash -c "..."

# Lifecycle
incus stop <name>
incus delete <name> --force

# Snapshots
incus snapshot create <name> <snap-name>
incus snapshot restore <name> <snap-name>
incus publish <name> --alias <image-name>
```

### Firecracker (direct API)
```bash
# Start Firecracker process
./firecracker --api-sock /tmp/fc.sock

# Configure kernel + rootfs + network
curl --unix-socket /tmp/fc.sock -X PUT http://localhost/boot-source \
  -d '{"kernel_image_path":"./vmlinux","boot_args":"console=ttyS0 root=/dev/vda1"}'
  
curl --unix-socket /tmp/fc.sock -X PUT http://localhost/drives/rootfs \
  -d '{"drive_id":"rootfs","path_on_host":"./rootfs.ext4","is_root_device":true}'

curl --unix-socket /tmp/fc.sock -X PUT http://localhost/machine-config \
  -d '{"vcpu_count":2,"mem_size_mib":4096}'

curl --unix-socket /tmp/fc.sock -X PUT http://localhost/network-interfaces/eth0 \
  -d '{"iface_id":"eth0","guest_mac":"06:00:AC:10:00:02","host_dev_name":"tap0"}'

# Boot
curl --unix-socket /tmp/fc.sock -X PUT http://localhost/actions \
  -d '{"action_type":"InstanceStart"}'

# Snapshot (pause first)
curl --unix-socket /tmp/fc.sock -X PATCH http://localhost/vm \
  -d '{"state":"Paused"}'
curl --unix-socket /tmp/fc.sock -X PUT http://localhost/snapshot/create \
  -d '{"snapshot_type":"Full","snapshot_path":"./snap","mem_file_path":"./snap.mem"}'

# Restore from snapshot (new process)
./firecracker --api-sock /tmp/fc2.sock
curl --unix-socket /tmp/fc2.sock -X PUT http://localhost/snapshot/load \
  -d '{"snapshot_path":"./snap","mem_backend":{"backend_type":"File","backend_path":"./snap.mem"}}'
curl --unix-socket /tmp/fc2.sock -X PUT http://localhost/actions \
  -d '{"action_type":"Resume"}'
```

### Cloud Hypervisor
```bash
# Direct kernel boot (one command!)
./cloud-hypervisor \
  --kernel ./vmlinux \
  --disk path=rootfs.raw \
  --cmdline "console=hvc0 root=/dev/vda1 rw" \
  --cpus boot=2 \
  --memory size=4096M \
  --net "tap=tap0,mac=06:00:AC:10:00:02,ip=172.16.0.1,mask=255.255.255.252" \
  --api-socket /tmp/ch.sock

# Or via API
curl --unix-socket /tmp/ch.sock -X PUT http://localhost/api/v1/vm.create \
  -d '{"payload":{"kernel":"./vmlinux","cmdline":"..."},"cpus":{"boot_vcpus":2},"memory":{"size":4096}}'
curl --unix-socket /tmp/ch.sock -X PUT http://localhost/api/v1/vm.boot
```

## What You Get Out of the Box vs What You'd Build

| Feature | Incus (V2 now) | Firecracker | Cloud Hypervisor |
|---------|---------------|-------------|-----------------|
| Image management | ✅ built-in (publish, alias, cache) | ❌ build yourself (ext4 rootfs files) | ❌ build yourself (raw disk images) |
| Snapshots | ✅ `incus snapshot create/restore` | ✅ memory snapshot (pause+dump) | ✅ snapshot (pause+dump) |
| Live migration | ❌ | ❌ | ✅ built-in |
| Networking | ✅ managed bridge + DHCP | ❌ manual TAP + iptables + DHCP | ❌ manual TAP + iptables |
| Storage pools | ✅ ZFS/btrfs/LVM/dir | ❌ raw files only | ❌ raw files only |
| Container exec | ✅ `incus exec` (built-in agent) | ❌ SSH only (no agent) | ❌ SSH only (no agent) |
| Resource limits | ✅ `limits.cpu`, `limits.memory` | ✅ vcpu_count, mem_size_mib | ✅ cpus.boot, memory.size |
| Health/metrics | ✅ built-in metrics API | ❌ basic process metrics | ❌ basic metrics |
| Multi-tenant | ✅ projects, RBAC | ❌ one VM per process | ❌ one VM per process |
| GPU passthrough | ✅ vfio device | ❌ not supported | ✅ vfio device |
| Windows support | ✅ | ❌ | ✅ |
| Docker inside VM | ✅ (full VM) | ⚠️ limited (no nested KVM) | ⚠️ limited |
| OCI compat | ❌ | ❌ (but via Kata) | ❌ (but via Kata) |

### What you'd have to build custom for Firecracker

1. **Image management** — no concept of "images" or "golden templates". You manage raw ext4 files yourself. Need your own image build pipeline, versioning, distribution across hosts.

2. **Networking** — no managed networking. You create TAP devices, configure iptables NAT, manage DHCP yourself. Per-VM network setup is ~20 lines of bash.

3. **Exec/agent** — no equivalent of `incus exec`. You can only interact via SSH or serial console. Need your own agent inside the VM for file injection, command execution.

4. **Process management** — one Firecracker process per VM. You need your own process supervisor (systemd units, or a manager daemon) to track all running VMs.

5. **Storage** — no ZFS clone magic. You'd use `cp --reflink` on a btrfs/XFS filesystem for copy-on-write cloning, or manage overlay filesystems.

6. **Warm pool** — conceptually same as now, but instead of `incus init + start`, you'd `fork a firecracker process + load snapshot`.

7. **Health monitoring** — no built-in health checks. You'd monitor the Firecracker processes yourself.

## Performance Comparison

| Metric | QEMU (q35+OVMF) | QEMU (microvm) | Firecracker | Cloud Hypervisor |
|--------|-----------------|-----------------|-------------|-----------------|
| Cold boot | ~18s* | ~3-5s | ~125ms | ~200ms |
| Memory snapshot restore | N/A | N/A | ~5-50ms | ~50ms |
| Memory overhead per VM | ~200MB | ~50MB | ~5MB | ~10MB |
| VM density (64GB host) | ~20 VMs | ~100 VMs | ~1000 VMs | ~500 VMs |
| Warm pool boot | ~2.7s** | ~1-2s | not needed (snapshot) | not needed (snapshot) |

*Our current measurement on the Hetzner AX41
**With our warm pool optimization

## The QEMU `microvm` Machine Type

There's actually a middle ground we haven't tried yet: QEMU has a `microvm` machine type that's much lighter than the `q35` that Incus uses. It:
- Skips OVMF/BIOS firmware entirely
- Does direct kernel boot (like Firecracker)
- Has minimal device emulation
- Should boot in ~3-5s cold (vs our 18s with q35)

The problem: **Incus doesn't support the microvm machine type.** It hardcodes `q35`. So to use it we'd need to bypass Incus and call QEMU directly, which defeats the purpose of using Incus.

## Recommendation

### Short term (now): Stay on Incus/QEMU with warm pool
- 2.7s perceived boot time is competitive
- Full feature set (images, snapshots, exec, networking, ZFS)
- Minimal operational burden

### Medium term (V3): Cloud Hypervisor or Firecracker direct
- When you need >100 VMs per host (density)
- When you need sub-100ms cold starts (no warm pool dependency)
- When you want to eliminate warm pool RAM overhead
- Engineering effort: 6-10 weeks for a production-ready runnerd replacement

### Cloud Hypervisor vs Firecracker for V3
- **Cloud Hypervisor** if you want: live migration, GPU passthrough, Windows, more features
- **Firecracker** if you want: absolute minimum attack surface, maximum density, proven at AWS scale

### Kata Containers
- Use Kata if you want OCI/Docker compatibility (users `docker run` and get a microVM)
- Skip Kata if you're fine with your own API (which you are — you have the V2 API)
- Kata adds a layer of abstraction that's not needed if you control the whole stack

## Could We Test Firecracker E2E Right Now?

Yes. On the existing Hetzner host:

1. Download Firecracker binary (~5MB)
2. Extract kernel + rootfs from the golden image
3. Create TAP device + iptables NAT
4. Start a Firecracker microVM
5. Measure boot time
6. SSH in

The main work is steps 3-4 (manual networking). Everything else is a few curl commands. It would take ~1-2 hours to get a basic proof-of-concept running and measure real boot times on our hardware.

The question is whether it's worth doing now vs shipping what we have (2.7s warm pool) and evaluating Firecracker when density/cold-start becomes the bottleneck.
