# JustAVPS v2 — Master Spec for a Hetzner Dedicated + Incus VM Provider

## Purpose

This is the single merged planning document for JustAVPS v2.

It combines:

- infrastructure strategy
- business/economics reasoning
- architecture and implementation spec
- reliability and operational guidance
- provider/procurement decisions
- positioning and marketing guidance

The current default assumption in this document is:

- start with **Hetzner dedicated only**
- use **Incus VMs** on top of those hosts
- keep the current JustAVPS app as control plane
- use **Hetzner Robot API** for programmable host fleet expansion
- optionally gate host purchases behind **admin approval in JustAVPS**

---

## Executive summary

If the main pain in the current system is **slow boot times** on Hetzner Cloud, then there are three real paths:

1. **Keep Hetzner Cloud, add warm pools**
2. **Build a new provider on dedicated hosts with Incus VMs**
3. **Build a Firecracker/E2B-style microVM platform**

## Final recommendation

### Short-term easiest fix
- **Hetzner Cloud + warm pools**

### Best practical own-provider path
- **Hetzner dedicated + Incus VMs + local ZFS + runnerd + warm pools + golden templates**

### What not to do first
- full Firecracker platform
- OpenStack
- KubeVirt/Harvester
- distributed shared storage complexity

## Why this wins

It is the best balance of:

- startup speed
- isolation
- control
- operational simplicity
- API programmability
- business moat

It is not the most advanced possible platform.
It is the **easiest good platform**.

---

## Core problem

The current Hetzner Cloud path still fundamentally depends on:

- fresh VM creation
- provider boot lifecycle
- provider networking readiness
- cloud-init / daemon / callback readiness chain

So even with snapshots/templates, the hot path is still:

- create VM
- wait for provider
- wait for boot
- wait for services

That is why the floor remains too high.

---

## Option comparison

## 1. Hetzner Cloud + warm pools

### Pros
- lowest engineering effort
- fastest way to improve UX
- keeps current economics and current provider model
- no new compute-plane company to run

### Cons
- idle warm instances are directly billable
- still tied to Hetzner Cloud lifecycle and limitations
- weaker moat

### Complexity
- low to medium

### Estimate
- ~1–4 weeks depending on polish

### Verdict
- best first fix if all we need is faster startup

---

## 2. Hetzner dedicated + Incus VMs (**recommended v2 provider path**)

### Pros
- much faster provisioning from local templates
- good VPS-like isolation with VMs
- better control of runtime and lifecycle
- our own provider moat
- Incus gives API, events, projects, images, snapshots, metrics

### Cons
- real infra work
- more ops burden than staying on Hetzner Cloud
- not as “instant” as a top-end Firecracker snapshot stack

### Complexity
- medium to high, but realistic

### Estimate
- 1 strong engineer: **4–8 weeks MVP**, **8–16 weeks more productionized**
- 2 strong engineers: **3–5 weeks MVP**, **6–10 weeks decent production shape**

### Verdict
- best overall own-substrate option

---

## 3. Firecracker / E2B-style microVM stack

### Pros
- strongest eventual isolation/startup story
- best long-term premium sandbox substrate

### Cons
- much harder engineering problem
- much more custom orchestration burden
- not the right first move unless this becomes the company’s core platform moat immediately

### Verdict
- later, not first

---

## Why Incus VMs, not containers?

If the product is public, persistent, and VPS-like, use **VMs first**.

### Containers
- faster
- cheaper
- denser
- weaker isolation boundary

### VMs
- stronger isolation
- better match for “persistent agent computer / VPS” semantics
- still fast enough
- operationally simpler than Firecracker

### Conclusion
- **public VPS / persistent computer offering:** Incus VMs
- **future workspace / trusted-ish agent tier:** maybe containers later

---

## Why Incus over Proxmox / KubeVirt / OpenStack?

## Incus vs Proxmox

Proxmox is great for:

- admin-driven VM operations
- dashboard-led virtualization management

Incus is better for:

- API-first product orchestration
- clean image/template workflows
- programmable lifecycle control
- building a product, not just running a virtualization UI

## Incus vs Harvester/KubeVirt

Harvester/KubeVirt are too heavy for the first version.

## Incus vs OpenStack

OpenStack is dramatically too much complexity for this stage.

## Incus vs Firecracker

Firecracker is more advanced but much harder.
Incus is the right middle ground.

---

## Bare metal provider decision

## Can any bare metal work?

### Technically: yes
Any decent x86 bare metal with enough NVMe, RAM, and networking can run Incus.

### Business-wise: provider still matters
Because provider choice affects:

- cost
- stock availability
- support quality
- region coverage
- provisioning/reinstall automation
- fleet expansion ergonomics

---

## Why start Hetzner-only?

Starting with **Hetzner dedicated only** is sane because it gives:

- cheaper economics than premium bare-metal clouds
- operational simplicity
- one vendor to debug
- one procurement model
- enough automation via Robot

### Important
We do **not** need multi-provider first.

Later, if needed, we can add:

- OVH
- DataPacket
- Latitude
- other bare-metal vendors

behind the same internal provider/runner abstraction.

---

## Hetzner dedicated procurement model

For JustAVPS v2, the dedicated hosts are the things we are buying.

Flow:

1. decide regional capacity is low
2. order additional Hetzner dedicated hosts
3. wait for the order transaction to become ready
4. bootstrap the host automatically
5. add it to the Incus fleet
6. begin scheduling VMs on it

## Hetzner Robot API support

Hetzner Robot Webservice includes dedicated ordering endpoints, including:

- `GET /order/server/product`
- `POST /order/server/transaction`
- `GET /order/server/transaction/{id}`

So yes, **dedicated server ordering can be automated**.

### Important caveats
- ordering must be enabled in Robot settings first
- there is a daily request limit on ordering
- some orders can be rejected and require manual frontend intervention
- this is programmable fleet expansion, **not** hyperscaler instant elasticity

## Recommended control policy

Do not auto-buy servers with zero control at first.

Recommended first version:

- system detects low capacity
- JustAVPS admin panel shows “proposed host purchase”
- admin approves
- system places order via Robot API
- host auto-bootstrap proceeds after order is ready

Later, if confidence is high, this can become more automatic.

---

## Mixed hardware: is that okay?

Yes.

For normal Linux x86_64 Incus VMs:

- AMD hosts are fine
- Intel hosts are fine
- the same Ubuntu-based guest templates can run on both

## But don’t get too random

The issue is not “can a VM boot?”
The issue is operational mess:

- different core counts
- different RAM
- different disk sizes
- different economics
- different plan fit

## Best practice

Treat hosts as a small number of **host classes**, for example:

- `general-small`
- `general-medium`
- `memory-heavy`
- `gpu` later

Then scheduler rules decide which plans can land on which host classes.

### Recommendation
Start with only **1–2 Hetzner SKUs**.
Do not build the first version around a giant random zoo of server shapes.

---

## Example Hetzner starting point

An example host like **AX41-NVMe** can work as a small class host.

Use cases:

- starter regions
- low-end plans
- bootstrap capacity

But do not assume every host should run every plan equally well.

The scheduler should understand:

- host class
- usable RAM
- usable disk
- vCPU oversubscription policy
- whether a plan is allowed on that class

---

## Architecture overview

## Hard boundary: customer API vs internal fleet API

This is the most important architectural rule for the new design.

## Customer-facing API must expose product concepts only

Customers should see:

- plans
- regions
- machines
- images
- snapshots
- billing
- resize
- backups (if available for the product)

Customers should **not** need to know whether a machine is running on:

- Hetzner Cloud VPS
- an Incus VM on our own bare metal
- some future provider or substrate

That means customer APIs should be centered around:

- **Machine**
- **Plan**
- **Region**
- **Image/Snapshot**
- **Billing state**

Not around:

- provider discovery
- substrate selection
- host classes
- bare-metal procurement
- runner topology

## Internal/admin API should expose fleet concepts separately

Internal/admin APIs can expose:

- substrates
- fleet hosts
- procurement/orders
- placement/scheduling
- runner state
- capacity / exhaustion

This is now the intended split for the codebase:

- `/api/v1/*` = legacy API
- `/api/v2/catalog/*` = customer-facing product catalog
- `/api/v2/admin/fleet/*` = internal fleet control plane

The v2 boundary is intentionally much cleaner.

## 1. Control plane

Keep the current JustAVPS repo/app as source of truth for:

- users/accounts
- plans
- billing
- machine records
- image metadata
- routing records
- readiness state
- API/frontend/admin panel

Relevant repo integration points already exist:

- `src/server/lib/providers/types.ts`
- `src/server/lib/providers/index.ts`
- `src/server/lib/machine-lifecycle.ts`
- `src/server/routes/v1/internal.ts`

---

## 2. Scheduler

Add a scheduler in JustAVPS that decides:

- region
- host class
- concrete host
- template/image
- warm-pool claim vs fresh clone

### Scheduler inputs
- requested plan
- region
- requested image/template
- host class policy
- free RAM / disk / CPU headroom
- warm pool inventory
- host drain/maintenance state

### Scheduler output
- runner ID
- target host
- target template
- provisioning mode

---

## 3. Host-local runner service (`runnerd`)

Each host runs a small internal service that:

- talks only to local Incus
- is called by the control plane
- performs host-local orchestration

### Responsibilities
- clone VM from template
- start/stop/delete VM
- inject machine-specific config
- manage images/snapshots/publication
- maintain warm pool
- report host capacity and health
- expose host-local provisioning status

### Why runnerd exists
So the main app does not need to understand every host’s:

- local storage
- Incus connection
- network setup
- warm pool state
- retries / reconciliation details

---

## 4. Compute hosts

Each host should have:

- Ubuntu or Debian host OS
- Incus
- local **ZFS**
- private networking configured
- `runnerd`

### Reliability principle
Prefer:

- independent hosts
- local storage
- simple replacement workflows

Avoid initially:

- Ceph
- shared distributed block storage
- live migration
- complex cluster magic

---

## Networking model

## Recommended default
- customer VMs get **private IPs**
- public ingress goes through JustAVPS edge/proxy
- no direct public IP per VM by default

### Why
- simpler security
- easier routing
- less network management complexity
- better product control

### Incus networking scope for v1
- use simple **bridge/private networking** first
- avoid overcomplicated multi-host virtual networking at the start

---

## Storage model

## Recommended default
- **ZFS on each host**

### Why
- good local snapshot/clone model
- good Incus fit
- good operational simplicity

### Avoid initially
- distributed storage
- clever shared volume systems

---

## Golden VM templates

A golden VM template is a clean reusable VM image that already includes:

- Ubuntu base
- Docker
- JustAVPS daemon / agent runtime
- systemd services
- common packages
- hardening

It should not include:

- customer SSH keys
- customer tokens
- machine-specific slug/hostname
- customer data

### Why it matters
Instead of:

- boot empty machine
- apt install everything
- run long first boot setup

we do:

- clone prepared template
- inject machine identity
- boot services
- mark ready

That is how startup time drops from “minutes” to “seconds”.

---

## Image strategy

## Base image families
- `ubuntu-24.04-agent-base`
- `ubuntu-24.04-agent-docker`
- future specialized variants later

## Creation methods
- `distrobuilder`
- or build/clean/publish with Incus

## Custom image flow
When a customer wants “save this machine as image”:

1. snapshot or clean the VM
2. publish as an Incus image
3. store the alias/fingerprint in JustAVPS DB
4. allow future clones from that image

---

## Provisioning flow

1. user creates machine in JustAVPS
2. control plane creates billing + machine row
3. scheduler picks host/template
4. runnerd either:
   - claims a warm VM, or
   - clones a VM from template
5. runnerd injects machine-specific config
6. services start
7. machine sends `/internal/heartbeat`
8. control plane marks machine `ready`

### Injected machine-specific state
- slug
- machine token
- SSH keys
- env/config
- plan metadata if needed

---

## Warm pools

Warm pools matter both on Hetzner Cloud and on dedicated.

## On Hetzner Cloud
- warm VMs cost us directly as idle cloud instances

## On dedicated
- warm VMs do not add a new provider bill line
- but they do consume host capacity

So on dedicated, warm pools are easier psychologically, but still not free.

### Recommended v1 strategy
- keep warm pools only for common templates/plans
- mostly lower and mid tiers
- keep them intentionally small

---

## Startup time expectations

These are practical expectations, not guarantees.

## Current Hetzner Cloud fresh-create path
- often ~60–120s+ depending on readiness chain

## Dedicated + Incus VMs + local template

### Cold clone/start
- roughly **~5–15s**

### Warm pool claim
- roughly **~1–5s**

### Stateful resume
- still generally seconds, not sub-100ms Firecracker magic

## Bottom line
If the product goal is “feels fast” and “a few seconds”, Incus VMs are enough.

---

## Reliability model

## What reliability actually means
- machine creation works predictably
- host failures are visible and recoverable
- routes stay correct
- templates don’t silently drift
- warm pool machines are clean
- support can diagnose issues quickly

## Reliability does not come from hype
It comes from:

- simple architecture
- good templates
- conservative automation
- reconciliation loops
- health checks
- metrics
- runbooks

## First-version reliability rules
- no live migration
- no distributed storage
- no fancy HA illusions
- replace/drain hosts instead of trying to be clever

### Host failure behavior
If a host dies:

- mark unschedulable
- show affected machines as degraded
- restore from images/snapshots if needed
- stop all new placements there

That is a sane early-stage reliability model.

---

## Monitoring and reconciliation

Use two truth sources:

## 1. Incus state/events/metrics
Use for:

- lifecycle tracking
- reconciliation
- host and instance state audits
- capacity monitoring

## 2. Existing daemon heartbeat in JustAVPS
Use for:

- application-level readiness
- “services are actually up” signal

### Important rule
- Incus “running” does **not** equal customer-ready
- heartbeat marks true readiness

---

## Security model

### v1 defaults
- VMs only
- no direct Incus API exposure to customers
- control plane and runnerd are the only orchestrators
- customer traffic through edge/gateway/proxy

### Why this is enough for now
The goal is a sane boundary and boring operations, not a research project.

---

## CPU and GPU story

## CPU VMs on Incus
- easy
- core happy path

## GPU VMs on Incus
- possible
- materially harder

Practical guidance:

- CPU VMs are phase 1
- GPU passthrough can be phase 2
- if GPU demand appears earlier, using an external GPU VM provider first is acceptable

---

## Economics

## Current public EU plan prices in repo
- Starter: $12
- Basic: $21
- Pro: $39
- Power: $56
- Ultra: $77

## What self-hosted Incus on dedicated is good at economically
- low and mid tiers
- high utilization
- moderate CPU oversubscription
- persistent monthly compute

## What it is not
- automatic giant margin miracle

This move is primarily a:

- **speed / control / product moat** win

and only secondarily a:

- raw unit-cost optimization

## Warm-pool economics

### Hetzner Cloud
Idle warm VMs are directly billed.

### Dedicated
Warm VMs consume already-purchased capacity.

That makes warm pools much more natural on dedicated hosts.

---

## Business evaluation

## Is there a wedge?
Yes.

The gap is real:

- **Hetzner / generic VPS**: cheap compute, weak agent DX
- **Daytona / E2B**: strong agent DX, more burst/sandbox-oriented pricing and usage shape
- **JustAVPS**: persistent, 24/7, agent-native machines

## What the business is not
- not “another generic VPS host”
- not “slightly nicer Hetzner”

## What the business should be
- **the always-on computer for AI agents**
- **persistent agent infrastructure**
- **the missing middle between raw VPS and burst sandboxes**

## Core risk
If users see it as only “a VPS with slightly nicer defaults,” margins compress and the business gets weak.

The business gets interesting if users see it as:

- the best place to run long-lived agent computers

---

## Marketing and positioning

## Core positioning
- **Fast-start, always-on computers for AI agents**

## Alternate versions
- persistent agent infrastructure
- the missing middle between raw VPS and burst sandboxes
- run agents on real persistent machines, not disposable sandboxes

## Comparison framing

### Against Hetzner
- cheap infra
- weak agent-native DX
- not built for coding/research/browser agent workflows

### Against Daytona/E2B
- great agent DX
- more burst/sandbox-oriented
- not the same as “leave this machine running 24/7 at VPS-ish economics”

### Our wedge
- agent-native like sandbox tools
- persistent like a VPS
- faster to start than traditional VPS flows

## One strong homepage line
**JustAVPS gives you the agent DX of a sandbox platform with the persistence and economics of a VPS.**

---

## Recommended rollout sequence

## Phase 0
- keep improving current Hetzner Cloud path if needed
- verify users truly care about fast startup and persistent agent machines

## Phase 1 — dedicated MVP
- Hetzner dedicated only
- 1 region
- 1–2 host classes
- Incus VMs only
- local ZFS only
- runnerd per host
- small warm pools
- one default golden template

## Phase 2 — hardening
- better scheduler
- host draining
- image versioning / rollback
- better metrics / alerting
- admin approval workflows for auto-procurement

## Phase 3 — expansion
- more regions
- more host classes
- custom image maturity
- maybe GPU
- maybe additional providers later

---

## What “automatic scaling” really means here

There are two scaling loops.

## 1. VM scaling inside existing hosts
Fast.

- schedule more VMs
- refill warm pools
- nearly immediate compared to host procurement

## 2. Host fleet scaling
Slower.

- detect capacity pressure
- order dedicated server
- wait for delivery
- bootstrap host
- register host
- then place VMs on it

This is **programmable fleet expansion**, not cloud-style infinite instant autoscaling.

### Recommended control loop
- track regional capacity thresholds
- surface low-capacity events in admin panel
- admin can approve or auto-approve based on policy
- JustAVPS orders host via Robot API
- bootstrap pipeline runs
- host becomes schedulable

---

## Final verdict

## If the only goal is faster boot tomorrow
- Hetzner Cloud warm pools

## If the goal is a real provider moat and persistent agent-computer platform
- Hetzner dedicated + Incus VMs + runnerd + local ZFS

## Default call right now
- start **Hetzner-exclusive**
- buy dedicated hosts programmatically through **Robot API**
- bootstrap them automatically
- schedule Incus VMs across them through JustAVPS
- standardize on a few host classes
- add admin approval for host purchases first

That is the sane v2 path.

---

## Live verification status (current implementation)

The current implementation was verified locally end to end as far as the account permissions allowed.

## Completed live checks

- bare-metal fleet tables were added and applied to the database
- local API was started with bare-metal v2 enabled
- v2 customer catalog endpoints were verified via curl
- v2 admin fleet endpoints were verified via curl
- Hetzner Robot credentials were wired in
- Hetzner Robot product listing works through the app
- a bootstrap SSH key was created and added to Robot
- procurement requests can be created through the app

## Live ordering result

The order payload is valid.

This was verified using Hetzner Robot `test=true` ordering for:

- `AX41-NVMe`
- `EX44`

with:

- location `FSN1`
- distribution `Ubuntu 24.04 LTS base`
- bootstrap SSH key attached
- `primary_ipv4` addon

## Current blocker

Real dedicated ordering is currently blocked by the Hetzner account returning:

- `412 PRECONDITION_FAILED`
- message: *Please try to order the server in the robot web interface for more details on the error.*

This means the remaining blocker is **account-side / Hetzner-side**, not request-shape correctness.

## Practical implication

Once the Hetzner Robot account allows real server ordering, the next steps are:

1. place real procurement order through `/api/v2/admin/fleet/...`
2. sync transaction until server is ready
3. bootstrap the host over SSH using the stored bootstrap key
4. install ZFS + Incus + runnerd
5. register host in JustAVPS
6. begin scheduling Incus VMs onto that host
