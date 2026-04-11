# Incus feature map for a large VPS platform

## Scope and framing

This document maps Incus capabilities to what JustAVPS would actually need for a serious VPS/cloud business. The key distinction is that Incus is a strong infrastructure substrate, but it is not itself a commercial cloud control plane. It gives us clustered VM/container orchestration, storage, networking, images, backup/export, projects, profiles, API/events/metrics, and authorization primitives; we still need platform logic for products, billing, quota policy, admission control, host procurement, customer workflows, SLOs, and abuse handling ([Incus overview](https://linuxcontainers.org/incus/docs/main/), [Projects](https://linuxcontainers.org/incus/docs/main/explanation/projects/), [Authorization](https://linuxcontainers.org/incus/docs/main/authorization/)).

## Executive summary

- **Incus is highly viable as the substrate for a multi-million-dollar VPS business** if we stay opinionated: VMs first, mostly homogeneous host classes, local NVMe-first designs, strong project/profile conventions, and our own control plane for scheduling, billing, lifecycle orchestration, and support workflows ([Incus overview](https://linuxcontainers.org/incus/docs/main/), [About clustering](https://linuxcontainers.org/incus/docs/main/explanation/clustering/), [About storage pools, volumes and buckets](https://linuxcontainers.org/incus/docs/main/explanation/storage/)).
- **Most relevant now:** clustering, projects, profiles, image pipelines, ZFS/local storage, snapshots/export backups, per-node metrics scraping, TLS auth, restricted certificates, OVN only where multi-tenant virtual networking really needs it, and explicit platform-side scheduling/host-class rules ([About clustering](https://linuxcontainers.org/incus/docs/main/explanation/clustering/), [How to use profiles](https://linuxcontainers.org/incus/docs/main/profiles/), [How to monitor metrics](https://linuxcontainers.org/incus/docs/main/metrics/), [OVN network](https://github.com/lxc/incus/blob/main/doc/reference/network_ovn.md)).
- **Relevant later:** OpenFGA, placement scriptlets, OVN load balancers/peers/zones, remote/distributed storage backends, storage buckets, and more advanced multi-user confinement patterns ([Authorization](https://linuxcontainers.org/incus/docs/main/authorization/), [About clustering](https://linuxcontainers.org/incus/docs/main/explanation/clustering/), [About storage pools, volumes and buckets](https://linuxcontainers.org/incus/docs/main/explanation/storage/), [OVN network](https://github.com/lxc/incus/blob/main/doc/reference/network_ovn.md)).
- **Probably avoid initially:** Ceph/LINSTOR/LVM cluster unless a clear business requirement justifies the operational burden; bridge ACL designs for tenant isolation; and any belief that Incus automatic placement alone is enough for commercial-grade capacity management ([About storage pools, volumes and buckets](https://linuxcontainers.org/incus/docs/main/explanation/storage/), [How to configure network ACLs](https://linuxcontainers.org/incus/docs/main/howto/network_acls/), [About clustering](https://linuxcontainers.org/incus/docs/main/explanation/clustering/)).

## Decision matrix: now vs later vs probably avoid

| Area | Use now | Use later | Probably avoid initially | Why |
| --- | --- | --- | --- | --- |
| Compute isolation | **Incus VMs** | Containers for trusted/internal workloads | Public multi-tenant containers first | VMs match VPS semantics and stronger isolation expectations ([Incus overview](https://linuxcontainers.org/incus/docs/main/)). |
| Clustering | **Yes** | More advanced cluster groups / scriptlets | Single huge heterogeneous cluster | Cluster gives fleet abstraction, but mixed CPU/platforms hurt migration and scheduling ([About clustering](https://linuxcontainers.org/incus/docs/main/explanation/clustering/)). |
| Projects | **Yes** | User-confined project models | Shared default project for customer workloads | Projects are the cleanest tenant/environment boundary Incus gives us ([About projects](https://linuxcontainers.org/incus/docs/main/explanation/projects/)). |
| Profiles | **Yes** | Deeper per-product composition | Per-instance snowflakes | Profiles let us standardize disk/network/limits and rollout changes consistently ([How to use profiles](https://linuxcontainers.org/incus/docs/main/profiles/)). |
| Networking | **Managed bridge + simple routed/public IP patterns** | OVN for richer tenant networks | OVN everywhere on day 1 | OVN is powerful, but carries more moving parts than simple VPS networking needs ([OVN network](https://github.com/lxc/incus/blob/main/doc/reference/network_ovn.md), [How to configure network ACLs](https://linuxcontainers.org/incus/docs/main/howto/network_acls/)). |
| Storage | **Local ZFS or similarly simple local backend** | Remote storage for special products | Ceph/LINSTOR by default | Simple local storage best matches early-stage operational simplicity ([About storage pools, volumes and buckets](https://linuxcontainers.org/incus/docs/main/explanation/storage/), [Incus storage](https://github.com/lxc/incus/blob/main/doc/explanation/storage.md)). |
| Backups | **Snapshots + export/copy + full host backups** | Secondary Incus backup clusters | Snapshots as backup strategy | Docs explicitly say snapshots alone are not secure backups ([How to back up an Incus server](https://linuxcontainers.org/incus/docs/main/backup/)). |
| AuthZ | **TLS + restricted certs + project restrictions** | OpenFGA | Broad admin/operator grants to customers | Incus warns several relations effectively imply host-root risk ([Authorization](https://linuxcontainers.org/incus/docs/main/authorization/)). |
| Observability | **Metrics + events + host-level scraping** | Richer analytics and autoscaling | Single-endpoint cluster scraping assumptions | Each cluster member must be scraped separately for metrics ([How to monitor metrics](https://linuxcontainers.org/incus/docs/main/metrics/)). |
| Migration / healing | **Planned relocation + cold failover playbooks** | Live migration for compatible host classes | Assuming seamless migration across heterogeneous fleet | Live VM migration depends on CPU baseline compatibility ([Migration](https://linuxcontainers.org/incus/docs/main/migration/), [About clustering](https://linuxcontainers.org/incus/docs/main/explanation/clustering/)). |

## Core Incus features we should consider using

### 1. Clustering

Incus clustering is one of the most strategically useful features for a VPS platform. It gives a unified API and distributed database across members, supports cluster groups, can replicate images, and has leader/voter/standby roles for quorum-backed control-plane resilience ([About clustering](https://linuxcontainers.org/incus/docs/main/explanation/clustering/)).

**Why it matters now**

- We need a fleet abstraction across multiple bare-metal hosts, not one Incus daemon per host with custom glue.
- Cluster groups map naturally to host classes, regions, GPU pools, or CPU-generation buckets.
- The `cluster.images_minimal_replica` setting matters for reducing cold-start/image-fetch risk on busy nodes ([About clustering](https://linuxcontainers.org/incus/docs/main/explanation/clustering/), [Incus cluster config](https://github.com/lxc/incus/blob/main/doc/explanation/clustering.md)).

**Sharp edges**

- Cluster members are assumed to be broadly identical in storage/network definitions, with only some member-specific exceptions; this pushes us toward strong host-class standardization ([About clustering](https://linuxcontainers.org/incus/docs/main/explanation/clustering/)).
- If a member is offline, operations needing state changes across all members can be blocked until it returns or is removed; this is not a magical hyperscaler control plane ([About clustering](https://linuxcontainers.org/incus/docs/main/explanation/clustering/)).
- VM live migration depends on CPU compatibility. Mixed vendors/generations can break the automatic baseline, and the docs explicitly recommend cluster groups per platform in mixed environments ([About clustering](https://linuxcontainers.org/incus/docs/main/explanation/clustering/)).

**Platform logic still required**

- Commercial scheduler with RAM/CPU/disk oversubscription policy, anti-affinity, reserved capacity, and “sellability” checks.
- Host procurement/retirement workflow.
- Region-level admission control and customer-visible capacity states.

### 2. Projects

Projects are the cleanest built-in multi-tenant boundary Incus offers. They isolate instances by default and can isolate or inherit images, profiles, networks, and storage depending on feature flags ([About projects](https://linuxcontainers.org/incus/docs/main/explanation/projects/)).

**Recommended use**

- Use **one project per internal environment or fleet slice**, not necessarily one Incus project per paying customer at first.
- For a VPS business, a practical pattern is to use projects for platform-defined isolation domains (for example region × substrate generation × environment), while JustAVPS maintains customer/account semantics above that.

**Why not map projects 1:1 to all product concepts immediately**

- Project features are effectively chosen before the project is populated; once a project contains instances, feature toggles are locked until instances are removed ([About projects](https://linuxcontainers.org/incus/docs/main/explanation/projects/)).
- This makes projects a strong infrastructure boundary, but a poor substitute for flexible business/account modeling.

**Platform logic still required**

- Customer/account model, quotas by plan, suspended-account behavior, invoice state, support access, and abuse escalations.

### 3. Profiles

Profiles are essential operational primitives for productization. They encapsulate instance options, devices, and root-disk/network defaults; multiple profiles can be layered, and instance-specific config overrides profile config ([How to use profiles](https://linuxcontainers.org/incus/docs/main/profiles/)).

**Recommended use now**

- Create composable profiles for base VM defaults, network pattern, storage class, monitoring/agent devices, and product-specific toggles.
- Keep customer instances mostly profile-driven rather than hand-configured.

**Business value**

- Safer rollout surface for product changes.
- Cleaner mapping from internal plan/template concepts to substrate configuration.

**Platform logic still required**

- Versioning policy for profiles, rollout orchestration, canary rules, and migration plans when profile changes should not retroactively hit all machines.

## Networking

### 4. Managed networks, OVN, ACLs, and public-IP design

Incus supports multiple network types, but for a VPS platform the practical choice is between simpler managed networking and OVN-backed logical networks. OVN is explicitly positioned as a software-defined system useful for private cloud and multi-tenant environments, with support for ACLs, forwards, integrations, zones, peers, and load balancers ([OVN network](https://github.com/lxc/incus/blob/main/doc/reference/network_ovn.md)).

**What is highly relevant now**

- Managed bridges or simple routed/public-IP designs for baseline VPS products.
- ACL support where we need substrate-enforced policy.
- A conservative path where OVN is used only for products that truly need tenant-isolated virtual networking, private subnets, or richer internal networking semantics.

**What is relevant later**

- OVN peers for routing relationships between logical networks.
- OVN load balancers for higher-level networking products.
- Network zones/integrations if we grow toward private-cloud-style offerings ([OVN network](https://github.com/lxc/incus/blob/main/doc/reference/network_ovn.md)).

### 5. ACLs and security controls

ACLs can be attached to networks or NICs, with rule actions, selectors, address sets, logging, and default ingress/egress behavior. For OVN NICs and OVN networks, ACL selectors are much more capable than on standard bridges ([How to configure network ACLs](https://linuxcontainers.org/incus/docs/main/howto/network_acls/), [OVN network](https://github.com/lxc/incus/blob/main/doc/reference/network_ovn.md)).

**Important limitation**

- Bridge ACLs have meaningful limitations: they are generally boundary controls rather than full intra-bridge firewalls, with notable exceptions/constraints depending on firewall backend. For serious tenant isolation policy, OVN is stronger than bridge ACLs ([How to configure network ACLs](https://linuxcontainers.org/incus/docs/main/howto/network_acls/)).

**Platform logic still required**

- Product-specific firewall UX.
- DDoS/abuse workflows.
- Public-IP lifecycle, PTR, floating IP products, and bandwidth accounting.

## Storage

### 6. Storage pools and backends

Incus supports a wide range of storage drivers: `dir`, `btrfs`, `lvm`, `lvmcluster`, `zfs`, `ceph`, `cephfs`, `cephobject`, `linstor`, and `truenas` ([About storage pools, volumes and buckets](https://linuxcontainers.org/incus/docs/main/explanation/storage/), [Incus storage](https://github.com/lxc/incus/blob/main/doc/explanation/storage.md)).

**Best fit now**

- **Local ZFS on NVMe** is usually the strongest early fit for a VPS company: simple, performant, snapshot-friendly, and operationally much easier than distributed storage.
- `dir` is too bare-bones for a serious VM business except maybe dev/test.
- LVM can work, but ZFS generally fits image/snapshot/template-heavy VM operations better.

**Later-stage candidates**

- Ceph/LINSTOR only when product strategy truly requires shared/distributed storage semantics or faster host replacement with storage independence.

**Probably avoid initially**

- LVM cluster and distributed backends as the default foundation. They increase failure modes, operational load, and debugging surface before we have enough scale benefit to justify them ([About storage pools, volumes and buckets](https://linuxcontainers.org/incus/docs/main/explanation/storage/)).

### 7. Volumes, content types, and quotas

Incus distinguishes instance volumes, image volumes, and custom volumes, with `filesystem`, `block`, and `iso` content types. VM images and VM-attached custom volumes use `block` semantics; shared block attachment is explicitly unsafe for simultaneous multi-instance use ([About storage pools, volumes and buckets](https://linuxcontainers.org/incus/docs/main/explanation/storage/), [Incus storage volume content types](https://github.com/lxc/incus/blob/main/doc/explanation/storage.md)).

**Practical relevance**

- Custom volumes can support attached data-disk products.
- ISO support is useful for rescue/installer style workflows.
- Image volumes and optimized image storage matter for clone speed and warm provisioning.

**Platform logic still required**

- Product quotas and billable disk entitlements.
- Resize policy, filesystem growth UX, snapshot retention policy, and “backup storage consumed” billing.

## Images and templates

### 8. Images

Images are strategically important because Incus is optimized around image-based instance launch. Projects can isolate or inherit images; images can be associated with profiles; and clusters can replicate images to reduce launch latency ([About projects](https://linuxcontainers.org/incus/docs/main/explanation/projects/), [About clustering](https://linuxcontainers.org/incus/docs/main/explanation/clustering/), [Incus overview](https://linuxcontainers.org/incus/docs/main/)).

**Use now**

- Golden-image pipeline for JustAVPS-supported templates.
- Cluster image replication tuned enough to reduce cross-node misses.
- Product-level distinction between official images, custom images, and imported snapshots.

**Platform logic still required**

- Image catalog curation, metadata, deprecation, CVE response, and customer image access rules.

## Snapshots, backups, and disaster recovery

### 9. Snapshots and exports

Incus supports snapshots, instance export tarballs, storage-volume exports, and copying/moving instances or volumes to a secondary Incus server. Docs are explicit that snapshots are stored in the same pool and therefore are **not** secure backups on their own ([How to back up an Incus server](https://linuxcontainers.org/incus/docs/main/backup/), [Incus backup methods](https://github.com/lxc/incus/blob/main/doc/backup.md)).

**Recommended now**

- Offer snapshots as a convenience feature.
- Build real backups around export/copy to secondary storage or secondary Incus infrastructure.
- Back up both `/var/lib/incus` and any external storage separately; Incus docs explicitly warn that backing up only DB or only files is insufficient ([How to back up an Incus server](https://linuxcontainers.org/incus/docs/main/backup/)).

### 10. Disaster recovery

Incus has disaster recovery tooling that can scan storage pools and reconstruct instance DB records using `backup.yaml`, but the docs warn this is for disaster recovery only and cannot replace proper backups. Missing entities like projects, profiles, and networks may need to be recreated manually, and the tool is interactive rather than automation-friendly ([How to recover instances in case of disaster](https://linuxcontainers.org/incus/docs/main/howto/disaster_recovery/)).

**Implication for JustAVPS**

- Incus recovery helps reduce worst-case data loss, but our production recovery plan must not depend on it as the normal path.
- We need tested, automated restoration playbooks outside the raw Incus recovery helper.

## Migration and mobility

### 11. Instance migration

Incus supports moving instances between servers and can live-migrate virtual machines with no downtime when conditions permit. It also provides `incus-migrate` for importing existing physical/virtual machines and `lxc-to-incus` for LXC migrations ([Migration](https://linuxcontainers.org/incus/docs/main/migration/)).

**High relevance now**

- Use migration for maintenance operations and hardware refreshes inside compatible host classes.
- Use cold migration/copy as a fallback path.

**Limits**

- Do not sell a “live migrate anywhere” promise. CPU compatibility and cluster baseline constraints mean mobility is conditional, not universal ([About clustering](https://linuxcontainers.org/incus/docs/main/explanation/clustering/), [Migration](https://linuxcontainers.org/incus/docs/main/migration/)).

**Platform logic still required**

- Customer communication windows, maintenance scheduling, migration eligibility checks, and rollback policies.

## Security, authentication, and authorization

### 12. Authentication

Incus exposes a remote API over HTTPS and commonly authenticates clients using TLS trust relationships and trust tokens. Cluster-wide certificate updates are supported, including ACME-driven deployment for cluster certificates ([How to expose Incus to the network](https://github.com/lxc/incus/blob/main/doc/howto/server_expose.md), [How to access a cluster](https://github.com/lxc/incus/blob/main/doc/howto/cluster_access.md), [Incus docs index](https://linuxcontainers.org/incus/docs/main/)).

**Use now**

- Keep Incus API private to platform components.
- Use machine identities/certs, not direct customer access, for the primary JustAVPS control plane.

### 13. Authorization / RBAC

Incus supports three meaningful authorization modes for network access: restricted TLS authorization, OpenFGA, and authorization scriptlets. OpenFGA is notably granular and can restrict access down to an individual instance, while TLS restrictions are simpler and project-oriented ([Authorization](https://linuxcontainers.org/incus/docs/main/authorization/)).

**Use now**

- Restricted TLS clients bound to specific projects/services for internal components.
- Very tight separation between substrate admins and application services.

**Use later**

- OpenFGA if JustAVPS eventually wants direct, fine-grained delegated access patterns.

**Important warning**

- The docs explicitly warn that several server- and storage-level permissions should not be granted to users not trusted with host root access ([Authorization](https://linuxcontainers.org/incus/docs/main/authorization/)). This is a strong signal that Incus authorization is valuable, but still not the right customer-facing multi-tenant security boundary by itself.

## Operations, healing, events, and metrics

### 14. Healing / evacuation / failure handling

Incus can mark members offline after `cluster.offline_threshold`, elect new leaders, and optionally evacuate instances from offline members when `cluster.healing_threshold` is set non-zero ([About clustering](https://linuxcontainers.org/incus/docs/main/explanation/clustering/)).

**What this means in practice**

- Useful for automated response to node loss.
- Not equivalent to application-aware self-healing. We still need our own notions of host health, VM health, safe eviction windows, and customer comms.

### 15. Metrics and events

Incus exposes rich instance metrics for CPU, memory, disk, network, filesystem, and OOM/process visibility, intended for Prometheus/Grafana. Metrics are per-server in cluster mode, so every member must be scraped individually ([How to monitor metrics](https://linuxcontainers.org/incus/docs/main/metrics/), [Provided metrics](https://github.com/lxc/incus/blob/main/doc/reference/provided_metrics.md)).

**High relevance now**

- Scrape every host/member.
- Use Incus metrics as substrate telemetry, not as the whole observability stack.
- Combine with host-level metrics, app-level events, and JustAVPS business telemetry.

**Platform logic still required**

- SLA dashboards, incident correlation, alert routing, customer-visible status pages, and capacity forecasting.

### 16. API and automation

Incus is strongly API-first and includes a REST API, events API, metrics API, and cluster query surfaces. Cluster placement can also be customized through Starlark scriptlets that inspect project, member state, and resource information during placement decisions ([Incus overview](https://linuxcontainers.org/incus/docs/main/), [About clustering](https://linuxcontainers.org/incus/docs/main/explanation/clustering/), [Provided metrics](https://github.com/lxc/incus/blob/main/doc/reference/provided_metrics.md)).

**Use now**

- Incus should sit behind runner services, not behind direct UI-to-Incus calls.
- Consume events and operations as substrate signals for our orchestration layer.

**Use later**

- Placement scriptlets can become valuable once we outgrow simple host-class targeting, but they should augment rather than replace explicit platform scheduling policy ([About clustering](https://linuxcontainers.org/incus/docs/main/explanation/clustering/)).

## What Incus does not replace

Even when used well, Incus does **not** replace the following JustAVPS platform requirements:

1. **Product model** — plans, regions, add-ons, backups as SKUs, IP products, suspension states.
2. **Commercial scheduling** — sellability, overcommit policy, reserved headroom, maintenance drains, anti-abuse placement.
3. **Billing and metering** — charges for disk, bandwidth, backups, snapshots, premium networks, reserved capacity.
4. **Customer UX** — machine lifecycle flows, rescue mode, password reset, SSH key UX, image marketplace, snapshot UX.
5. **Operations** — host bootstrap, procurement, firmware policy, kernel/QEMU policy, patching, break-glass access.
6. **Reliability engineering** — backups, restore drills, regional risk policy, hardware sparing, incident response.
7. **Security program** — IAM, audit trails, secrets handling, abuse controls, support impersonation controls, compliance evidence.

## Recommended adoption posture for JustAVPS

### Use heavily now

- Incus **VMs** as the compute primitive.
- **Clusters** with standardized host classes and cluster groups.
- **Projects** for infrastructure isolation boundaries.
- **Profiles** as the main config composition mechanism.
- **Local ZFS-style storage**, snapshots, exports, and image pipelines.
- **Metrics/events/API** behind our own control-plane services.
- **TLS-based internal auth** plus restricted certificate usage where needed.

### Use selectively later

- **OVN** for products that need richer private-cloud networking.
- **OpenFGA** for delegated/fine-grained authorization.
- **Placement scriptlets** for more sophisticated fleet policy.
- **Remote/distributed storage** only if product/ops economics justify it.
- **Storage buckets/object features** for adjacent products.

### Probably avoid at first

- Treating Incus as customer-facing cloud IAM.
- Treating snapshots as backups.
- Treating automatic placement as sufficient scheduling.
- Treating heterogeneous clusters as equal citizens for migration.
- Starting with distributed storage unless we have a clear requirement it uniquely solves.

## Bottom line

Incus is strong enough to underpin a serious VPS platform, especially one that wants to own its substrate without building a Firecracker-grade hypervisor stack from scratch. The winning posture is to let Incus handle **infrastructure primitives**—VM lifecycle, clustering, images, storage abstractions, networking primitives, snapshots, migration hooks, metrics, and authorization building blocks—while JustAVPS owns **commercial cloud logic** on top. That is the boundary that makes Incus practical for a large VPS business rather than a trap where substrate details leak directly into the product ([Incus overview](https://linuxcontainers.org/incus/docs/main/), [About clustering](https://linuxcontainers.org/incus/docs/main/explanation/clustering/), [About projects](https://linuxcontainers.org/incus/docs/main/explanation/projects/), [Authorization](https://linuxcontainers.org/incus/docs/main/authorization/)).
