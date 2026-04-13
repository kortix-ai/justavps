# Docker image container flow notes

Date: 2026-04-12

## Goal tested

Test whether a user can bring a plain Docker image and have JustAVPS container mode run it end-to-end on the live bare-metal Incus host.

## Live host facts

- Host: `135.181.129.188`
- Before upgrade: `Incus 6.0.6`
- After upgrade: `Incus 6.23`

## What changed to make Docker/OCI work

### Host substrate / bootstrap direction

The bootstrap path now targets the Zabbly **stable** Incus channel instead of pinning new hosts to `lts-6.0`, and installs the OCI helpers needed by Incus:

- `skopeo`
- `umoci`

The bootstrap also attempts to configure the Docker OCI remote:

- `incus remote add docker https://docker.io --protocol=oci`

### Runner behavior

`runnerd` now:

- accepts `docker:` OCI image refs
- auto-adds the Docker OCI remote if missing and supported by the host Incus build
- falls back with a clear error when the host lacks OCI support
- allocates a static bridge IPv4 for container launches so proxy NAT devices can attach successfully

## Before upgrade

### Direct OCI/Docker image ref

Attempted image reference:

- `docker:nginx:latest`

Result:

- failed

Reason:

- host `Incus 6.0.6` did not support OCI remotes on this build
- `incus remote add docker https://docker.io --protocol=oci` returned `Error: Invalid protocol: oci`

### Naive Docker export/import fallback

Method tested:

1. local `docker create nginx:latest`
2. local `docker export` to `rootfs.tar`
3. generate minimal `metadata.yaml`
4. `incus image import meta.tar.gz rootfs.tar --alias docker-nginx-import`

Result:

- import succeeded
- launch failed with:
  - `Error: Failed to run: /opt/incus/bin/incusd forkstart coherent-serval ... exit status 1`

Conclusion from that phase:

- naive Docker rootfs import is not an adequate substitute for native OCI support in this stack

## After upgrade / current result

### Direct runner benchmark

Command path tested:

- `RUNNER_BENCH_IMAGE=docker:nginx:latest`

Result:

- success
- benchmark payload:
  - `machine_mode: container`
  - `privateIpv4: 10.189.108.249`
  - `requested_ipv4: 10.189.108.249`
  - `total_ms: 3706`

### End-to-end access check

Flow tested:

1. create container through `runnerd` with image `docker:nginx:latest`
2. get returned host `httpPort`
3. curl `http://135.181.129.188:<httpPort>`

Result:

- success
- response body contained:
  - `Welcome to nginx!`

This proves the live path now works for a user-supplied Docker image on the upgraded host.

## Current truthful product statement

On hosts bootstrapped with the OCI-capable Incus stable channel:

- **JustAVPS container mode can now launch user Docker/OCI images directly**
- example proven live: `docker:nginx:latest`

On older `Incus 6.0.x` hosts:

- direct Docker/OCI refs are **not** supported
- they must be upgraded or re-bootstrapped to the stable channel first
