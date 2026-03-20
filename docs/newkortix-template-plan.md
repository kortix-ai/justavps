## Goal

Ship a first-class `NEWKORTIX` template on JustAVPS so new machines default to the prebuilt JustAVPS/Kortix snapshot, while still supporting explicit template/image selection and a reliable `docker run on boot` path for custom public images.

## Current State

- `src/server/routes/v1/machines.ts:167` resolves a requested `image_id`, otherwise falls back to the latest public DB image or raw `ubuntu-24.04`.
- `src/server/lib/config.ts:12` already exposes `HETZNER_BASE_SNAPSHOT_ID`, but machine creation does not prefer it directly.
- `src/server/routes/v1/images.ts:63` only returns DB-backed images; there is no guaranteed built-in template surfaced from config.
- `src/server/lib/cloud-init.ts:65` has a Docker workload block, but it inlines image/entrypoint into a script without robust escaping and assumes a fixed container contract.
- `src/components/dashboard/provision-wizard.tsx:255` only exposes a raw Docker image field in advanced options, while `src/components/dashboard/create-machine-dialog.tsx:146` already has a template/image selection model.

## Success Criteria

- [ ] A built-in `NEWKORTIX` image/template is always available when a base snapshot is configured.
- [ ] Default machine creation uses the JustAVPS/Kortix snapshot instead of falling back to plain Ubuntu.
- [ ] Docker-image boot flow reliably runs `docker pull` + `docker run` via systemd without breaking the base machine.
- [ ] UI clearly exposes default/template/snapshot/docker choices in the main machine creation flow.
- [ ] Automated tests cover config-backed template resolution and Docker cloud-init generation.

## Plan

### Step 1: Add config-backed built-in template metadata
- Files to change: `src/server/lib/config.ts`, `src/server/routes/v1/images.ts`, `src/lib/schemas.ts`, `src/lib/types.ts`, related hooks/UI consumers.
- What to do: introduce explicit config for the built-in base snapshot/template (`NEWKORTIX`), surface it as a synthetic public image/template in the images API, and include enough metadata for UI labeling.
- Acceptance criteria: `/images` returns a visible built-in public template when the base snapshot env is set, even if the DB has no public image row.

### Step 2: Make machine creation prefer the JustAVPS snapshot
- Files to change: `src/server/routes/v1/machines.ts`, possibly shared helpers.
- What to do: centralize image resolution so create-machine defaults to the configured base snapshot/template, still supports explicit DB image selection, and only falls back to `ubuntu-24.04` when no snapshot is configured.
- Acceptance criteria: machine creation without `image_id` boots from the configured base snapshot, and selecting the built-in `NEWKORTIX` template resolves identically.

### Step 3: Harden Docker-on-boot behavior
- Files to change: `src/server/lib/cloud-init.ts`, related tests.
- What to do: generate a robust systemd-backed docker startup flow with proper shell escaping, container naming, restart behavior, optional command override, and clear stage reporting.
- Acceptance criteria: generated cloud-init safely handles custom image names and entrypoint/command values, and the base VPS services still start regardless of Docker workload use.

### Step 4: Unify the machine creation UI around templates/images
- Files to change: `src/components/dashboard/provision-wizard.tsx`, possibly shared UI helpers.
- What to do: replace the current advanced-only Docker field flow with the richer template/image selection flow so users can choose default `NEWKORTIX`, public templates, saved snapshots, or a custom Docker image in one place.
- Acceptance criteria: the main `/machines/new` flow visibly supports these four options and sends the correct API payload.

### Step 5: Verify with tests and focused E2E path
- Files to change: `src/__tests__/lib/cloud-init.test.ts`, route/API tests as needed, existing E2E docs/tests if touched.
- What to do: extend unit/integration coverage for built-in template listing, default image resolution, and Docker workload generation; then run lint and relevant tests, plus the focused provisioning contract/E2E checks available in-repo.
- Acceptance criteria: lint passes; relevant tests pass; Docker provisioning path is exercised at least through the API contract and cloud-init output, with any true infra-E2E constraints documented.

## Anti-Patterns

- Do not turn JustAVPS into a Docker image builder; custom Docker support must stay `docker run` on top of Ubuntu.
- Do not remove the plain-Ubuntu fallback entirely; keep it as the last-resort path when no snapshot is configured.
- Do not rely on DB-seeded public images as the only source of the built-in template.
- Do not break existing user-created snapshots or imported machine behavior.

## Risks

- Synthetic built-in template IDs can diverge from DB UUID expectations unless schema/types accept a stable non-UUID identifier.
- Docker command escaping can break boot if entrypoint/command strings are interpolated unsafely.
- Frontend may have multiple machine-creation UIs with overlapping behavior; changes need to keep them consistent.

## Verification

- Run `pnpm lint`.
- Run targeted Vitest suites for cloud-init and machine/image route behavior.
- Run the available machine lifecycle/API contract tests that validate Docker-image machine creation behavior without adding unrelated infra changes.
