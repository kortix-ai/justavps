# 2026-04-10 admin machines v2 route + NaN fix

## Changes made

- Added `src/app/v2/admin/machines/page.tsx` as a thin alias that reuses the canonical admin machines page component, so `/v2/admin/machines` resolves without creating a second admin implementation.
- Added defensive admin-machines UI helpers in `src/lib/admin-machines.ts` to sanitize invalid pagination numbers and health percentages before rendering.
- Updated the admin machines page to use those helpers for pagination labels, total page math, and health metric display so malformed payloads do not leak `NaN` into the UI.
- Added regression tests for the new helper behavior and for v1↔v2 version mapping of `/admin/machines`.

## Verification run

### Passing targeted checks

1. `curl -I -s -o /tmp/admin-machines-headers.txt -w "%{http_code} %{redirect_url}" http://localhost:4100/v2/admin/machines`
   - Result: `200`
2. `pnpm exec vitest run src/__tests__/lib/admin-machines.test.ts src/__tests__/lib/versioning.test.ts src/__tests__/routes/version-switcher.test.ts`
   - Result: `3 passed`, `9 passed`
3. `pnpm exec eslint "src/app/(dashboard)/admin/machines/page.tsx" "src/app/v2/admin/machines/page.tsx" "src/lib/admin-machines.ts" "src/__tests__/lib/admin-machines.test.ts" "src/__tests__/lib/versioning.test.ts" "src/__tests__/routes/version-switcher.test.ts"`
   - Result: passed

### Not clean yet / unrelated environment drift

4. `set -a && source .env && set +a && pnpm exec vitest run --config vitest.e2e.config.ts src/__tests__/e2e/admin-machines.test.ts`
   - Result: fails broadly with `401` responses instead of the expected authenticated admin API behavior.
   - This appears to be pre-existing auth/env drift in the older admin-machines E2E suite rather than a regression from the route alias or NaN guard changes.
