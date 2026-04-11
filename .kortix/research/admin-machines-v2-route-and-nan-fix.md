# Admin machines v2 route and NaN-state findings

- The project already had the canonical admin machines page at `src/app/(dashboard)/admin/machines/page.tsx` and the API at `/api/v1/admin/machines`, but no `src/app/v2/admin/machines/page.tsx` route, which is why `/v2/admin/machines` returned 404.
- The cleanest fix was an alias page that reuses the canonical page component, instead of introducing a second admin implementation or bouncing users between competing admin screens.
- The admin machines page had direct rendering of pagination values (`data.offset`, `data.total`) and health values without defensive coercion. If those values were missing/invalid during partial payloads or transient states, the UI could surface malformed number output.
- A small helper layer now normalizes pagination and health display so invalid values degrade to safe defaults instead of `NaN`.
