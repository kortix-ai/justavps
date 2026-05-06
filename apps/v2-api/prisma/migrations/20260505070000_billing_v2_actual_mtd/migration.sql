-- Billing API v2: actual month-to-date customer billing ledger.
-- Adds versioned rates, component-level customer ledger rows, and raw
-- measurements. Existing PnL/cost/revenue tables are left intact.

CREATE TABLE IF NOT EXISTS "v2_ops"."billing_price_versions" (
  "id"           TEXT NOT NULL,
  "code"         TEXT NOT NULL,
  "currency"     TEXT NOT NULL DEFAULT 'EUR',
  "rates"        JSONB NOT NULL,
  "effective_at" TIMESTAMP(3) NOT NULL,
  "retired_at"   TIMESTAMP(3),
  "metadata"     JSONB NOT NULL DEFAULT '{}',
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_price_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_price_versions_code_key"
  ON "v2_ops"."billing_price_versions"("code");

CREATE INDEX IF NOT EXISTS "billing_price_versions_effective_at_retired_at_idx"
  ON "v2_ops"."billing_price_versions"("effective_at", "retired_at");

CREATE TABLE IF NOT EXISTS "v2_ops"."billing_ledger_entries" (
  "id"                       TEXT NOT NULL,
  "account_id"               TEXT NOT NULL,
  "machine_id"               TEXT,
  "source_type"              TEXT NOT NULL,
  "source_id"                TEXT NOT NULL,
  "component"                TEXT NOT NULL,
  "region"                   TEXT,
  "interval_start"           TIMESTAMP(3) NOT NULL,
  "interval_end"             TIMESTAMP(3) NOT NULL,
  "quantity"                 DECIMAL(30,9) NOT NULL,
  "quantity_unit"            TEXT NOT NULL,
  "rate_micro_eur_per_unit"  DECIMAL(20,9) NOT NULL,
  "price_version_id"         TEXT NOT NULL,
  "micro_eur"                BIGINT NOT NULL,
  "status"                   TEXT NOT NULL DEFAULT 'finalized',
  "measurement_source"       TEXT NOT NULL,
  "measurement_exact"        BOOLEAN NOT NULL DEFAULT true,
  "idempotency_key"          TEXT NOT NULL,
  "metadata"                 JSONB NOT NULL DEFAULT '{}',
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_ledger_entries_idempotency_key_key"
  ON "v2_ops"."billing_ledger_entries"("idempotency_key");

CREATE INDEX IF NOT EXISTS "billing_ledger_entries_account_id_interval_start_idx"
  ON "v2_ops"."billing_ledger_entries"("account_id", "interval_start");

CREATE INDEX IF NOT EXISTS "billing_ledger_entries_machine_id_interval_start_idx"
  ON "v2_ops"."billing_ledger_entries"("machine_id", "interval_start");

CREATE INDEX IF NOT EXISTS "billing_ledger_entries_source_type_source_id_interval_start_idx"
  ON "v2_ops"."billing_ledger_entries"("source_type", "source_id", "interval_start");

CREATE INDEX IF NOT EXISTS "billing_ledger_entries_component_interval_start_idx"
  ON "v2_ops"."billing_ledger_entries"("component", "interval_start");

CREATE TABLE IF NOT EXISTS "v2_ops"."billing_measurements" (
  "id"                 TEXT NOT NULL,
  "account_id"         TEXT,
  "machine_id"         TEXT,
  "source_type"        TEXT NOT NULL,
  "source_id"          TEXT NOT NULL,
  "measured_at"        TIMESTAMP(3) NOT NULL,
  "observed_status"    TEXT,
  "vcpu"               INTEGER,
  "ram_gb"             DECIMAL(20,9),
  "storage_gib"        DECIMAL(20,9),
  "measured_bytes"     BIGINT,
  "measurement_source" TEXT NOT NULL,
  "exact"              BOOLEAN NOT NULL DEFAULT true,
  "metadata"           JSONB NOT NULL DEFAULT '{}',
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_measurements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "billing_measurements_account_id_measured_at_idx"
  ON "v2_ops"."billing_measurements"("account_id", "measured_at");

CREATE INDEX IF NOT EXISTS "billing_measurements_source_type_source_id_measured_at_idx"
  ON "v2_ops"."billing_measurements"("source_type", "source_id", "measured_at");
