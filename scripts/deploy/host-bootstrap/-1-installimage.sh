#!/usr/bin/env bash
# Install Ubuntu 22.04 onto a freshly-delivered Hetzner host that's currently
# in Rescue mode. Uses Hetzner's installimage with a templated config so the
# install is fully unattended.
#
# Runs from inside Hetzner Rescue. After completion the host reboots into
# the installed Ubuntu; the rest of the bootstrap (00-prereqs.sh,
# 10-install-incus.sh, 20-configure-incus.sh) runs there.
#
# Inputs (env, all optional):
#   IMAGE_NAME   — installimage image name. Default Ubuntu-2404-noble.
#   HOSTNAME     — hostname for the installed system. Defaults to inherited.
#   DRIVE_GLOB   — glob for the target NVMe(s). Default /dev/nvme[0-9]n1.
#                  AX41-NVMe ships with 2 disks; we put them in software RAID 1.

set -euo pipefail

# Hetzner's installimage calls terminal helpers even in autosetup mode on some
# Rescue images. SSH non-interactive sessions may not set TERM, which makes
# those helpers return "Cancelled" before the destructive install starts.
export TERM="${TERM:-xterm}"

: "${IMAGE_NAME:=Ubuntu-2404-noble-amd64-base.tar.gz}"
: "${HOSTNAME:=$(hostname || true)}"
: "${DRIVE_GLOB:=/dev/nvme[0-9]n1}"

INSTALLIMAGE="$(command -v installimage || true)"
if [ -z "$INSTALLIMAGE" ] && [ -x /root/.oldroot/nfs/install/installimage ]; then
  INSTALLIMAGE=/root/.oldroot/nfs/install/installimage
fi

if [ -z "$INSTALLIMAGE" ]; then
  echo "installimage not found — are we in Hetzner Rescue?" >&2
  exit 1
fi

# Discover available disks, build the partition + RAID directives. Two-disk
# software RAID 1 across the drives is the standard for AX41-NVMe; falls
# back to single-disk if only one is present.
DRIVES=()
shopt -s nullglob
for d in $DRIVE_GLOB; do DRIVES+=("$d"); done
shopt -u nullglob
if [ ${#DRIVES[@]} -eq 0 ]; then
  echo "no drives matched glob $DRIVE_GLOB" >&2
  exit 1
fi

SWRAID_LEVEL=$([ ${#DRIVES[@]} -ge 2 ] && echo 1 || echo 0)
SWRAID=$([ ${#DRIVES[@]} -ge 2 ] && echo 1 || echo 0)

CFG=/tmp/installimage.config
{
  for i in "${!DRIVES[@]}"; do
    echo "DRIVE$((i+1)) ${DRIVES[$i]}"
  done
  echo "SWRAID $SWRAID"
  echo "SWRAIDLEVEL $SWRAID_LEVEL"
  echo "BOOTLOADER grub"
  echo "HOSTNAME ${HOSTNAME:-justavps-host}"
  if [ -d /sys/firmware/efi ]; then
    echo "PART /boot/efi esp 256M"
  fi
  # Big root, generous swap, /boot for grub. Filesystem is ext4 — we don't
  # need ZFS at the rootfs level; Incus ZFS pool is a separate disk volume
  # the post-install scripts create.
  echo "PART /boot ext4 1G"
  echo "PART swap swap 32G"
  echo "PART / ext4 all"
  echo "IMAGE /root/.oldroot/nfs/install/../images/$IMAGE_NAME"
} > "$CFG"

echo "[installimage] config:"
cat "$CFG"
echo

"$INSTALLIMAGE" -a -c "$CFG"
RC=$?
if [ $RC -ne 0 ]; then
  echo "[installimage] failed with rc=$RC" >&2
  exit $RC
fi

echo "[installimage] success — scheduling reboot so SSH can return success first"
sync
# Schedule the reboot a few seconds out and detach from the SSH session,
# so the runner gets a clean exit-0 before the kernel goes down. Without
# this, `reboot` kills our SSH and the runner sees exit 255 and treats
# the step as failed even though the install succeeded.
( sleep 5 && reboot ) </dev/null >/dev/null 2>&1 &
disown 2>/dev/null || true
exit 0
