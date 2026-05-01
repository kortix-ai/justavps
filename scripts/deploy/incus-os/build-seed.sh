#!/usr/bin/env bash
# Build an IncusOS seed.tar from a cluster-join token. Output is a base64
# blob suitable for passing to install-from-rescue.sh as
# INCUS_OS_SEED_TAR_B64.
#
# Inputs (env, all required):
#   CLUSTER_JOIN_TOKEN   — base64-encoded join token minted by the leader
#                          (POST /1.0/cluster/members on the running cluster).
#   MEMBER_NAME          — the name the new node will register as. Must
#                          match the server_name the token was minted for.
#   STORAGE_POOL_NAME    — usually "zfs-pool". The seed config bootstraps
#                          this pool on the new node.
#   STORAGE_POOL_SOURCE  — backing for the pool. For loopback ZFS use a
#                          file path; for raw devices use /dev/diskN.
#                          Default: /var/lib/incus/disks/zfs-pool.img
#   HTTPS_ADDRESS        — what the new node binds Incus' HTTPS API to.
#                          Default: ":8443"
#
# IncusOS first-boot consumes seed.tar from the seed partition and treats
# it as `incus admin init --preseed` input plus an optional tar of files
# to drop into the rootfs (for SSH keys, etc.). We only emit the preseed
# YAML here — that's all the cluster join needs.

set -euo pipefail

: "${STORAGE_POOL_NAME:=zfs-pool}"
: "${STORAGE_POOL_SOURCE:=/var/lib/incus/disks/zfs-pool.img}"
: "${HTTPS_ADDRESS:=":8443"}"

if [ -z "${CLUSTER_JOIN_TOKEN:-}" ] || [ -z "${MEMBER_NAME:-}" ]; then
  echo "CLUSTER_JOIN_TOKEN and MEMBER_NAME are required" >&2
  exit 2
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Preseed YAML — minimal join. `member_config` is needed because Incus
# requires per-member storage pool config to be supplied on join (the
# pool definition itself is cluster-wide, but the source path is per-host).
cat > "$WORK/preseed.yaml" <<EOF
cluster:
  enabled: true
  cluster_token: ${CLUSTER_JOIN_TOKEN}
  server_name: ${MEMBER_NAME}
  member_config:
  - entity: storage-pool
    name: ${STORAGE_POOL_NAME}
    key: source
    value: ${STORAGE_POOL_SOURCE}
config:
  core.https_address: "${HTTPS_ADDRESS}"
EOF

# Tar it up the way IncusOS expects: a single seed.tar containing the
# preseed at a known path. Exact layout follows IncusOS docs; if a release
# changes the path we update here in one place.
( cd "$WORK" && tar -cf seed.tar preseed.yaml )

base64 < "$WORK/seed.tar"
