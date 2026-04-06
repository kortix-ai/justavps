# JustAVPS Incus V2 — Real-host E2E handoff (2026-04-04)

## Purpose

This is the continuation handoff after the session that completed the real-host Incus V2 E2E proof work.

It is based on the current verified repository state plus the live-host/session outcomes that this branch was worked toward.

---

## Current repo / branch status

- repo: `/Users/markokraemer/Projects/heyagi/justavps.com`
- branch: `feat/incus-v2-provider`
- HEAD: `3a5a2d3` (`wip: scaffold bare-metal incus provider v1`)
- worktree status: dirty
- `git status --short` entry count at verification time: `73`

### Major currently modified or newly added files relevant to this session

- `runnerd/src/index.ts`
- `src/server/lib/providers/baremetal.ts`
- `src/server/lib/machine-lifecycle.ts`
- `src/server/lib/baremetal/runner-client.ts`
- `src/server/lib/baremetal/types.ts`
- `src/__tests__/lib/cloud-init.test.ts`
- `src/__tests__/lib/machine-lifecycle.test.ts`
- `src/__tests__/lib/baremetal-provider.test.ts`
- `src/server/routes/v2/images.ts`
- `docs/spec-incus-v2-provider.md`
- `screenshots/api-docs-v1.png`
- `screenshots/api-docs-v2.png`
- `screenshots/api-docs-v2-tunnel.png`
- `screenshots/v1-machines-version-switcher.png`
- `screenshots/v2-machines-version-switcher.png`

Important: there are many unrelated WIP branch changes outside the exact real-host fixes. Future work must review `git status` carefully before touching or committing anything.

---

## Prior handoff reviewed

The prior handoff reviewed for continuity was:

- `.kortix/docs/context/2026-04-03-full-thread-handoff-incus-v2.md`

This new handoff should be treated as the follow-on state after the real-host E2E proof work that happened after that earlier writeup.

---

## Host facts

- Hetzner dedicated host id: `ed822eae-59ef-4601-8782-a17cc85196ab`
- host IPv4: `135.181.129.188`

---

## What was fixed in this session

### 1. runnerd cloud-init wait timeout fix

Implemented in `runnerd/src/index.ts`.

Key behavior now:

- create path waits for the instance to appear
- waits for private IPv4 assignment
- waits for `cloud-init status --wait` with retry handling for transient Incus/guest timing failures
- uses more resilient Incus command wrappers for busy/transient errors

This is the main fix for the earlier create/readiness path timing out too early on the real host.

### 2. orphan baremetal cleanup fix when create fails before `providerServerId` save

Implemented in `src/server/lib/machine-lifecycle.ts` and `src/server/lib/providers/baremetal.ts`.

Key behavior now:

- cleanup falls back to `justavps-${machine.slug}` for baremetal machines when `providerServerId` was never persisted
- baremetal host lookup can resolve by either `providerServerId` or the slug-derived fallback

This closes the failure mode where a real Incus instance could exist on-host even though app DB persistence had not yet saved `providerServerId`.

### 3. real baremetal image delete path implemented end-to-end

Implemented across:

- `runnerd/src/index.ts`
- `src/server/lib/baremetal/runner-client.ts`
- `src/server/lib/baremetal/types.ts`
- `src/server/lib/providers/baremetal.ts`
- `src/server/routes/v2/images.ts`

Key behavior now:

- runnerd exposes `DELETE /v1/images/:id`
- runner client supports `deleteImage(imageId)`
- baremetal provider fans image deletion out across active runner-connected hosts, tolerating not-found responses
- V2 image deletion path now reaches the real host instead of being a stub/no-op

### 4. test coverage adjusted with the fixes

Relevant tests updated:

- `src/__tests__/lib/cloud-init.test.ts`
- `src/__tests__/lib/machine-lifecycle.test.ts`
- `src/__tests__/lib/baremetal-provider.test.ts`

---

## What was verified on the real host

The session’s real-host proof covered all of the following on host `135.181.129.188`:

### Host / runnerd baseline

- clean Incus init/reset on the dedicated host
- runnerd working cleanly under systemd

### Direct runnerd lifecycle proof

Direct runnerd lifecycle was proven end-to-end for:

- create
- start
- stop
- reboot
- snapshot create
- snapshot restore
- snapshot delete
- image publish
- image delete
- instance delete

### Full app-level JustAVPS V2 proof via local app + real host

Full V2 flow was proven through local JustAVPS controlling the real host:

- create
- transition to ready via real stage/heartbeat callback
- stop
- start
- reboot
- snapshot create
- snapshot restore
- snapshot delete
- image create
- image delete
- machine delete

This is the key milestone that the earlier 2026-04-03 handoff explicitly said was not yet honestly complete.

### Browser/docs verification

Browser verification in this session covered the docs/versioned docs surfaces, with screenshots present under:

- `screenshots/api-docs-v1.png`
- `screenshots/api-docs-v2.png`
- `screenshots/api-docs-v2-tunnel.png`
- `screenshots/v1-machines-version-switcher.png`
- `screenshots/v2-machines-version-switcher.png`

Authenticated dashboard/browser verification beyond docs was not completed in-browser in this session.

---

## Final host state after proof

Final host state after the successful proof sequence:

- no running instances remained
- only the cached base Ubuntu image remained
- remote runnerd service still existed on the host and remained active under systemd

So the host was operationally clean from a workload perspective, but not “blank”; runnerd stayed installed/running and the base image cache remained.

---

## Current lint / test / typecheck state

Re-run against the current worktree on 2026-04-04:

- `pnpm vitest run` ✅ — `30 passed`, `1 skipped` files; `197 passed`, `2 skipped` tests
- `pnpm exec tsc --noEmit` ✅
- `pnpm eslint .` ✅ with warnings only — `16 warnings`, `0 errors`

Known warnings are still present; they do not currently block lint success.

---

## Important caveats / open issues

1. `.env` was temporarily pointed to a trycloudflare tunnel for callback proof, then reverted to `https://dev.justavps.com`.
2. ESLint still has `16` warnings, even though it now has no errors.
3. There are many unrelated WIP repo changes not created in this exact step, so future work must review git status carefully.
4. Authenticated dashboard/browser verification beyond docs was not completed in-browser in this session.
5. One prior machine run showed security tamper-style warnings around UFW / password-auth behavior and deserves future hardening review.
6. The remote runnerd service still exists on the host and is active under systemd even though the host is otherwise clean.

---

## Clear next steps for a future agent

1. Re-check `git status --short` before changing anything; isolate the exact files you intend to touch because this branch contains broad unrelated WIP.
2. If resuming real-host work, verify runnerd health first on `135.181.129.188` and confirm the host still has no leftover instances beyond the cached base Ubuntu image.
3. Decide whether to keep using `https://dev.justavps.com` for callbacks or intentionally switch to another callback origin for local E2E; do not leave a temporary tunnel URL in place accidentally.
4. If continuing image/snapshot work, start from the now-proven runnerd endpoints rather than reintroducing stubs or host-local manual steps.
5. Review the prior tamper/security warnings and audit cloud-init hardening behavior, especially UFW and SSH password-auth assumptions.
6. If browser verification is needed next, continue from docs into authenticated dashboard V2 flows and capture fresh screenshots/video evidence.
7. Before any commit, stage only files from the active continuation thread; do not assume the rest of the dirty worktree belongs to your change.

---

## Verification inputs used for this handoff

- `git branch --show-current`
- `git status --short`
- `git rev-parse --short HEAD`
- reread `.kortix/docs/context/2026-04-03-full-thread-handoff-incus-v2.md`
- reread current implementation files listed above
- verified screenshot file presence under `screenshots/`
- reran `pnpm vitest run`
- reran `pnpm exec tsc --noEmit`
- reran `pnpm eslint .`

This file is meant to be the clean continuation point for the next agent.
