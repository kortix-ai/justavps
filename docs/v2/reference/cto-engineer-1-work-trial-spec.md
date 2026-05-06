# JustAVPS Engineering Lead Paid Work Trial

## Goal

Build **as much as possible** of a production-ready sandbox cloud in **1 week**.

The target is a real competitor to **Daytona / E2B / Modal**: a cloud where developers and AI agents can create, run, persist, expose, snapshot, migrate, archive, and resume isolated Linux machines at massive scale.

This is intentionally open-ended. There is no exact API spec. Pick any architecture and implementation path you think is best.

The bar: **build the full system, ready to go live.** Full Daytona/E2B-level product, not a partial infra demo.

## Hard Constraints

- Must be designed for **bare metal**.
- Must be able to scale from one host to huge fleets, clusters, regions, and ultimately millions of sandboxes.
- Must have competitive boot/resume times across the board. Ideal target: **sub-1-second sandbox start/resume** where technically possible, and otherwise clearly benchmarked against Daytona/E2B/Modal-class products.
- Final JustAVPS must be ours to run, modify, close-source, and commercialize. You may use OSS code/forks/reference implementations as a basis if the license allows that.
- Do not depend on a third-party hosted sandbox SaaS as the core runtime. Owning/forking/running OSS code ourselves is allowed if licensing works.
- You may use MicroVMs, full VMs, containers, Linux containers, Kubernetes, Incus/LXD, Firecracker, Nomad, raw VPS automation, CubeSandbox, Daytona/E2B OSS code, or anything else you believe is best.
- Preference: strong isolation / isolated-kernel designs like MicroVMs or VMs are preferred if you can make boot times and density work. Shared-kernel containers are allowed if you can justify the security/scale tradeoff.
- Architecture should not block future GPU support.
- Final result must be deployed for real, not localhost-only.
- Core flows must be proven with tests or repeatable verification.

## Reference Links

Use these as references/basis where licensing allows:

- Daytona: https://github.com/daytonaio/daytona
- E2B org/repos: https://github.com/e2b-dev
- Tencent Cloud CubeSandbox: https://github.com/TencentCloud/CubeSandbox/tree/master
- Modal docs/product reference: https://modal.com/docs
- Firecracker: https://github.com/firecracker-microvm/firecracker
- Incus: https://github.com/lxc/incus
- LXD: https://github.com/canonical/lxd
- containerd: https://github.com/containerd/containerd
- Kubernetes: https://github.com/kubernetes/kubernetes
- Nomad: https://github.com/hashicorp/nomad

## Core Problem

We want a complete cloud runtime for long-running developer/AI-agent machines.

You should think through and build the mechanisms that make this possible:

### 1. Provisioning

- create isolated Linux machines/sandboxes,
- choose CPU/RAM/disk/resources,
- place them on healthy hosts,
- inject SSH keys/config/secrets safely,
- track provisioning states,
- recover or clean up failed provisioning.

### 2. Templates / Images

- base Linux images,
- developer/agent templates,
- custom images if possible,
- image caching/materialization on hosts,
- versioning or content identity,
- fast create from template.

### 3. Fast Start / Resume

- fastest possible cold starts,
- ideal sub-1-second start/resume path,
- warm pools, pre-cached images, pre-warmed kernels/VMs/containers, lazy loading, or whatever mechanism gets competitive boot times,
- benchmarked boot/start/resume times against the chosen reference systems,
- stopped machines that resume quickly,
- stable machine identity across restarts,
- clear running/stopped/resuming/error states.

### 4. Persistence

- durable filesystem/disk,
- long-running processes,
- stable SSH/proxy access,
- machine identity that survives stop/start/reboot,
- economics for running vs stopped machines.

### 5. Snapshots / Restore / Clone

- snapshot a machine,
- restore a machine,
- clone a new machine from snapshot,
- promote useful snapshots into templates if possible,
- make snapshots safe, trackable, and storage-aware.

### 6. Archive / Offload

- archive stopped/inactive machines,
- offload machine state to cheaper storage,
- rehydrate archived machines,
- keep IDs, metadata, snapshots, access config, and billing/usage consistent,
- clean up hot host storage.

### 7. Migration

- move machines or machine state across hosts/nodes,
- support drain/maintenance workflows,
- recover from unhealthy hosts,
- migrate images/snapshots across clusters/regions,
- design for live or offline migration depending on runtime choice.

### 8. Nodes / Clusters / Capacity

- host registry,
- cluster model,
- health checks,
- scheduler,
- quota/capacity accounting,
- bin-packing or placement strategy,
- drain/quarantine/repair flows,
- add/remove hosts without rewriting the system,
- path to 10, 100, 1,000, 100,000, and millions of sandboxes.

### 9. Access / Networking

- SSH,
- browser terminal,
- command execution,
- file upload/download/manage,
- secure HTTPS port proxy,
- WebSocket support,
- auth-protected/shareable links,
- revocation/rotation,
- safe defaults against accidental public exposure.

### 10. Control Plane / Operations

- accounts/auth/API keys,
- sandbox lifecycle API,
- full web dashboard,
- API,
- CLI,
- SDK or typed client,
- logs/metrics/health/status,
- operation history,
- reconciliation/orphan cleanup,
- deploy/rollback/migrations,
- cost and usage tracking,
- security/threat model.

## What to Show at the End

- working deployed product,
- source code,
- full web dashboard,
- API/CLI/SDK or typed client,
- demo of real sandbox creation and usage,
- command/file/SSH/proxy flow,
- template/image flow,
- snapshot/restore/clone flow,
- stop/start/resume flow,
- archive/offload/migration plan or working implementation,
- node/cluster/capacity scaling plan,
- tests or verification command,
- short architecture writeup,
- short security/threat model,
- setup/deploy docs,
- known gaps and exact path to finish.

## Evaluation

We are judging whether you can own JustAVPS end-to-end:

- Did you understand the full Daytona/E2B/Modal-class problem?
- Did you think through provisioning, templates, snapshots, resume, archive, migration, nodes, clusters, and scale?
- Did you ship real infrastructure, not mocks?
- Is the architecture compatible with bare metal and massive scale?
- Are boot times and DX taken seriously?
- Is the system secure and operable?
- Are failures, cleanup, and reconciliation handled?
- Can this become a real company-scale cloud product?

## Bar

Aim to complete the full cloud, ready to go live.

Aim to build true Daytona/E2B/Modal parity, build the strongest live-ready system possible and make the remaining path obvious.

This is an **Engineering Lead** trial. We want full ownership, deep thinking, and real shipping.
