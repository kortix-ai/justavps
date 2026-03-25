# Kortix Computer on JustAVPS - Infrastructure Customer Plan

## Goal

Make `computer/` consume JustAVPS as a normal infrastructure customer, not as a special backdoor into Hetzner. `computer` should talk only to JustAVPS customer-facing APIs, while JustAVPS remains free to change its underlying provider implementation.

## Desired End State

- `computer` provisions sandboxes through JustAVPS, not Hetzner.
- `computer` does not know JustAVPS snapshot IDs, Hetzner server type semantics, or underlying provider names.
- JustAVPS owns the VM lifecycle, templates, billing to the infra customer, webhook delivery, and provider abstraction.
- `computer` owns its own tenant model, sandbox routing, and billing to its users.
- The integration works even if JustAVPS later swaps Hetzner for another backend or adds multiple backends.

## Core Principle

Treat `computer` as customer zero of JustAVPS.

That means `computer` should rely only on stable customer contracts:

- API key auth
- machine catalog / plans
- machine create / read / start / stop / delete
- template selection
- provisioning webhooks
- machine connection endpoint(s)

It should not rely on JustAVPS internals such as:

- raw snapshot IDs
- underlying `provider` choice inside JustAVPS
- Hetzner-only plan naming assumptions
- JustAVPS dashboard UI behavior
- JustAVPS proxy URLs as a hard dependency for the sandbox control plane

## Current State

### JustAVPS today

- Public machine provisioning already exists in `justavps.com/src/server/routes/v1/machines.ts`.
- Customer API key auth already exists in `justavps.com/src/server/lib/api-guard.ts`.
- Async machine lifecycle events already exist through DB-backed eventing + signed webhooks in `justavps.com/src/server/lib/event-bus.ts` and `justavps.com/src/server/lib/webhook-delivery.ts`.
- Internal compute abstraction exists, but only a Hetzner-backed provider is actually registered in `justavps.com/src/server/lib/providers/index.ts`.
- Public machine create still exposes infra-shaped fields such as `provider`, `server_type`, and provider image resolution in `justavps.com/src/lib/schemas.ts` and `justavps.com/src/server/routes/v1/machines.ts`.

### Computer today

- `computer` already has a `SandboxProvider` abstraction in `computer/kortix-api/src/platform/providers/index.ts`.
- There is already a prototype JustAVPS adapter in `computer/kortix-api/src/platform/providers/justavps.ts`.
- That adapter is not yet cleanly customer-like because it still depends on:
  - `JUSTAVPS_IMAGE_ID`
  - `hetznerServerType`
  - `hetznerLocation`
- JustAVPS webhooks are already wired into `computer` via `computer/kortix-api/src/platform/routes/sandbox-webhooks.ts` and `computer/kortix-api/src/platform/services/sandbox-events.ts`.
- Frontend/provider support is incomplete: `justavps` is missing from some store/UI paths such as `computer/apps/frontend/src/stores/server-store.ts` and the provider picker in `computer/apps/frontend/src/components/auth/self-hosted-auth.tsx`.

## Ground Truth from Live API Docs

The live docs at `https://justavps.com/api/docs` and `https://justavps.com/api/docs/openapi.json` confirm that the current public contract is still infra-shaped.

- `POST /api/v1/machines` currently accepts `provider` (default `cloud`), `server_type`, `region`, `image_id`, and optional Docker fields. It does not expose `template_id`, `plan_id`, `client_reference_id`, or upstream metadata fields yet.
- The machine response already returns useful customer-facing fields like `status`, `provisioning_stage`, `urls.proxy`, `urls.terminal`, `port_template`, SSH details, and health, but it does not return a dedicated `sandbox_api_url` / control-plane endpoint for `computer`.
- Public lifecycle routes already exist and are good integration anchors: `GET/POST /api/v1/machines`, `GET/DELETE /api/v1/machines/{id}`, plus `POST /api/v1/machines/{id}/start`, `stop`, and `reboot`.
- Discovery routes already exist: `GET /api/v1/server-types`, `GET /api/v1/server-types/providers`, and `GET /api/v1/server-types/regions`.
- Signed customer webhooks are already first-class in the live API: `POST /api/v1/webhooks` with events `machine.stage_changed`, `machine.status_changed`, and `machine.heartbeat`.
- Migration-oriented Kortix link/claim routes already exist in the live API: `GET /api/v1/import/kortix/start`, `GET /api/v1/import/kortix/machines`, `POST /api/v1/import/kortix/claim`, and `GET /api/v1/import/kortix/status`.

That validates the overall direction in this plan: the main missing work is not inventing a new integration surface from scratch, but cleaning the existing public API so `computer` can consume it without knowing JustAVPS internals.

## The Biggest Architectural Problem

The current integration is halfway between:

1. a true customer integration, and
2. an internal bridge to JustAVPS implementation details.

That is the part to fix first.

The clean boundary is:

`computer` -> JustAVPS customer API -> JustAVPS orchestration -> Hetzner (or anything else)

Not:

`computer` -> JustAVPS API + hidden knowledge of JustAVPS snapshot/provider internals -> Hetzner

## Recommended Target Architecture

### Control plane split

#### `computer`

Owns:

- user/account model
- sandbox records
- frontend onboarding
- routing to sandbox APIs via `/p/{sandboxId}/{port}`
- billing to its own users
- sandbox readiness UX

#### JustAVPS

Owns:

- infra customer accounts / API keys
- plan catalog
- template catalog
- VM provisioning
- underlying cloud provider choice
- machine lifecycle webhooks
- machine networking details
- infra billing to the customer account (`computer` as customer zero)

### Environment model

Create a dedicated JustAVPS customer account per `computer` environment:

- `computer-dev`
- `computer-prod`

Each account gets:

- one JustAVPS user or service account
- one API key
- one webhook endpoint back to `computer`
- its own payment method / billing relationship

V1 can use dedicated JustAVPS user accounts authenticated by API key. If needed later, this can evolve into organizations/service accounts without changing the contract `computer` uses.

## Required Contract Changes

### 1. Make the JustAVPS contract logical, not infra-shaped

#### Current leak

`computer` currently passes or depends on:

- `snapshot_id`
- `provider`
- `hetznerServerType`
- `hetznerLocation`

#### Target contract

`computer` should send something like:

```json
{
  "template_id": "kortix-sandbox",
  "plan_id": "shared-2x4",
  "region": "nbg1",
  "name": "sandbox-ab12cd34",
  "env_vars": {
    "KORTIX_TOKEN": "...",
    "KORTIX_API_URL": "https://api.computer.kortix.com"
  },
  "client_reference_id": "computer:sandbox:8e4c...",
  "metadata": {
    "upstream_system": "computer",
    "upstream_account_id": "...",
    "upstream_sandbox_id": "...",
    "environment": "prod"
  }
}
```

#### Rules

- `template_id` is a stable JustAVPS product/template identifier.
- `plan_id` is a stable customer-facing plan identifier.
- `region` is customer-facing and can still map 1:1 to current regions.
- `client_reference_id` is an idempotency and reconciliation key.
- `metadata` is stored and echoed in webhook payloads.

#### JustAVPS implementation detail

Internally, JustAVPS can still resolve that request to:

- base snapshot
- docker workload
- raw provider labels
- provider-specific image IDs

But those stay inside JustAVPS.

### 2. Add a first-class machine profile for Computer

Do not make `computer` know which snapshot or docker image to boot.

Recommended profile:

- `template_id = kortix-sandbox`

That profile can internally mean:

- JustAVPS base machine snapshot
- Docker workload image = `SANDBOX_IMAGE`
- expected open port = `8000`
- expected auth = `KORTIX_TOKEN`
- health contract = sandbox-ready when port `8000` responds

This gives JustAVPS freedom to change the implementation later without touching `computer`.

### 3. Return a direct sandbox endpoint in the API

`computer` should not derive sandbox connection details from JustAVPS consumer URLs.

Recommended machine response fields:

```json
{
  "id": "uuid",
  "status": "provisioning",
  "provisioning_stage": "server_created",
  "client_reference_id": "computer:sandbox:...",
  "network": {
    "public_ip": "1.2.3.4",
    "sandbox_api_url": "http://1.2.3.4:8000"
  }
}
```

V1 default:

- expose `public_ip`
- expose `sandbox_api_url`

`computer` then uses that endpoint behind its own proxy.

This is cleaner than depending on JustAVPS browser/proxy URLs meant for human customers.

### 4. Extend webhooks for upstream reconciliation

JustAVPS already signs webhooks with `X-JustAVPS-Signature` and delivers `machine.stage_changed`, `machine.status_changed`, and `machine.heartbeat`.

Keep those event names, but guarantee these fields in webhook metadata:

- `machineId`
- `client_reference_id`
- `public_ip`
- `sandbox_api_url`
- `template_id`
- `plan_id`
- `region`
- `upstream_system`
- `upstream_sandbox_id`

This lets `computer` update its DB from webhooks without extra read-after-write coupling.

### 5. Normalize lifecycle operations

JustAVPS already supports:

- `POST /machines/{id}/start`
- `POST /machines/{id}/stop`
- `POST /machines/{id}/reboot`
- `DELETE /machines/{id}`

`computer` should use those as-is.

The current `computer` adapter is stale here because `stop()` is effectively unsupported and `start()` is implemented as reboot in `computer/kortix-api/src/platform/providers/justavps.ts`.

## End-to-End Flow

### A. Environment bootstrap

1. Create a real JustAVPS customer account for `computer-prod`.
2. Add billing info to that JustAVPS account.
3. Generate an API key via the standard JustAVPS API key flow.
4. Register a webhook pointing to `computer`:
   - `POST /v1/platform/webhooks/justavps`
5. Store in `computer`:
   - `JUSTAVPS_API_URL`
   - `JUSTAVPS_API_KEY`
   - `JUSTAVPS_WEBHOOK_SECRET`
   - default `JUSTAVPS_TEMPLATE_ID`
   - default `JUSTAVPS_PLAN_ID`
   - default `JUSTAVPS_REGION`

### B. Sandbox creation from Computer

1. User selects JustAVPS-backed cloud in `computer`.
2. `computer` calls `ensureSandbox()`.
3. `computer` creates a sandbox row in `provisioning` state.
4. `computer` creates the sandbox service key.
5. `computer` calls JustAVPS `POST /machines` using the customer API key.
6. JustAVPS:
   - validates billing / account limits
   - resolves the `template_id`
   - provisions the VM on its internal provider
   - stores `client_reference_id` + metadata
7. JustAVPS returns machine ID immediately.
8. `computer` stores that JustAVPS machine ID as `externalId`.
9. JustAVPS sends stage/status webhooks as provisioning progresses.
10. `computer` updates `sandboxes.metadata` and emits SSE to the frontend.
11. When JustAVPS reports `services_ready`, `computer` marks the sandbox active.
12. `computer` routes traffic to the sandbox via `/p/{externalId}/8000`.

### C. Sandbox delete

1. User removes sandbox in `computer`.
2. `computer` calls `DELETE /machines/{id}` on JustAVPS.
3. JustAVPS destroys the VM and stops billing that machine.
4. `computer` archives the sandbox row.

### D. Sandbox stop/start

1. User stops sandbox in `computer`.
2. `computer` calls `POST /machines/{id}/stop`.
3. User starts sandbox in `computer`.
4. `computer` calls `POST /machines/{id}/start`.
5. Readiness is confirmed through JustAVPS status/readiness events.

## What Must Change in `computer`

### 1. Remove Hetzner-shaped config and types from generic flow

Replace:

- `hetznerServerType`
- `hetznerLocation`
- `JUSTAVPS_IMAGE_ID`

With:

- `planId`
- `region`
- `templateId`
- optional `JUSTAVPS_DEFAULT_PLAN_ID`
- optional `JUSTAVPS_DEFAULT_REGION`

Key files:

- `computer/kortix-api/src/platform/providers/index.ts`
- `computer/kortix-api/src/platform/routes/sandbox-cloud.ts`
- `computer/kortix-api/src/platform/services/ensure-sandbox.ts`
- `computer/kortix-api/src/config.ts`

### 2. Make JustAVPS a real first-class cloud provider in the frontend

Fix the missing/partial support in:

- `computer/apps/frontend/src/components/auth/self-hosted-auth.tsx`
- `computer/apps/frontend/src/stores/server-store.ts`
- any provider label / picker / remove flow paths still hardcoded to Hetzner-only logic

### 3. Decouple billing from Hetzner pricing

Current additional-instance billing in `computer/kortix-api/src/platform/routes/sandbox-cloud.ts` is explicitly Hetzner-priced.

That should become one of:

- provider-specific pricing policy, or
- internal `computer` price table keyed by `provider + plan_id`

For JustAVPS mode, `computer` should not calculate price from Hetzner raw costs.

### 4. Keep the existing webhook/SSE model

This part is already the right direction.

Keep and harden:

- `computer/kortix-api/src/platform/routes/sandbox-webhooks.ts`
- `computer/kortix-api/src/platform/services/sandbox-events.ts`

The main change is to enrich the payload and make the contract explicit.

## What Must Change in JustAVPS

### 1. Split customer contract from internal provider contract

The public API currently mixes customer concerns and backend concerns.

Refactor toward:

- customer-facing `template_id` / `plan_id` / `region`
- internal provider resolution hidden behind JustAVPS services

Primary files:

- `justavps.com/src/lib/schemas.ts`
- `justavps.com/src/server/routes/v1/machines.ts`
- `justavps.com/src/server/lib/machine-lifecycle.ts`
- `justavps.com/src/server/lib/providers/types.ts`

### 2. Add upstream references to machine records

Add fields or structured metadata for:

- `client_reference_id`
- `upstream_system`
- `upstream_account_id`
- `upstream_sandbox_id`

This is essential for support, reconciliation, and idempotency.

### 3. Formalize template/profile resolution

JustAVPS should own the mapping:

- `template_id` -> base snapshot / docker workload / expected open ports / readiness behavior

This likely belongs in a dedicated template catalog service instead of burying it in the machine route.

### 4. Centralize provisioning orchestration

Provisioning logic is duplicated today between:

- `justavps.com/src/server/routes/v1/machines.ts`
- `justavps.com/src/server/routes/v1/stripe-webhooks.ts`

Create one shared provisioning service and call it from both paths. That becomes even more important once `computer` depends on this contract.

### 5. Keep customer webhooks first-class

JustAVPS webhooks are already close to what is needed. Make them part of the stable infra-customer contract, not just a convenience feature for UI automation.

## Proposed API Shape

### `POST /api/v1/machines`

#### Recommended public request

```json
{
  "template_id": "kortix-sandbox",
  "plan_id": "shared-2x4",
  "region": "nbg1",
  "name": "sandbox-ab12cd34",
  "env_vars": {
    "KORTIX_TOKEN": "..."
  },
  "client_reference_id": "computer:sandbox:8e4c...",
  "metadata": {
    "upstream_system": "computer",
    "upstream_account_id": "acct_...",
    "upstream_sandbox_id": "sbx_..."
  }
}
```

#### Recommended response

```json
{
  "id": "machine_uuid",
  "status": "provisioning",
  "provisioning_stage": "server_creating",
  "template_id": "kortix-sandbox",
  "plan_id": "shared-2x4",
  "region": "nbg1",
  "client_reference_id": "computer:sandbox:8e4c...",
  "network": {
    "public_ip": null,
    "sandbox_api_url": null
  }
}
```

### `GET /api/v1/plans`

Return logical plans. In v1 they may map 1:1 to current server types, but the API name should represent plans, not raw Hetzner SKUs.

### `GET /api/v1/templates`

Return supported templates/profiles including `kortix-sandbox`.

### Webhook payload

```json
{
  "event": "machine.stage_changed",
  "data": {
    "machineId": "machine_uuid",
    "client_reference_id": "computer:sandbox:8e4c...",
    "stage": "services_ready",
    "status": "ready",
    "message": "Ready",
    "metadata": {
      "public_ip": "1.2.3.4",
      "sandbox_api_url": "http://1.2.3.4:8000",
      "template_id": "kortix-sandbox",
      "plan_id": "shared-2x4",
      "region": "nbg1",
      "upstream_system": "computer",
      "upstream_sandbox_id": "sbx_..."
    },
    "timestamp": "2026-03-20T00:00:00.000Z"
  }
}
```

## Data Mapping Between Systems

| Concern | JustAVPS | Computer |
|---|---|---|
| Infra machine identity | `machine.id` | `sandboxes.externalId` |
| Upstream reference | `client_reference_id` | `sandboxes.sandboxId` |
| Owning tenant | JustAVPS customer account | `sandboxes.accountId` |
| Status | `machines.status` | `sandboxes.status` |
| Stage | `machines.provisioningStage` | `sandboxes.metadata.provisioningStage` |
| Reachability | `network.public_ip` / `sandbox_api_url` | `sandboxes.baseUrl` |

## Billing Model

### Recommended default

- JustAVPS bills `computer` as an infra customer.
- `computer` bills its own end users however it wants.
- Pricing logic inside `computer` must not depend on Hetzner raw pricing.

### Practical v1 approach

- Use JustAVPS customer-visible plan pricing as the source of truth for infra cost.
- In `computer`, map that to its own sell price or included-plan policy.
- Keep the two billing systems intentionally separate.

## Security Model

- `computer` authenticates to JustAVPS with a normal customer API key.
- JustAVPS authenticates back to `computer` with signed webhooks.
- The sandbox service key (`KORTIX_TOKEN`) is injected as a machine env var only.
- `computer` never gets JustAVPS provider account secrets.
- JustAVPS never needs direct access to `computer` user sessions.

## Rollout Plan

### Phase 1 - Contract cleanup in JustAVPS

- Add logical `template_id` and `plan_id` support.
- Add `client_reference_id` and upstream metadata.
- Add explicit machine network endpoint fields.
- Refactor provisioning into one shared service.

### Phase 2 - Clean provider refactor in Computer

- Rename generic provision fields from Hetzner-specific names.
- Remove `JUSTAVPS_IMAGE_ID` and other provider-internal identifiers from the `computer` contract.
- Make JustAVPS lifecycle calls use the real customer endpoints.

### Phase 3 - Frontend and billing parity

- Expose JustAVPS in provider selection UI.
- Fix all type/store/remove paths to support `justavps`.
- Move pricing off Hetzner assumptions.

### Phase 4 - Dogfood as customer zero

- Create `computer-dev` JustAVPS account.
- Provision real sandboxes through JustAVPS only.
- Verify create, delete, stop, start, restart, webhook progress, and routing.
- Evaluate whether the existing Kortix import/claim API can help transition or reconcile older direct-managed sandboxes during rollout.

### Phase 5 - Production cutover

- New cloud sandboxes default to JustAVPS.
- Existing Hetzner sandboxes remain supported during transition.
- Later migrate defaults and deprecate direct Hetzner use where appropriate.

## Verification Matrix

Before calling this complete, verify all of these:

- `computer` can create a JustAVPS-backed sandbox with no Hetzner env vars.
- JustAVPS machine create works using a standard customer API key.
- Webhooks drive progress end-to-end into `computer` SSE/UI.
- `computer` routes sandbox API traffic successfully after `services_ready`.
- Start / stop / restart / delete all work against the JustAVPS customer API.
- Billing succeeds for the JustAVPS customer account and is independent from Hetzner-specific pricing logic in `computer`.

## Anti-Patterns To Avoid

- Do not keep `JUSTAVPS_PROVIDER` in `computer` long-term.
- Do not keep `JUSTAVPS_IMAGE_ID` in `computer` long-term if the public API gains a cleaner template abstraction.
- Do not make `computer` depend on JustAVPS consumer proxy URLs for sandbox control-plane access.
- Do not hardcode Hetzner naming into generic provider flows.
- Do not add a secret internal endpoint that bypasses the normal JustAVPS customer contract.

## Recommended Defaults

- Use a dedicated JustAVPS customer account per `computer` environment.
- Use API keys + signed webhooks as the service-to-service auth model.
- Use `template_id = kortix-sandbox` as the stable product contract.
- Use `sandbox_api_url` / public IP for `computer` runtime connectivity in v1.
- Keep JustAVPS proxy/IDE features optional extras, not hard dependencies for `computer`.

## Open Questions

These are worth deciding, but they do not block the core direction:

1. Should JustAVPS expose a formal `templates` endpoint immediately, or is a config-backed `template_id` registry enough for v1?
2. Should `computer` price JustAVPS-backed compute directly from JustAVPS plan pricing, or via its own separate pricing table?
3. Do we want org/service-account support in JustAVPS now, or is one dedicated customer user per environment enough for v1?
4. Should JustAVPS return only `public_ip`, or both `public_ip` and an explicit `sandbox_api_url` / `agent_url` field?

## Recommendation

Implement this as a strict customer-boundary integration:

- JustAVPS becomes the only infra provider `computer` talks to in this path.
- JustAVPS hides Hetzner completely from `computer`.
- `computer` consumes plans, templates, lifecycle APIs, and webhooks exactly like any serious infra customer would.

That gives you the clean dogfood loop you want: you are your own first infrastructure customer, without baking JustAVPS internals into `computer` forever.
