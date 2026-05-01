#!/usr/bin/env bash
# Install IncusOS onto a Hetzner dedicated host that is currently booted
# into Hetzner's Rescue mode (or any minimal Linux environment with `wget`,
# `gunzip`, `dd`, `parted`, and root). This script is driven over SSH by
# apps/v2-api/src/services/nodeProvisioning.ts.
#
# Inputs (env):
#   INCUS_OS_IMAGE_URL      — URL to the gzipped raw image. Defaults to
#                             linuxcontainers' latest. Pin to a specific
#                             release in production.
#   INCUS_OS_TARGET_DEVICE  — Block device to flash. Default /dev/nvme0n1.
#                             AX41 / AX42 boxes use nvme0n1; older HDD
#                             boxes use sda. Operator-supplied.
#   INCUS_OS_SEED_TAR_B64   — Optional base64-encoded seed.tar that the
#                             runner builds via build-seed.sh. If set, the
#                             tarball is dropped at the appropriate location
#                             inside the IncusOS image's seed partition
#                             before reboot. Without it, IncusOS comes up
#                             with no preconfig and the runner falls back
#                             to a manual cluster join after first boot.
#   INCUS_OS_SKIP_REBOOT    — If "1", skip the reboot at the end. Useful
#                             for debugging the flash without losing SSH.
#
# Behavior is fail-fast: if any step errors, the script exits non-zero and
# the runner records the failure. Re-running is safe — the script re-flashes
# from scratch and the host comes back up with a fresh IncusOS install.

set -euo pipefail

: "${INCUS_OS_IMAGE_URL:=https://images.linuxcontainers.org/os/202604261712/x86_64/IncusOS_202604261712.img.gz}"
: "${INCUS_OS_TARGET_DEVICE:=/dev/nvme0n1}"
: "${INCUS_OS_SKIP_REBOOT:=0}"

log() { printf '[incus-os] %s\n' "$*"; }

# Validate environment ────────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
  log "must run as root (currently uid=$(id -u))"
  exit 1
fi
if [ ! -b "$INCUS_OS_TARGET_DEVICE" ]; then
  log "target device $INCUS_OS_TARGET_DEVICE is not a block device. Pick a real disk."
  exit 1
fi
for tool in wget gunzip dd parted; do
  command -v "$tool" >/dev/null 2>&1 || { log "missing required tool: $tool"; exit 1; }
done

# Sanity: refuse to flash a disk that's currently the booted root. Hetzner
# Rescue boots from a small tmpfs/initrd, so the target NVMe should NOT be
# in use as / — this guards against accidentally running this on a live
# host.
ROOT_SRC="$(findmnt -no SOURCE / || true)"
if [ -n "$ROOT_SRC" ] && [ "${ROOT_SRC#"$INCUS_OS_TARGET_DEVICE"}" != "$ROOT_SRC" ]; then
  log "refusing to flash $INCUS_OS_TARGET_DEVICE — it is the live root ($ROOT_SRC). Boot into rescue first."
  exit 1
fi

# Download the image, stream-decompress directly to the target device. We
# never land the .img on disk in rescue's tmpfs because rescue is a small
# RAM filesystem and the IncusOS image can be a few GB.
log "downloading + flashing $INCUS_OS_IMAGE_URL → $INCUS_OS_TARGET_DEVICE"
wget -q -O - "$INCUS_OS_IMAGE_URL" | gunzip -c | dd of="$INCUS_OS_TARGET_DEVICE" bs=64M oflag=direct status=progress
log "flash complete; syncing"
sync

# Re-read the partition table the kernel got mid-flash.
partprobe "$INCUS_OS_TARGET_DEVICE" || true

# Optionally inject the seed tarball into the seed partition so first boot
# joins the cluster without manual intervention. The seed partition is the
# small FAT-ish partition that IncusOS reads on boot — typically partition
# 1, but we discover it by label rather than hardcoding the index in case
# IncusOS reshuffles the layout in a future release.
if [ -n "${INCUS_OS_SEED_TAR_B64:-}" ]; then
  SEED_PART="$(blkid -L incus-seed 2>/dev/null || true)"
  if [ -z "$SEED_PART" ]; then
    log "warn: no partition labeled 'incus-seed' found; falling back to ${INCUS_OS_TARGET_DEVICE}p1"
    SEED_PART="${INCUS_OS_TARGET_DEVICE}p1"
  fi
  log "injecting seed.tar into $SEED_PART"
  MOUNT_DIR="$(mktemp -d)"
  mount "$SEED_PART" "$MOUNT_DIR"
  printf '%s' "$INCUS_OS_SEED_TAR_B64" | base64 -d > "$MOUNT_DIR/seed.tar"
  sync
  umount "$MOUNT_DIR"
  rmdir "$MOUNT_DIR"
fi

if [ "$INCUS_OS_SKIP_REBOOT" = "1" ]; then
  log "skip-reboot set; install complete (manual reboot needed)"
  exit 0
fi

log "rebooting into IncusOS"
# Sync once more, then schedule the reboot via systemctl if available, else
# raw `reboot`. Both signal the kernel to bring the host back up off the
# freshly flashed disk. Hetzner Robot's Rescue → installed boot transition
# is automatic — the BIOS sees the NVMe is now bootable.
sync
if command -v systemctl >/dev/null 2>&1; then
  systemctl reboot
else
  reboot
fi
