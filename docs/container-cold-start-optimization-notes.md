# Container cold-start optimization notes

Date: 2026-04-12

## Live measured results on `135.181.129.188`

### Before fixes

- `images:ubuntu/noble/cloud` container path: ~`3955ms` to `3998ms`
- root cause: not using a JustAVPS container golden alias; path resolved to cached cloud container image

### After fixes

- `justavps-golden-container` alias path: `1637ms`, `1647ms`, `1854ms`
- same runner, no warm pool, same host, same benchmark harness

### Lower-bound experiment

- direct manual launch of cached `alpine/3.20` container on the same host:
  - `launch_ms=1207`
  - `ip_ready_ms=1612`

This shows the current floor is still mostly dominated by bridge/network/IP readiness rather than Ubuntu userspace alone.

## What changed

1. Added a real local container golden alias:
   - `justavps-golden-container -> 11ab90e65ced`
2. Changed container default resolution away from `ubuntu/noble/cloud` to:
   - `justavps-golden-container` if present
   - otherwise `images:ubuntu/noble`
3. Replaced multi-step `init -> config -> start` with a single `incus launch ... -c ... -d ...` path
4. Reduced IP readiness polling interval from `1000ms` to `100ms`
5. Added detailed stage timings to isolate where time is actually spent

## Current stage breakdown

Best measured JustAVPS golden-container run:

- `resolve_image_ms`: `20`
- `launch_ms`: `757`
- `instance_visible_ms`: `772`
- `ip_ready_ms`: `1541`
- `proxy_ms`: `1634`
- `total_ms`: `1637`

Direct Alpine lower-bound run:

- `launch_ms`: `1207`
- `ip_ready_ms`: `1612`

Additional direct host experiments:

- **no network attached at all**
  - `launch_ms=667`
  - instance already `RUNNING`
- **static IPv4 reservation on `incusbr0`**
  - `launch_ms=706`
  - `ip_ready_ms=1483`

Interpretation:

- removing networking entirely drops cold start to well under `1s`
- keeping bridged networking but replacing dynamic DHCP with static IPv4 only recovers ~`50–60ms`
- therefore the dominant floor is not image unpack or API overhead anymore; it is the bridged container network bring-up path itself

## What is still dominating

Even after image + launch-path optimization, the biggest remaining cost is:

- bridge network bring-up / DHCP / IP visibility

That matches Incus networking behavior where bridge-backed instances rely on Incus-managed address allocation and dnsmasq/DHCP plumbing, and cloud-init/network defaults often expect DHCP on `eth0`.

## Highest-impact methods to reduce cold start further

Ordered by expected impact on this stack:

1. **Use a pre-published local non-cloud container golden image**
   - done
   - biggest win already realized

2. **Collapse create/start/hardening into one `incus launch` call**
   - done
   - removes multiple Incus API round trips

3. **Avoid cloud images when cloud-init is not needed**
   - done
   - `ubuntu/noble` materially outperformed `ubuntu/noble/cloud`

4. **Reduce DHCP / bridge wait time**
   - next likely frontier
   - candidates:
     - static IPv4 allocation at launch
     - faster network profile/device setup
     - alternative NIC mode/profile if product constraints allow it
   - note: a simple per-instance static IPv4 device override was attempted on the current bridge/profile path and failed, so this needs a more deliberate profile/network design rather than a trivial launch flag.
   - after direct host testing, static IPv4 on the bridge helps only marginally; the bigger issue appears to be the general bridge/NIC bring-up path rather than DHCP lease assignment alone.

5. **Use lighter userspace images**
   - research candidate only
   - Alpine-class images may reduce launch and early userspace cost, but product/runtime compatibility must be validated

6. **Use storage/network settings optimized for clone-heavy local launch**
   - storage driver and image layout matter
   - local snapshot/clone friendly storage generally helps container cold start

7. **Decouple “ready enough for allocation” from slower optional host wiring**
   - only if product semantics allow it
   - honest readiness definition required

## Why sub-1s is hard on current stack

With current constraints:

- real cold launch
- no warm pool
- bridge network
- wait until instance has a usable IP
- host proxy wiring included

the network/IP readiness phase alone is currently about `1.5s` on the live host. That means sub-1s cold start is unlikely without changing one or more of:

- network model
- readiness definition
- image/userspace footprint
- substrate/runtime strategy

## Research pointers

Sources used while investigating:

1. Incus instance options / cloud-init defaults
   - https://linuxcontainers.org/incus/docs/main/reference/instance_options/
2. Incus cloud-init behavior
   - https://linuxcontainers.org/incus/docs/main/cloud-init/
3. Incus forum discussion around bridge/DHCP/dnsmasq behavior
   - https://discuss.linuxcontainers.org/t/recommended-configuration-for-cluster-setup-with-dhcp-dns-managed-by-incus/26183
