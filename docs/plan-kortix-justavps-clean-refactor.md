# Kortix x JustAVPS Clean Refactor Spec

## Goal

Refactor the newly implemented JustAVPS integration so `computer/` consumes JustAVPS as a clean infrastructure customer, with no dependency on JustAVPS internals or lingering Hetzner-shaped assumptions.

At the same time, remove the direct Hetzner provider from `computer` entirely as a product surface. After this refactor, `computer` should expose JustAVPS as the only VPS-style provider. Hetzner may remain an implementation detail inside JustAVPS, but it should disappear from `computer` backend config, frontend UX, release tooling, and public provider choices.

This refactor is not about inventing a new integration from scratch. It is about taking the current first-pass adapter and hardening it into a stable contract that can survive provider changes, frontend evolution, and real production dogfooding.

## Current State

### What is already working

- `computer` has a real JustAVPS provider adapter in `computer/kortix-api/src/platform/providers/justavps.ts:189`.
- `computer` auto-registers a JustAVPS webhook and provisions machines through the public customer API in `computer/kortix-api/src/platform/providers/justavps.ts:152` and `computer/kortix-api/src/platform/providers/justavps.ts:290`.
- JustAVPS webhook intake and sandbox status propagation are wired in `computer/kortix-api/src/platform/routes/sandbox-webhooks.ts:24` and `computer/kortix-api/src/platform/services/sandbox-events.ts:38`.
- JustAVPS exposes real machine lifecycle APIs already: `POST /machines/{id}/stop` and `POST /machines/{id}/start` are implemented in `justavps.com/src/server/routes/v1/machines.ts:538` and `justavps.com/src/server/routes/v1/machines.ts:587`.
- JustAVPS already presents itself as a branded cloud layer, not forward-facing Hetzner, in `justavps.com/src/server/lib/providers/index.ts:7` and `justavps.com/src/server/lib/providers/hetzner.ts:143`.

### What is still wrong

- `computer` still requires and leaks JustAVPS internals via `JUSTAVPS_IMAGE_ID` in `computer/kortix-api/src/config.ts` and `computer/kortix-api/.env.example`.
- `computer` still sends infra-shaped create payloads with `provider`, `server_type`, `region`, and optional `image_id` in `computer/kortix-api/src/platform/providers/justavps.ts:308`.
- Generic provisioning paths in `computer` still use Hetzner-specific names like `hetznerServerType` and `hetznerLocation` in `computer/kortix-api/src/platform/services/ensure-sandbox.ts:18`, `computer/kortix-api/src/platform/routes/account.ts:100`, and `computer/kortix-api/src/billing/index.ts:118`.
- JustAVPS public create-machine schema is still infra-shaped in `justavps.com/src/lib/schemas.ts:12`, and the live OpenAPI still reflects that.
- Frontend parity is incomplete: the setup wizard does not render a JustAVPS choice in `computer/apps/frontend/src/components/auth/self-hosted-auth.tsx:1093`, the instance manager excludes it from cloud handling in `computer/apps/frontend/src/components/sidebar/server-selector.tsx:637` and `computer/apps/frontend/src/components/sidebar/server-selector.tsx:769`, and cloud-mode detection ignores it in `computer/apps/frontend/src/stores/server-store.ts:607`.
- The JustAVPS adapter still has lifecycle bugs: `start()` calls reboot and `stop()` is effectively unsupported in `computer/kortix-api/src/platform/providers/justavps.ts:343`.
- The current JustAVPS readiness UI can falsely mark success after a timeout in `computer/apps/frontend/src/components/auth/self-hosted-auth.tsx:730`.
- `computer` still ships a full direct-Hetzner provider surface in `computer/kortix-api/src/platform/providers/index.ts:7`, `computer/kortix-api/src/platform/providers/hetzner.ts:1`, `computer/kortix-api/src/config.ts:124`, `computer/apps/frontend/src/stores/server-store.ts:23`, and multiple Hetzner-specific frontend flows.
- `computer` still owns Hetzner snapshot release machinery in `computer/package.json:15`, `computer/scripts/build-hetzner-snapshot.sh:1`, and `computer/sandbox/release.json:9`, even though the target model is for JustAVPS to own the VM/template layer.

## Success Criteria

- [ ] `computer` provisions JustAVPS sandboxes using only customer-facing identifiers: `template_id`, `plan_id`, `region`, `client_reference_id`.
- [ ] `computer` no longer requires `JUSTAVPS_IMAGE_ID` or other provider-internal identifiers.
- [ ] Generic `computer` provisioning APIs stop using Hetzner-specific names for shared provider flows.
- [ ] JustAVPS public API supports a stable customer contract while keeping backward compatibility for current clients.
- [ ] Frontend setup, onboarding, instance manager, remove flow, and cloud-mode detection treat `justavps` as a first-class provider.
- [ ] JustAVPS lifecycle operations in `computer` use `start`, `stop`, `reboot`, and `delete` correctly.
- [ ] Provisioning readiness is driven by explicit event/health success, never by timeout fallback.
- [ ] Both repos gain targeted tests for the new contract and lifecycle behavior.
- [ ] `computer` no longer exposes `hetzner` as a selectable provider in any backend route, config surface, or frontend UI.
- [ ] `computer` no longer calls the Hetzner API directly in production code.
- [ ] Hetzner-specific release/snapshot tooling is removed from `computer` and owned by JustAVPS instead.
- [ ] A migration path exists for any existing `sandboxes.provider = 'hetzner'` records before final code deletion.

## Non-Goals

- Do not redesign local Docker or Daytona in this pass.
- Do not remove backward compatibility on day one.
- Do not add a hidden internal-only JustAVPS endpoint just for `computer`.
- Do not broaden scope into auth, billing, or full self-contained-computer refactors unless directly required by this integration cleanup.
- Do not remove Hetzner from JustAVPS internals in this pass; the removal target is the direct Hetzner provider inside `computer`.

## Target Architecture

### Boundary

The boundary must become:

`computer` -> JustAVPS customer API -> JustAVPS orchestration -> underlying cloud provider

Not:

`computer` -> JustAVPS API + snapshot/provider knowledge -> Hetzner

### Stable JustAVPS customer contract

#### Machine create request

```json
{
  "template_id": "kortix-sandbox",
  "plan_id": "starter",
  "region": "nbg1",
  "name": "sandbox-abc123",
  "env_vars": {
    "KORTIX_TOKEN": "...",
    "KORTIX_API_URL": "https://api.kortix.com"
  },
  "client_reference_id": "kortix:sandbox:sbx_123",
  "metadata": {
    "upstream_system": "computer",
    "upstream_account_id": "acct_123",
    "upstream_sandbox_id": "sbx_123",
    "environment": "prod"
  }
}
```

#### Machine response

```json
{
  "id": "machine_uuid",
  "status": "provisioning",
  "provisioning_stage": "server_creating",
  "provider": "cloud",
  "template_id": "kortix-sandbox",
  "plan_id": "starter",
  "region": "nbg1",
  "client_reference_id": "kortix:sandbox:sbx_123",
  "network": {
    "public_ip": null,
    "sandbox_api_url": null
  },
  "urls": {
    "proxy": "https://slug.kortix.cloud",
    "terminal": "https://slug.kortix.cloud/_terminal",
    "port_template": "https://{port}--slug.kortix.cloud"
  }
}
```

#### Webhook payload

```json
{
  "event": "machine.stage_changed",
  "data": {
    "machineId": "machine_uuid",
    "event": "stage_changed",
    "stage": "services_ready",
    "status": "ready",
    "message": "Ready",
    "metadata": {
      "template_id": "kortix-sandbox",
      "plan_id": "starter",
      "region": "nbg1",
      "client_reference_id": "kortix:sandbox:sbx_123",
      "public_ip": "1.2.3.4",
      "sandbox_api_url": "http://1.2.3.4:8000",
      "upstream_system": "computer",
      "upstream_sandbox_id": "sbx_123"
    },
    "timestamp": "2026-03-20T00:00:00.000Z"
  }
}
```

### Stable `computer` provider contract

Shared provider inputs in `computer` should become:

- `provider`
- `planId`
- `region`
- optional provider-specific extras only when truly provider-specific

Shared provider inputs in `computer` should stop being named:

- `hetznerServerType`
- `hetznerLocation`

During the migration window, `planId` can temporarily map 1:1 to the current Hetzner server type for any hidden legacy compatibility paths, but that mapping should disappear with the direct-Hetzner provider removal.

### Provider replacement principle

Final provider set exposed by `computer`:

- `local_docker`
- `daytona`
- `justavps`

Provider set that should no longer be exposed by `computer`:

- `hetzner`

Important distinction:

- removing direct Hetzner from `computer` does **not** mean JustAVPS cannot keep using Hetzner under the hood
- it means `computer` never talks to Hetzner directly again
- all VPS-style provisioning, lifecycle, pricing, and template concerns move behind JustAVPS

## Plan

### Step 1: Freeze the public JustAVPS customer contract

- Files to change: `justavps.com/src/lib/schemas.ts:12`, `justavps.com/src/server/routes/v1/machines.ts:123`, `justavps.com/src/server/routes/v1/server-types.ts:37`
- What to do:
  - Add additive v2 fields to machine create: `template_id`, `plan_id`, `client_reference_id`, `metadata`
  - Add additive machine response fields: `template_id`, `plan_id`, `client_reference_id`, `network.public_ip`, `network.sandbox_api_url`
  - Keep existing v1 fields (`provider`, `server_type`, `image_id`) accepted for compatibility, but treat them as deprecated aliases at the route boundary
  - Add `GET /api/v1/plans` as the stable customer catalog
  - Add `GET /api/v1/templates` for supported machine profiles, starting with `kortix-sandbox`
  - Keep `GET /api/v1/server-types` working for old clients during migration
- Acceptance criteria:
  - Live OpenAPI contains the new customer-facing fields
  - Existing JustAVPS clients still work without immediate breakage
  - New fields are sufficient for `computer` to stop using snapshot/provider internals

### Step 2: Add JustAVPS internal translation layers for plans and templates

- Files to change: `justavps.com/src/server/lib/providers/hetzner.ts:16`, `justavps.com/src/server/lib/providers/index.ts:7`, `justavps.com/src/server/routes/v1/machines.ts:180`, `justavps.com/src/server/lib/machine-lifecycle.ts:63`
- What to do:
  - Introduce a plan catalog service that owns stable plan IDs like `starter`, `pro`, `power`, `ultra`
  - Introduce a template registry that owns stable template IDs like `kortix-sandbox`
  - Move request normalization out of the route so the route turns either old or new payloads into one internal provisioning request
  - Keep the underlying compute provider free to map plan/template choices to raw provider SKUs, images, Docker workload defaults, and readiness logic
- Acceptance criteria:
  - Plan selection no longer depends on `computer` knowing Hetzner SKUs
  - Template resolution no longer depends on `computer` knowing snapshot IDs
  - Provisioning path has one normalized input shape internally

### Step 3: Enrich serialization and webhook payloads for upstream reconciliation

- Files to change: `justavps.com/src/server/routes/v1/machines.ts:55`, `justavps.com/src/server/lib/event-bus.ts:32`, `justavps.com/src/server/lib/webhook-delivery.ts:28`
- What to do:
  - Include `plan_id`, `template_id`, `client_reference_id`, and direct network fields in machine responses
  - Include the same fields in webhook metadata
  - Guarantee that JustAVPS emits enough data for `computer` to reconcile sandbox state without extra JustAVPS read-after-write coupling
  - Preserve current event names: `machine.stage_changed`, `machine.status_changed`, `machine.heartbeat`
- Acceptance criteria:
  - `computer` can update DB state from webhook payload alone for normal provisioning progress
  - Webhook payloads contain `public_ip` or `sandbox_api_url` as soon as available

### Step 4: Refactor `computer` generic provider inputs away from Hetzner naming

- Files to change: `computer/kortix-api/src/platform/providers/index.ts:10`, `computer/kortix-api/src/platform/services/ensure-sandbox.ts:18`, `computer/kortix-api/src/platform/routes/account.ts:96`, `computer/kortix-api/src/platform/routes/sandbox-cloud.ts:144`, `computer/kortix-api/src/billing/index.ts:118`
- What to do:
  - Replace shared input names `hetznerServerType` and `hetznerLocation` with `planId` and `region`
  - Accept old field names at route boundaries for one compatibility window, but normalize immediately
  - Update serialized sandbox metadata to store generic keys like `planId`, `region`, `templateId`
  - During migration only, translate `planId` into the current Hetzner-specific selection model inside any hidden legacy compatibility path if needed
- Acceptance criteria:
  - No shared `computer` create/ensure path uses Hetzner-specific field names internally
  - Generic provider code stays neutral even after direct Hetzner is removed

### Step 5: Replace the current JustAVPS adapter with a pure customer adapter

- Files to change: `computer/kortix-api/src/platform/providers/justavps.ts:123`, `computer/kortix-api/src/platform/providers/justavps.ts:290`, `computer/kortix-api/src/config.ts:133`, `computer/kortix-api/.env.example:203`
- What to do:
  - Replace `JUSTAVPS_IMAGE_ID` with a cleaner customer-facing template/image abstraction if the public API grows one
  - Replace `JUSTAVPS_DEFAULT_SERVER_TYPE` with `JUSTAVPS_DEFAULT_PLAN_ID`
  - Replace `JUSTAVPS_DEFAULT_LOCATION` with `JUSTAVPS_DEFAULT_REGION`
  - Remove `JUSTAVPS_PROVIDER` from `computer`
  - Make the adapter send `template_id`, `plan_id`, `region`, `client_reference_id`, and upstream metadata
  - Consume new JustAVPS response fields and persist them directly into sandbox metadata/base URL
- Acceptance criteria:
  - `computer` JustAVPS mode works with no snapshot ID and no underlying-provider env var
  - All machine creation requests are expressed in customer-facing JustAVPS terms only

### Step 6: Fix JustAVPS lifecycle correctness in `computer`

- Files to change: `computer/kortix-api/src/platform/providers/justavps.ts:343`, `computer/kortix-api/src/platform/services/ensure-sandbox.ts:62`
- What to do:
  - Change `start()` to call JustAVPS `POST /machines/{id}/start`
  - Change `stop()` to call JustAVPS `POST /machines/{id}/stop`
  - Keep `reboot()` semantics distinct if/when the interface is extended
  - Fix stale-sandbox reactivation so async providers do not get marked `active` before they are actually ready
  - For async providers, reactivation should move the sandbox into a provisioning/recovering state and rely on webhook/readiness confirmation
- Acceptance criteria:
  - Stop/start behave the same way for JustAVPS as they do for the public JustAVPS API
  - Reactivated JustAVPS sandboxes cannot appear healthy before the provider says they are ready

### Step 7: Remove direct Hetzner as a public provider from `computer`

- Files to change: `computer/kortix-api/src/platform/providers/index.ts:1`, `computer/kortix-api/src/platform/providers/hetzner.ts:1`, `computer/kortix-api/src/config.ts:124`, `computer/kortix-api/src/setup/index.ts:307`, `computer/kortix-api/src/platform/routes/account.ts:83`, `computer/kortix-api/src/platform/routes/sandbox-cloud.ts:28`, `computer/packages/db/src/schema/kortix.ts:29`, `computer/apps/frontend/src/stores/server-store.ts:23`
- What to do:
  - Remove `hetzner` from the public `ProviderName` union and available-provider APIs in `computer`
  - Stop returning `hetzner` from `/v1/platform/providers` and `/v1/setup/sandbox-providers`
  - Remove direct Hetzner config requirements from `computer` (`HETZNER_API_KEY`, snapshot envs, default server type/location, etc.)
  - Remove the direct Hetzner provider implementation from active use; if needed, keep a temporary hidden legacy adapter only for migration of existing rows
  - Remove direct Hetzner server-type routes from `computer`; provider catalog for VPS should come from JustAVPS only
  - Plan the DB/provider enum migration so `sandbox_provider = 'hetzner'` is not removed until live rows are handled
- Acceptance criteria:
  - New `computer` installs can only provision VPS sandboxes through JustAVPS, not direct Hetzner
  - No public backend route in `computer` advertises or accepts `hetzner` as a provider
  - Direct Hetzner API access is gone from normal `computer` runtime paths

### Step 8: Migrate existing direct-Hetzner sandboxes safely

- Files to change: `computer/kortix-api/src/platform/providers/index.ts:66`, `computer/packages/db/src/schema/kortix.ts:29`, migration scripts/docs to be added in `computer/scripts/` or `computer/docs/`
- What to do:
  - Treat existing `sandboxes.provider = 'hetzner'` rows as a migration concern, not a permanent product feature
  - Recommended migration strategy:
    - immediately remove Hetzner from all user-facing create/setup/provider-selection flows
    - keep a hidden temporary legacy compatibility path only if needed to manage already-existing direct-Hetzner sandboxes during transition
    - migrate legacy sandboxes to JustAVPS by recreate-and-cutover unless a proper JustAVPS adoption/import path is implemented later
  - Add a migration checklist/command to inventory live legacy rows and track them to zero
  - Only after zero legacy rows remain, remove the enum variant and delete any temporary compatibility code
- Acceptance criteria:
  - Product surface moves to JustAVPS immediately for all new provisioning
  - Existing direct-Hetzner sandboxes are not orphaned during transition
  - Final removal of the `hetzner` provider happens only after live data is clear

### Step 9: Make frontend behavior provider-capability-driven instead of hardcoded

- Files to change: `computer/kortix-api/src/platform/routes/account.ts:83`, `computer/kortix-api/src/setup/index.ts:314`, `computer/apps/frontend/src/components/auth/self-hosted-auth.tsx:640`, `computer/apps/frontend/src/components/sidebar/server-selector.tsx:637`, `computer/apps/frontend/src/stores/server-store.ts:607`
- What to do:
  - Extend provider payloads from backend to include display name, cloud/local kind, async provisioning, events support, and preview-proxy behavior
  - Replace `provider === 'hetzner'` and `provider === 'daytona'` hardcoding with shared provider capability metadata
  - Treat `justavps` as a first-class cloud provider everywhere cloud behavior is determined
  - Centralize provider labels/icons so UI never falls back to generic "Cloud Sandbox" when it should say `JustAVPS Cloud`
- Acceptance criteria:
  - The setup wizard renders a JustAVPS choice
  - The instance manager create/remove flow treats JustAVPS like a cloud provider
  - `server-store` and URL helpers recognize `justavps` as cloud mode

### Step 10: Replace fake JustAVPS readiness polling with real event/health confirmation

- Files to change: `computer/apps/frontend/src/components/auth/self-hosted-auth.tsx:652`, `computer/kortix-api/src/platform/routes/sandbox-webhooks.ts:56`, `computer/apps/frontend/src/lib/platform-client.ts:112`
- What to do:
  - Remove the dead `EventSource` construction and replace it with a real authenticated fetch-SSE helper or an explicit polling helper
  - Never mark success on timeout fallback alone
  - Gate success on either:
    - a `services_ready`/`ready` event plus a successful `/kortix/health`, or
    - a verified sandbox endpoint response if events are missed
  - Surface timeout as an actionable error state instead of silently pretending success
- Acceptance criteria:
  - JustAVPS provisioning UI only transitions to ready after real confirmation
  - Timeouts produce an honest failure/retry path

### Step 11: Finish frontend parity and purge Hetzner wording everywhere

- Files to change: `computer/apps/frontend/src/components/auth/self-hosted-auth.tsx:1093`, `computer/apps/frontend/src/components/sidebar/server-selector.tsx:705`, `computer/apps/frontend/src/app/onboarding/page.tsx:154`, `computer/apps/frontend/src/app/(dashboard)/admin/sandboxes/page.tsx:116`
- What to do:
  - Replace the Hetzner setup choice with JustAVPS in the setup wizard
  - Replace Hetzner-only labels, icons, badges, onboarding timers, and delete messages everywhere in frontend flows
  - Make the instance manager treat JustAVPS as the VPS/cloud choice wherever Hetzner is currently hardcoded
  - Update admin/delete/status messages so they reflect JustAVPS when relevant
  - Keep the UI vocabulary aligned with the new backend capability metadata
- Acceptance criteria:
  - Every user-facing sandbox flow has a JustAVPS-aware label and behavior
  - No user-facing frontend copy in `computer` references direct Hetzner as a sandbox provider anymore
  - No JustAVPS-backed sandbox appears as generic or incorrectly as Hetzner

### Step 12: Remove Hetzner-specific release and snapshot ownership from `computer`

- Files to change: `computer/package.json`, `computer/scripts/release/build-justavps-image.cjs`, `computer/sandbox/release.json`, release docs/scripts that still assume direct provider snapshot ownership
- What to do:
  - Remove the direct Hetzner snapshot build script from the `computer` product surface
  - Remove legacy release commands that still imply direct provider snapshot ownership instead of the JustAVPS image flow
  - Remove `release.json.snapshots.hetzner` ownership from `computer`
  - Move template/snapshot ownership fully to JustAVPS pipelines and docs
- Acceptance criteria:
  - `computer` releases no longer imply direct ownership of Hetzner VM templates
  - JustAVPS becomes the only place responsible for VPS template/image management in this flow

### Step 13: Add compatibility and final removal plan

- Files to change: `computer/kortix-api/src/config.ts:133`, `computer/kortix-api/.env.example:203`, `justavps.com/src/lib/schemas.ts:12`, `justavps.com/src/server/routes/v1/machines.ts:164`
- What to do:
  - Support old and new create payloads in JustAVPS for one migration window
  - Support old and new env/config names in `computer` for one migration window where necessary
  - Log explicit deprecation warnings whenever old fields are used
  - Remove old fields only after dogfooding is green on dev and prod
  - After legacy sandboxes are gone, remove the hidden compatibility path, drop `hetzner` from the DB enum, and delete the remaining Hetzner-only code from `computer`
- Acceptance criteria:
  - Existing local setups do not break immediately
  - New installs follow only the cleaned-up contract
  - Final `computer` codebase has no direct-Hetzner provider surface left

## Testing and Verification

### JustAVPS

- Add route tests for new machine create fields and backward compatibility
- Add tests for `GET /plans` and `GET /templates`
- Add webhook payload tests asserting `plan_id`, `template_id`, `client_reference_id`, `public_ip`, and `sandbox_api_url`
- Verify live OpenAPI reflects the new contract

### Computer backend

- Add JustAVPS provider tests for request translation, lifecycle start/stop, and response parsing
- Add webhook processing tests for HMAC verification and sandbox metadata updates
- Add ensure/reactivation tests for async JustAVPS behavior
- Add migration/inventory tests or scripts for legacy `provider = 'hetzner'` sandbox handling until removal is complete

### Computer frontend

- Lint frontend changes only unless an explicit build is approved
- Verify setup wizard, onboarding, instance manager, and delete flow with `justavps`
- Verify cloud-mode URL logic with a JustAVPS-backed sandbox
- Verify no frontend route or component still offers direct Hetzner as a provider

### Dogfood flow

- Provision a real sandbox from `computer` into a real JustAVPS customer account
- Confirm webhook registration succeeds
- Confirm create, stop, start, restart, delete, and recovery all work
- Confirm dashboard does not route early before `/kortix/health` is genuinely ready
- Confirm a fresh `computer` environment can operate with no `HETZNER_*` runtime env vars

## Risks

- Additive contract work in JustAVPS can sprawl if old/new request shapes are normalized in too many places; keep translation at the route boundary.
- Renaming generic provider fields in `computer` touches backend and frontend at once; do the compatibility layer first, then cut consumers over.
- Async reactivation behavior can regress stopped-sandbox UX if status transitions are not explicit and tested.
- UI hardcoding is spread across setup, onboarding, server store, and admin views; centralize provider metadata early to avoid whack-a-mole fixes.
- Full Hetzner removal in `computer` is blocked by live legacy rows if we delete support too early; inventory and migration must happen before final code deletion.
- Snapshot/release ownership can get split-brain if `computer` and JustAVPS both keep owning VM templates; move ownership decisively to JustAVPS.

## Anti-Patterns

- Do not keep `JUSTAVPS_PROVIDER` in `computer` after this refactor.
- Do not require `JUSTAVPS_IMAGE_ID` in `computer` after a cleaner customer-facing template flow exists.
- Do not special-case JustAVPS forever in frontend code when provider capability metadata can drive behavior.
- Do not mark a JustAVPS sandbox ready because a timeout expired.
- Do not remove the current public JustAVPS fields until compatibility coverage exists.
- Do not leave `hetzner` exposed in frontend/provider lists while claiming JustAVPS is the sole VPS path.
- Do not delete direct-Hetzner runtime support before legacy sandboxes are inventoried and handled.

## Recommended Execution Order

1. JustAVPS contract additions and internal plan/template translation
2. JustAVPS webhook/serialization enrichment
3. `computer` backend normalization (`planId`, `region`, new env vars, adapter cleanup)
4. remove direct Hetzner from all new/public `computer` flows
5. lifecycle correctness fixes (`start`, `stop`, async reactivation)
6. provider-capability metadata and frontend parity
7. legacy Hetzner sandbox migration/inventory
8. remove Hetzner release ownership from `computer`
9. tests and real dogfooding
10. final removal of compatibility code after validation

## Recommendation

Implement this as an additive compatibility refactor, not a big-bang rewrite.

That gives you the clean boundary you want without destabilizing the already-working first pass:

- JustAVPS becomes a real stable infra-customer API
- `computer` stops knowing snapshots and hidden provider details
- direct Hetzner disappears from `computer` as a user-facing or runtime provider
- frontend parity becomes complete instead of half-hardcoded
- lifecycle behavior becomes honest and production-safe
