#!/usr/bin/env bash
set -euo pipefail

: "${INCUS_STORAGE_POOL:=default}"
: "${INCUS_MANAGED_NETWORK:=incusbr0}"

: "${JUSTAVPS_INCUS_PLATFORM_PROJECT:=justavps-platform}"
: "${JUSTAVPS_INCUS_OPERATOR_PROJECT:=justavps-operator}"

: "${JUSTAVPS_INCUS_CONTAINER_DEFAULT_PROFILE:=platform-container-default}"
: "${JUSTAVPS_INCUS_CONTAINER_HARDENED_PROFILE:=platform-container-hardened}"
: "${JUSTAVPS_INCUS_VM_DEFAULT_PROFILE:=platform-vm-default}"
: "${JUSTAVPS_INCUS_WARM_POOL_PROFILE:=platform-warm-pool}"
: "${JUSTAVPS_INCUS_OPERATOR_DEBUG_PROFILE:=platform-operator-debug}"

: "${JUSTAVPS_PLATFORM_LIMITS_INSTANCES:=512}"
: "${JUSTAVPS_PLATFORM_LIMITS_CPU:=$(nproc || printf '64')}"
: "${JUSTAVPS_PLATFORM_LIMITS_DISK:=2TiB}"

ensure_profile() {
  local profile_name="$1"
  local profile_doc="$2"
  local tmp_file

  tmp_file="$(mktemp)"
  trap 'rm -f "$tmp_file"' RETURN

  if ! incus profile show "$profile_name" >/dev/null 2>&1; then
    incus profile create "$profile_name" >/dev/null
  fi

  printf '%s\n' "$profile_doc" >"$tmp_file"
  incus profile edit "$profile_name" <"$tmp_file" >/dev/null
}

ensure_project() {
  local project_name="$1"
  if ! incus project show "$project_name" >/dev/null 2>&1; then
    incus project create "$project_name" >/dev/null
  fi
}

ensure_profile "$JUSTAVPS_INCUS_CONTAINER_DEFAULT_PROFILE" "$(cat <<EOF
config:
  security.idmap.isolated: "true"
  security.nesting: "false"
  security.privileged: "false"
  user.justavps.profile_class: "container-default"
description: JustAVPS baseline defaults for container workloads.
devices: {}
EOF
 )"

ensure_profile "$JUSTAVPS_INCUS_CONTAINER_HARDENED_PROFILE" "$(cat <<EOF
config:
  security.syscalls.intercept.mount: "false"
  security.syscalls.intercept.setxattr: "false"
  user.justavps.hardening: "baseline"
  user.justavps.profile_class: "container-hardened"
description: JustAVPS hardened container posture for customer workloads.
devices: {}
EOF
 )"

ensure_profile "$JUSTAVPS_INCUS_VM_DEFAULT_PROFILE" "$(cat <<EOF
config:
  user.justavps.profile_class: "vm-default"
description: JustAVPS baseline defaults for VM workloads.
devices: {}
EOF
 )"

ensure_profile "$JUSTAVPS_INCUS_WARM_POOL_PROFILE" "$(cat <<EOF
config:
  boot.autostart: "false"
  user.justavps.pool_role: "warm-pool"
  user.justavps.profile_class: "warm-pool"
description: JustAVPS warm-pool reserve instance posture.
devices: {}
EOF
 )"

ensure_profile "$JUSTAVPS_INCUS_OPERATOR_DEBUG_PROFILE" "$(cat <<EOF
config:
  user.justavps.profile_class: "operator-debug"
description: JustAVPS operator-only debug profile.
devices: {}
EOF
 )"

ensure_project "$JUSTAVPS_INCUS_PLATFORM_PROJECT"
incus project set "$JUSTAVPS_INCUS_PLATFORM_PROJECT" features.images false >/dev/null
incus project set "$JUSTAVPS_INCUS_PLATFORM_PROJECT" features.profiles false >/dev/null
incus project set "$JUSTAVPS_INCUS_PLATFORM_PROJECT" features.networks false >/dev/null
incus project set "$JUSTAVPS_INCUS_PLATFORM_PROJECT" features.storage.volumes false >/dev/null
incus project set "$JUSTAVPS_INCUS_PLATFORM_PROJECT" limits.instances "$JUSTAVPS_PLATFORM_LIMITS_INSTANCES" >/dev/null
incus project set "$JUSTAVPS_INCUS_PLATFORM_PROJECT" limits.cpu "$JUSTAVPS_PLATFORM_LIMITS_CPU" >/dev/null
incus project set "$JUSTAVPS_INCUS_PLATFORM_PROJECT" limits.disk "$JUSTAVPS_PLATFORM_LIMITS_DISK" >/dev/null

ensure_project "$JUSTAVPS_INCUS_OPERATOR_PROJECT"
incus project set "$JUSTAVPS_INCUS_OPERATOR_PROJECT" features.images false >/dev/null
incus project set "$JUSTAVPS_INCUS_OPERATOR_PROJECT" features.profiles false >/dev/null
incus project set "$JUSTAVPS_INCUS_OPERATOR_PROJECT" features.networks false >/dev/null
incus project set "$JUSTAVPS_INCUS_OPERATOR_PROJECT" features.storage.volumes false >/dev/null
incus project set "$JUSTAVPS_INCUS_OPERATOR_PROJECT" restricted false >/dev/null
