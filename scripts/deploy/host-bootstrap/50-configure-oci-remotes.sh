#!/usr/bin/env bash
set -euo pipefail

if incus remote add docker https://docker.io --protocol=oci >/dev/null 2>&1; then
  echo '[bootstrap] docker OCI remote added'
else
  echo '[bootstrap] docker OCI remote unavailable on this Incus build or already configured'
fi
