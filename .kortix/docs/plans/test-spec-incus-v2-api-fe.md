# Test Spec — Incus V2 API + FE

## Objective

Define the verification matrix for the full V2 transition so implementation can be run under autowork with explicit completion gates.

## Test strategy

Use four layers:

1. **Unit tests** — pure domain, scheduler, billing, capability gating
2. **Route/service tests** — V2 API shape, fleet/admin behavior, provider abstraction
3. **Host/runner integration tests** — runnerd + Incus on real hardware
4. **Browser/E2E tests** — public FE flows + admin fleet flows

## Completion gates

The implementation is not complete until all of these pass:

- targeted unit/route tests green
- targeted FE lint green
- runnerd integration tested on real host
- one real V2 machine create/start/stop/reboot/snapshot/image/destroy path proven on dedicated hardware
- admin procurement/host registration path proven on dedicated hardware

## Test matrix

## A. Domain / unit tests

### A1. Public offerings
- list public plans for each region
- customer-facing catalog never exposes internal providers/substrate identifiers
- pricing and feature flags serialize correctly

### A2. Scheduler
- picks active host with sufficient capacity
- respects region
- respects host status
- rejects exhausted hosts
- future: respects host class policy and billing mode constraints

### A3. Provider capabilities
- cloud provider marked backups/images true, baremetal false/true as designed
- feature gating routes/UI based on capabilities behaves correctly

### A4. Robot integration client
- list products
- ensure SSH key reuse/create
- order payload formatting
- transaction polling
- error handling on `PRECONDITION_FAILED`

### A5. Billing domain
- flat monthly pricing calculations
- metered accumulator logic (future)
- cap-at-monthly logic (future)

## B. Route / service tests

### B1. `/api/v2/catalog/*`
- plans endpoint
- regions endpoint
- no substrate leakage

### B2. `/api/v2/admin/fleet/*`
- product listing
- procurement create
- procurement approval
- procurement sync
- bootstrap config
- host register
- admin auth enforcement

### B3. Future `/api/v2/machines/*`
- create machine with `{plan, region, image}`
- list/get machine
- lifecycle actions
- image/snapshot actions
- resize

### B4. Backward compatibility
- existing V1 public endpoints remain stable until migration is complete
- v1 provider list does not leak internal baremetal provider

## C. Runner / host integration tests

These are required on a real dedicated host.

### C1. Host bootstrap
- SSH access with bootstrap key works
- Incus installed
- storage pool present
- network bridge present
- runnerd active and healthy
- host registered into control plane

### C2. Runnerd lifecycle
- create instance from remote Ubuntu image
- wait for private IP
- wait for cloud-init
- return instance id, host IP, private IP, sshPort
- stop/start/reboot/delete all succeed
- publish image succeeds

### C3. Image reuse
- create image from instance
- launch another VM from that image alias
- verify instance boots and is usable

### C4. Busy/update retries
- create path tolerates Incus “Instance is busy” / ETag mismatch races
- create path does not hang indefinitely

### C5. Failure behavior
- invalid image returns clean error
- host without storage/network/profile is rejected with explicit failure
- runner token auth failure returns 401

## D. Customer FE tests

### D1. Public catalog
- plans shown per region
- copy reflects persistent compute positioning

### D2. Machine create wizard (future)
- choose plan
- choose region
- optional image
- create machine
- show provisioning status and connection details

### D3. Machine detail
- show current plan/status/region
- lifecycle actions visible and working
- image/snapshot actions visible and working

### D4. Resize UI
- plan diff shown
- billing impact shown
- submission path works

## E. Admin FE tests

### E1. Fleet dashboard
- host table renders
- procurement table renders
- statuses update correctly

### E2. Procurement flow
- create procurement request
- approve request
- watch transition to bootstrapping/active

### E3. Host detail
- bootstrap metadata visible
- runner URL visible
- capacity metrics visible

## Live E2E scenarios

## Scenario 1 — Host procurement
1. Create procurement request
2. Approve/order host
3. Poll until ready
4. Bootstrap host
5. Register host
6. Verify host active in admin fleet API/FE

## Scenario 2 — Real machine lifecycle via runner
1. Create VM
2. Verify private IP assigned
3. Verify cloud-init done
4. Stop
5. Start
6. Reboot
7. Publish image
8. Delete

## Scenario 3 — Real machine lifecycle via control plane (required future gate)
1. Call V2 machine create
2. Persist DB row + placement
3. Provision through runner
4. Machine becomes ready in product API
5. Lifecycle/image/snapshot actions all work from product API

## Required tooling

- `vitest` for unit/route coverage
- curl/bash scripts for procurement + host bootstrap verification
- browser automation for FE/admin flows
- direct SSH to dedicated host for infra verification

## Failure thresholds

Block release if any of the following are true:

- runnerd create can still hang indefinitely
- V2 customer APIs expose internal substrate/provider concepts
- host bootstrap is not repeatable/documented
- a real VM cannot be created and destroyed through the supported path
- host capacity cannot be expanded with a second host without ad hoc changes

## Recommended execution split

### `/autowork-team`

#### Stream 1 — API/domain
- V2 machine/image/snapshot/billing routes
- provider/domain cleanup

#### Stream 2 — Fleet/runner
- runnerd hardening
- ZFS bootstrap
- host heartbeat/capacity sync

#### Stream 3 — FE/admin
- public catalog / machine flows / admin fleet dashboard

#### Stream 4 — Billing
- flat monthly preservation
- metered accumulation groundwork
