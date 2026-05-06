# Billing System API v2 — Actual Month-to-Date Cost Breakdown Spec

Status: draft implementation spec  
Date: 2026-05-04  
Scope: `apps/v2-api`, `apps/admin-web`

## 0. Executive decision

Build one centralized Billing API v2 and one Cost Breakdown page.

The page must show **actual month-to-date charges**, not projected monthly equivalents. Compute is bursty, so any `€/mo`, `Projected total`, or current-state × 730h math is misleading and must be removed from the product/operator UI outside the new Billing page.

Primary UI total:

> **Actual month-to-date** — finalized usage ledger total from the start of the selected month through the last completed billing hour.

The current in-flight hour may be shown separately as **unfinalized current hour**, but it must not be merged into the finalized actual total and must never be labeled projected.

## 1. Current-state investigation

### 1.1 Existing account cost breakdown is a projection, not actual usage

Current endpoint:

- `apps/v2-api/src/app.ts:5957` — `GET /admin/accounts/:id/cost-breakdown`
- `apps/v2-api/src/app.ts:3876` — hard-coded `BILLING_SECONDS_PER_MONTH = 730 * 3600`
- `apps/v2-api/src/app.ts:3896` — `machinePricingBreakdown(machine, incus?)`

Current behavior:

1. Fetches current machines/templates/warm pool policies.
2. Reads current Incus status and artifact sizes.
3. Multiplies current state by 730 hours.
4. Returns `total_eur_per_month` and `eur_per_month` component rows.

Why this is wrong for the desired page:

- If a machine ran for 2 hours then stopped, current compute is reported as `0`, even though the account did incur actual usage this month.
- If a machine is currently running, compute is reported as if it ran for all 730 hours, even if it started 5 minutes ago.
- Disk/snapshot/backup/template/pool storage is reported as current GB × 730h, not time-weighted GB-seconds for this month.
- Warm pool billing is read from `WarmPoolPolicy.metadata.billing`, which is a stored estimate/measurement snapshot, not a monthly usage ledger.

### 1.2 Existing UI labels expose the projection

Current account UI:

- `apps/admin-web/app/(workspace)/accounts/page.tsx:47` calls `/admin/accounts/:id/cost-breakdown`.
- `apps/admin-web/app/(workspace)/accounts/page.tsx:259` renders “Full cost breakdown”.
- `apps/admin-web/app/(workspace)/accounts/page.tsx:264` renders `Projected total` and appends `/mo`.

Other monetary mentions outside a single billing page:

- `apps/admin-web/app/(workspace)/accounts/page.tsx:108` account list shows `cost_summary.total_eur_per_month`.
- `apps/admin-web/app/(workspace)/machines/[id]/MachineDetailClient.tsx:767` machine detail `CostBreakdownCard` shows projected `pricing.total_eur_per_month`.
- `apps/admin-web/app/(workspace)/machines/[id]/MachineDetailClient.tsx:660` backup table has `Storage cost` and `/mo` artifact estimate.
- `apps/admin-web/app/(workspace)/templates/page.tsx:323,380,474,737,886,887` template/pool storage and hot resource monthly estimates.
- `apps/admin-web/app/(workspace)/warm-pools/page.tsx:193,208,241,291,294` warm pool billing estimates.

### 1.3 Existing partial ledger exists but is not enough for the desired page

Schema already has a partial metering foundation:

- `apps/v2-api/prisma/schema.prisma:437` — `SandboxUsageSession`
- `apps/v2-api/prisma/schema.prisma:466` — `CostLedgerEntry` for provider host cost
- `apps/v2-api/prisma/schema.prisma:485` — `RevenueLedgerEntry` for customer revenue

Workers already exist but are opt-in:

- `apps/v2-api/src/workers/index.ts:75` — cost tick worker writes provider cost ledger hourly.
- `apps/v2-api/src/workers/index.ts:215` — billing worker reconciles live Incus instances into sessions.

Gaps:

1. `RevenueLedgerEntry` is written only when a session closes. Running sessions do not appear in actual MTD totals until stop/delete.
2. `RevenueLedgerEntry` has only aggregate `microEur`; it does not store component-level vCPU/RAM/storage breakdown.
3. `SandboxUsageSession` only opens for running instances. A stopped machine with persistent disk but no open session is not continuously metered for storage.
4. Snapshot, backup, template image, and warm pool storage are not written to the actual usage ledger.
5. Billing worker currently keys live instances by `inst.name` in `apps/v2-api/src/workers/index.ts:242`. Product identity should be `inst.config['user.justavps.machine_id']` with `inst.name` only as Incus runtime name.
6. Existing worker comments promise storage-tail accounting, but current persistence does not implement a durable closed-hour storage ledger.

### 1.4 Provider cost and customer billing must stay separate

There are two different “cost” concepts:

- **Customer charge / billing usage**: what an account owes for actual vCPU/RAM/storage usage.
- **Provider cost / PnL**: what JustAVPS pays Hetzner for hosts.

Existing PnL routes use `CostLedgerEntry` and `RevenueLedgerEntry`:

- `apps/v2-api/src/app.ts:6812` — `GET /admin/pnl`
- `apps/v2-api/src/app.ts:6858` — `GET /admin/pnl/timeseries`

The new account Cost Breakdown page must use customer billing ledgers, not provider host cost ledgers. Provider cost stays in Fleet/PnL operator pages.

## 2. Product requirements

### 2.1 Must-have behavior

1. One centralized Billing API v2 is the only source of monetary customer/account breakdowns.
2. One Cost Breakdown page shows actual month-to-date charges for a selected account/month.
3. No projected monthly totals on the Cost Breakdown page.
4. No `/mo` labels on the Cost Breakdown page unless explicitly in a rate explanation/debug drawer; primary amounts are actual charges for a window.
5. Billing must be time-weighted from actual resource intervals:
   - running vCPU seconds
   - running RAM GB-seconds
   - machine disk GB-seconds
   - snapshot storage GiB-seconds
   - backup storage GiB-seconds
   - template image storage GiB-seconds
   - warm pool storage GiB-seconds
   - warm pool running vCPU/RAM seconds when pools are hot/running
6. If exact measurement is unavailable, the API must surface a coverage gap instead of silently rolling an estimate into actual totals.
7. Every ledger row must be idempotent and reconstructable.
8. Price/rate version used for each row must be stored with the row.
9. Existing non-billing endpoints/pages must stop returning or rendering account-level monetary amounts by default.

### 2.2 Non-goals for this iteration

- Stripe invoice generation.
- Customer-facing checkout/payment collection changes.
- Bandwidth billing, unless we only add reserved component keys for future use.
- GPU/VRAM billing. If GPU support is added later, it should be a new component such as `gpu_vram_gb_seconds`; current code only models vCPU/RAM/storage.

## 3. Billing semantics

### 3.1 Window semantics

For a selected month `YYYY-MM`:

- `period_start` = first instant of month in UTC.
- `period_end` = first instant of next month in UTC.
- `as_of` defaults to now.
- `finalized_through` = latest completed UTC hour that the billing hourly worker has fully written.

Primary total:

```text
actual_mtd_micro_eur = sum(ledger.micro_eur)
where account_id = selected account
and interval_start >= period_start
and interval_end <= min(period_end, finalized_through)
and ledger.status = 'finalized'
```

Optional secondary total:

```text
unfinalized_current_hour_micro_eur = sum(unfinalized ledger rows or live accumulator)
where interval overlaps [finalized_through, as_of]
and status = 'open' | 'unfinalized'
```

UI copy:

- Primary stat: `Actual month-to-date`
- Secondary small stat: `Current hour accumulating` if present
- Never: `Projected total`

### 3.2 Resource charge formulas

All persisted billing math uses integer micro-euros at write boundary.

Running vCPU:

```text
micro_eur = vcpu_seconds * rate.vcpu_hot_micro_eur_per_sec
```

Running RAM:

```text
micro_eur = ram_gb_seconds * rate.ram_gb_hot_micro_eur_per_sec
```

Local storage:

```text
micro_eur = storage_gib_seconds * rate.storage_gb_local_micro_eur_per_sec
```

Archive storage:

```text
micro_eur = archive_gib_seconds * rate.storage_gb_archive_micro_eur_per_sec
```

Notes:

- Existing `DEFAULT_PRICING` in `apps/v2-api/src/economics/pricing.ts` can seed the initial price version.
- Machine disk is billed from provisioned persistent disk size unless exact local volume usage becomes product policy. The current UI says provisioned disk for machine disks and exact measured bytes for artifacts; keep that distinction explicit in `measurement_source`.
- Snapshot/backup/template/warm-pool artifact storage uses exact Incus-reported bytes when available. Missing exact bytes create coverage warnings.

### 3.3 Lifecycle semantics

Machine create:

- Start machine disk storage billing once Incus create succeeds and the product machine exists.
- Start compute billing only once Incus reports the instance as `Running`.

Machine stop:

- Stop vCPU/RAM billing at the observed stop transition time.
- Continue machine disk storage billing while persistent root volume exists.

Machine start/restart:

- Start/resume compute billing when Incus reports `Running`.
- Restart should not duplicate storage intervals.

Machine resize:

- Close the prior resource interval at resize effective time.
- Open a new interval with the new vCPU/RAM/disk shape.

Machine delete:

- Stop compute and machine disk storage at the observed Incus deletion time.
- Snapshot/backup/template artifacts continue billing if they still exist.

Warm pool:

- Stopped warm pool slots bill measured/provisioned slot storage only.
- Running hot pool slots bill storage plus running vCPU/RAM while they are actually running.
- When a warm pool slot is claimed into a customer machine, close the warm-pool source interval and open normal machine intervals under the owning account/machine.

Backups/snapshots/templates:

- Start storage billing when the artifact create operation succeeds and exact/accepted measurement exists.
- End storage billing when Incus deletion is observed.
- Backups that include pinned restore snapshots must include both tarball bytes and pinned snapshot bytes as separate subcomponents.

## 4. Data model changes

Keep existing `SandboxUsageSession`, `CostLedgerEntry`, and `RevenueLedgerEntry` initially for compatibility/PnL, but add Billing v2 tables. Do not overload the old aggregate revenue ledger for the detailed cost breakdown page.

### 4.1 `v2_ops.billing_price_versions`

Purpose: versioned customer billing rates.

Fields:

```prisma
model BillingPriceVersion {
  id          String    @id @default(cuid())
  code        String    @unique // e.g. default-2026-05-04
  currency    String    @default("EUR")
  rates       Json      // exact Pricing shape + optional future keys
  effectiveAt DateTime  @map("effective_at")
  retiredAt   DateTime? @map("retired_at")
  metadata    Json      @default("{}")
  createdAt   DateTime  @default(now()) @map("created_at")

  @@index([effectiveAt, retiredAt])
  @@map("billing_price_versions")
  @@schema("v2_ops")
}
```

Seed initial row from `DEFAULT_PRICING`.

### 4.2 `v2_ops.billing_ledger_entries`

Purpose: append-only finalized/unfinalized customer charge line items. This is the source of truth for the Cost Breakdown page.

Fields:

```prisma
model BillingLedgerEntry {
  id                  String   @id @default(cuid())
  accountId           String   @map("account_id")
  machineId           String?  @map("machine_id")
  sourceType          String   @map("source_type") // machine | snapshot | backup | template | warm_pool
  sourceId            String   @map("source_id")
  component           String   // running_vcpu | running_ram | machine_disk | snapshot_storage | ...
  region              String?
  intervalStart       DateTime @map("interval_start")
  intervalEnd         DateTime @map("interval_end")
  quantity            Decimal  @db.Decimal(30, 9) // vcpu_seconds or gib_seconds
  quantityUnit        String   @map("quantity_unit") // vcpu_second | ram_gb_second | storage_gib_second
  rateMicroEurPerUnit Decimal  @map("rate_micro_eur_per_unit") @db.Decimal(20, 9)
  priceVersionId      String   @map("price_version_id")
  microEur            BigInt   @map("micro_eur")
  status              String   @default("finalized") // finalized | unfinalized | void
  measurementSource   String   @map("measurement_source") // incus_status | incus_volume_state | provisioned_limit | incus_backup_size | incus_image_size
  measurementExact    Boolean  @default(true) @map("measurement_exact")
  idempotencyKey      String   @unique @map("idempotency_key")
  metadata            Json     @default("{}")
  createdAt           DateTime @default(now()) @map("created_at")

  @@index([accountId, intervalStart])
  @@index([machineId, intervalStart])
  @@index([sourceType, sourceId, intervalStart])
  @@index([component, intervalStart])
  @@map("billing_ledger_entries")
  @@schema("v2_ops")
}
```

Idempotency key format:

```text
bv2:{account_id}:{source_type}:{source_id}:{component}:{interval_start_iso}:{interval_end_iso}:{price_version_id}:{quantity_hash}
```

If a row must be corrected, write a compensating negative row or void the old row with a metadata reason; do not mutate finalized amounts in place except status transitions from `unfinalized` to `finalized`.

### 4.3 `v2_ops.billing_measurements`

Purpose: raw measurement observations used to explain ledger rows and detect gaps.

Fields:

```prisma
model BillingMeasurement {
  id                String   @id @default(cuid())
  accountId         String?  @map("account_id")
  machineId         String?  @map("machine_id")
  sourceType        String   @map("source_type")
  sourceId          String   @map("source_id")
  measuredAt        DateTime @map("measured_at")
  observedStatus    String?  @map("observed_status")
  vcpu              Int?
  ramGb             Decimal? @map("ram_gb") @db.Decimal(20, 9)
  storageGib        Decimal? @map("storage_gib") @db.Decimal(20, 9)
  measuredBytes     BigInt?  @map("measured_bytes")
  measurementSource String   @map("measurement_source")
  exact             Boolean  @default(true)
  metadata          Json     @default("{}")
  createdAt         DateTime @default(now()) @map("created_at")

  @@index([accountId, measuredAt])
  @@index([sourceType, sourceId, measuredAt])
  @@map("billing_measurements")
  @@schema("v2_ops")
}
```

The ledger can be rebuilt from measurements + price versions for debugging/backfills.

### 4.4 Optional compatibility bridge

For existing PnL routes, either:

1. Continue writing old `RevenueLedgerEntry` from Billing v2 finalized rows as an aggregate mirror, or
2. Update PnL routes to sum Billing v2 revenue rows directly.

Recommendation: keep old `RevenueLedgerEntry` as a mirror for one migration cycle, then remove/replace once Fleet/PnL is moved.

## 5. Billing API v2 contract

All routes are admin guarded initially, matching current admin dashboard. A customer-facing `/account/billing/v2/...` wrapper can come later once auth is ready.

### 5.1 `GET /admin/billing/v2/accounts/:accountId/statement`

Query:

- `month=YYYY-MM` optional; default current UTC month.
- `from=ISO` and `to=ISO` optional advanced window override.
- `include_unfinalized=true|false` default `false`.
- `group_by=component|machine|source` optional; response always includes component summary.

Response:

```json
{
  "account": { "id": "...", "name": "...", "slug": "...", "type": "organization" },
  "window": {
    "from": "2026-05-01T00:00:00.000Z",
    "to": "2026-06-01T00:00:00.000Z",
    "as_of": "2026-05-04T14:23:00.000Z",
    "finalized_through": "2026-05-04T14:00:00.000Z"
  },
  "currency": "EUR",
  "actual_mtd": {
    "micro_eur": "1234567",
    "eur": 1.234567
  },
  "unfinalized_current_hour": {
    "included": false,
    "micro_eur": "12345",
    "eur": 0.012345
  },
  "components": [
    {
      "key": "running_vcpu",
      "label": "Running vCPU",
      "quantity": 7200,
      "quantity_unit": "vcpu_second",
      "eur": 0.03168
    },
    {
      "key": "running_ram",
      "label": "Running RAM",
      "quantity": 14400,
      "quantity_unit": "ram_gb_second",
      "eur": 0.01872
    },
    {
      "key": "machine_disk",
      "label": "Machine disk storage",
      "quantity": 72000,
      "quantity_unit": "storage_gib_second",
      "eur": 0.01224
    }
  ],
  "sources": [
    {
      "source_type": "machine",
      "source_id": "mch_...",
      "machine_id": "mch_...",
      "name": "runner-1",
      "eur": 0.06264,
      "components": ["running_vcpu", "running_ram", "machine_disk"]
    }
  ],
  "hourly": [
    {
      "hour": "2026-05-04T13:00:00.000Z",
      "eur": 0.01566,
      "components": { "running_vcpu": 0.00792, "running_ram": 0.00468, "machine_disk": 0.00306 }
    }
  ],
  "coverage": {
    "status": "complete",
    "missing_hours": [],
    "unmeasured_sources": [],
    "warnings": []
  }
}
```

Important response rules:

- Use string for raw `micro_eur` BigInt values.
- Use numeric `eur` only for display; never recompute from floats.
- Do not return `total_eur_per_month`, `eur_per_month`, `seconds_per_month`, or `Projected` fields.

### 5.2 `GET /admin/billing/v2/accounts/:accountId/ledger`

Raw ledger inspection.

Query:

- `from=ISO`
- `to=ISO`
- `component=...` optional
- `source_type=...` optional
- `source_id=...` optional
- `limit=1..1000` default `200`

Response:

```json
{
  "entries": [
    {
      "id": "cle...",
      "account_id": "...",
      "machine_id": "...",
      "source_type": "machine",
      "source_id": "...",
      "component": "running_vcpu",
      "interval_start": "...",
      "interval_end": "...",
      "quantity": "3600.000000000",
      "quantity_unit": "vcpu_second",
      "rate_micro_eur_per_unit": "4.400000000",
      "price_version_id": "...",
      "micro_eur": "15840",
      "status": "finalized",
      "measurement_source": "incus_status",
      "measurement_exact": true,
      "metadata": {}
    }
  ]
}
```

### 5.3 `GET /admin/billing/v2/accounts/:accountId/hourly`

Optimized endpoint for charts/table drilldown.

Query:

- `from=ISO`
- `to=ISO`
- `group_by=component|machine|source` default `component`

Response:

```json
{
  "window": { "from": "...", "to": "..." },
  "group_by": "component",
  "buckets": [
    {
      "hour": "2026-05-04T13:00:00.000Z",
      "groups": [
        { "key": "running_vcpu", "eur": 0.00792, "micro_eur": "7920" }
      ]
    }
  ]
}
```

### 5.4 `POST /admin/billing/v2/reconcile`

Operator-only manual reconciliation/backfill trigger.

Body:

```json
{
  "account_id": "optional-account",
  "from": "2026-05-01T00:00:00.000Z",
  "to": "2026-05-04T14:00:00.000Z",
  "mode": "dry_run"
}
```

Modes:

- `dry_run`: report gaps/actions without writing.
- `write_unfinalized`: write rows as unfinalized.
- `finalize`: write/finalize rows up to the last closed hour.

## 6. Worker design

### 6.1 New worker: `billing-v2-hourly-worker`

Runs every 1–5 minutes but finalizes only closed UTC hours.

Env:

- `V2_BILLING_V2_WORKER=on`
- `V2_BILLING_V2_TICK_MS=60000`
- `V2_BILLING_V2_INCLUDE_CURRENT_HOUR=false`

Responsibilities:

1. Read Incus instances across all clusters.
2. Resolve product identity from instance config:
   - `machine_id = user.justavps.machine_id`
   - `account_id = user.justavps.account_id`
   - `incus_instance_name = inst.name`
3. Join product DB machine rows when available.
4. Write raw `BillingMeasurement` rows for machine runtime/storage observations.
5. Emit idempotent component ledger rows for each closed hour.
6. Enumerate snapshot/backup/template/warm-pool artifacts and write storage measurements/ledger rows.
7. Surface measurement gaps instead of fabricating totals.

### 6.2 Event hooks still required

Polling alone can miss exact transition timestamps. Add billing hooks after successful lifecycle operations:

- machine create
- machine start
- machine stop
- machine resize
- machine delete
- snapshot create/delete
- backup create/delete
- template create/delete/archive
- warm pool refill/claim/delete/mode change

Hook behavior:

- Record a `BillingMeasurement` immediately.
- Close/open resource intervals at the operation success timestamp.
- Let hourly worker finalize ledger rows from those measurements.

The hourly worker remains the safety net for drift and external Incus changes.

### 6.3 Backfill plan

Backfill can be exact only after Billing v2 cutover.

For pre-cutover data:

- Existing `SandboxUsageSession` can reconstruct some running compute usage.
- Existing `RevenueLedgerEntry` can reconstruct aggregate revenue only, without component detail.
- Artifact historical existence/size cannot be reconstructed exactly unless Incus history exists.

Therefore:

1. Add `billing_v2_cutover_at` to API coverage metadata.
2. Mark pre-cutover windows as `coverage.status = "partial"`.
3. Do not mix old projected `/mo` estimates into actual MTD totals.

## 7. Admin web changes

### 7.1 New page

Add:

- `apps/admin-web/app/(workspace)/billing/page.tsx`
- Nav item in `apps/admin-web/components/shell/app-shell.tsx` under Admin: `Billing`

Page layout:

1. Account selector.
2. Month selector.
3. Top stats:
   - Actual month-to-date
   - Finalized through
   - Current hour accumulating (optional, separate)
   - Coverage status
4. Component table:
   - Component
   - Usage this month
   - Amount
5. Hourly chart/table.
6. Source drilldown grouped by machine/artifact/warm pool.
7. Coverage warnings panel.
8. Raw ledger drawer/link.

Required copy:

- “Actual month-to-date”
- “Finalized through HH:00 UTC”
- “Current hour is still accumulating and is not included in finalized total”

Forbidden copy on this page:

- “Projected total”
- “Projected”
- “€/mo” for totals
- “per month” for actual totals

### 7.2 Remove monetary UI outside Billing page

Accounts page:

- Remove cost summary from account list cards.
- Remove embedded `CostBreakdown` component.
- Add a `View billing` button/link for the selected account.
- Keep `Billing email` because it is account metadata, not a monetary cost mention.

Machine detail page:

- Remove `CostBreakdownCard`.
- Remove backup `Storage cost` column; replace with `Measured storage` if useful.
- If needed, add `View this machine in Billing` link.

Templates page:

- Remove `Pool estimate` monetary stat.
- Remove image storage `/mo` display; keep bytes/GiB.
- Remove pool `Storage/mo` and `Hot/mo`; keep measured storage and mode.

Warm pools page:

- Rename `Billing` column to `Measured resources` or remove monetary amount.
- Remove `Measured storage/mo`, `Stopped standby billing`, and hot CPU/RAM monetary text.
- Keep readiness, target, measured GiB, missing measurement warnings.

### 7.3 Remove monetary fields from non-billing API responses by default

After the Billing page uses API v2:

- Remove `pricing` from `serializeMachine()` or gate behind `?include_legacy_pricing=true` temporarily.
- Remove `cost_summary` from `GET /admin/accounts`.
- Remove `cost_attribution` monetary object from snapshot/backup list responses; keep raw `metered_bytes`/`billable_gib` if useful.
- Stop returning `total_eur_per_month`/`eur_per_month` from non-billing endpoints unless route is explicitly in `/admin/billing/v2`.

## 8. Implementation plan

### Phase 1 — Data + pure billing library

Files:

- `apps/v2-api/prisma/schema.prisma`
- new migration under `apps/v2-api/prisma/migrations/*_billing_v2_actual_mtd/`
- `apps/v2-api/src/billing/prices.ts`
- `apps/v2-api/src/billing/ledger.ts`
- `apps/v2-api/src/billing/aggregate.ts`
- tests under `apps/v2-api/src/billing/*.test.ts`

Deliverables:

- Price version seed helper.
- Pure functions for:
  - interval splitting by hour
  - component quantity calculation
  - micro-eur calculation
  - aggregation by component/hour/source
  - coverage gap detection

### Phase 2 — Billing API v2 routes

Files:

- `apps/v2-api/src/app.ts` route registration or a small `src/billing/routes.ts` invoked from `createApp`
- `apps/v2-api/src/schemas.ts` OpenAPI schemas for Billing v2

Deliverables:

- `GET /admin/billing/v2/accounts/:accountId/statement`
- `GET /admin/billing/v2/accounts/:accountId/ledger`
- `GET /admin/billing/v2/accounts/:accountId/hourly`
- `POST /admin/billing/v2/reconcile`

### Phase 3 — Worker + lifecycle hooks

Files:

- `apps/v2-api/src/workers/billingV2Worker.ts`
- `apps/v2-api/src/workers/index.ts`
- lifecycle route touchpoints in `apps/v2-api/src/app.ts`

Deliverables:

- Closed-hour ledger rows for machine compute/storage.
- Closed-hour ledger rows for snapshots/backups/templates/warm pools.
- Exact identity mapping from `user.justavps.machine_id` and `user.justavps.account_id`.
- No duplicate rows across repeated ticks.

### Phase 4 — Admin web Billing page + cleanup

Files:

- `apps/admin-web/app/(workspace)/billing/page.tsx`
- `apps/admin-web/components/shell/app-shell.tsx`
- `apps/admin-web/lib/api.ts`
- cleanup pages listed in section 7.2

Deliverables:

- One Billing nav/page.
- Accounts page links to Billing instead of embedding estimates.
- Machine/templates/warm-pools pages no longer display monetary estimates.

### Phase 5 — Deprecate old projected endpoint

Options:

1. Remove `GET /admin/accounts/:id/cost-breakdown` entirely.
2. Return `410 Gone` with `{ replacement: "/admin/billing/v2/accounts/:id/statement" }`.
3. Temporarily alias to the v2 statement with no projected fields.

Recommendation: option 2 for one migration cycle, then delete.

## 9. Acceptance criteria

### 9.1 Backend correctness

Seeded fixture:

- Account `acct_1`
- Machine `m1`:
  - 2 vCPU, 4 GB RAM, 20 GiB disk
  - Running from `2026-05-04T10:15:00Z` to `2026-05-04T12:45:00Z`
  - Stopped but disk retained from `12:45` to `14:00`
- Snapshot `s1`:
  - 5 GiB from `11:00` to `14:00`

Expected finalized through `14:00`:

- Running vCPU seconds: `2 * 9000 = 18000`
- Running RAM GB-seconds: `4 * 9000 = 36000`
- Machine disk GiB-seconds: `20 * 13500 = 270000`
- Snapshot storage GiB-seconds: `5 * 10800 = 54000`

The statement endpoint must return these quantities exactly and micro-eur totals derived from the active price version.

### 9.2 Idempotency

Running the billing worker twice for the same closed hour must not change totals or create duplicate rows.

### 9.3 No projection leakage

Admin web should have no projected-cost copy outside implementation history/docs:

```bash
pnpm --dir apps/admin-web lint
```

Manual grep target for source cleanup after implementation:

```text
apps/admin-web/** should not contain: "Projected total", "eur_per_month", "total_eur_per_month", "/mo" except rate/debug copy inside the Billing page if explicitly justified.
```

Backend non-billing API cleanup target:

```text
GET /machines/:id response should not include pricing by default.
GET /admin/accounts response should not include cost_summary.
GET /machines/:id/snapshots and /backups should not include cost_attribution monetary fields by default.
```

### 9.4 API verification commands

Run from `justavps.com`:

```bash
pnpm --dir apps/v2-api test
pnpm --dir apps/v2-api typecheck
pnpm --dir apps/admin-web lint
```

If UI is implemented in the same batch, also run the relevant Playwright flow after starting dev servers, per repo E2E rules.

## 10. Naming standard

Use these terms consistently:

- `Billing API v2` — backend API namespace.
- `Cost Breakdown` — UI page title is acceptable because the user asked for a cost breakdown page.
- `Actual month-to-date` — primary total label.
- `Finalized through` — ledger completeness label.
- `Unfinalized current hour` — optional live/current-hour label.
- `Amount` — table column for actual charges.
- `Usage this month` — table column for quantities.

Avoid these terms in customer/account UI:

- `Projected total`
- `Projected`
- `€/mo` as a total suffix
- `per month` for actual totals
- `estimate` unless shown in coverage warnings and excluded from actual totals

## 11. Hard implementation notes

1. Do not reuse `BILLING_SECONDS_PER_MONTH` for the Cost Breakdown page.
2. Do not compute actual MTD from current status × 730h.
3. Do not trust Incus instance name as product machine ID; read `user.justavps.machine_id`.
4. Do not silently fold missing artifact measurements into totals.
5. Do not mutate finalized ledger rows for normal corrections; use void/compensating rows.
6. Keep provider host costs (`CostLedgerEntry`) out of account statements.
7. Keep all money persisted in integer micro-euros.
8. Keep all display euros derived from persisted micro-euros.
9. Keep price version on every ledger row.
10. Treat the old `/admin/accounts/:id/cost-breakdown` endpoint as deprecated immediately after v2 ships.
