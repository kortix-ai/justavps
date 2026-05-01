-- Fleet management schema additions:
--   1. Region table (canonical metadata; soft-referenced by region code).
--   2. Host lifecycle columns (lifecycle_state, sku, cost, joined/drained/terminated timestamps).
--   3. Append-only timeseries: node_utilization_samples, sandbox_usage_sessions.
--   4. Append-only ledgers: cost_ledger_entries, revenue_ledger_entries.
--   5. ScalingProposal: autoscale proposal queue.
--
-- All non-destructive — only ADDS tables/columns/indexes. Existing rows
-- in `hosts` get the default lifecycle_state='online' which matches their
-- current behavior (already-joined nodes are online).

-- ─── 2. Host lifecycle columns ──────────────────────────────────────
ALTER TABLE "v2_core"."hosts"
  ADD COLUMN "lifecycle_state"   TEXT      NOT NULL DEFAULT 'online',
  ADD COLUMN "sku"               TEXT,
  ADD COLUMN "cost_eur_monthly"  DECIMAL(10, 2),
  ADD COLUMN "joined_at"         TIMESTAMP(3),
  ADD COLUMN "drained_at"        TIMESTAMP(3),
  ADD COLUMN "terminated_at"     TIMESTAMP(3);

CREATE INDEX "hosts_lifecycle_state_idx" ON "v2_core"."hosts"("lifecycle_state");

-- ─── 1. Region ──────────────────────────────────────────────────────
CREATE TABLE "v2_core"."regions" (
  "code"          TEXT      NOT NULL,
  "provider_code" TEXT      NOT NULL,
  "vendor"        TEXT      NOT NULL DEFAULT 'hetzner',
  "display_name"  TEXT      NOT NULL,
  "default_sku"   TEXT      NOT NULL,
  "active"        BOOLEAN   NOT NULL DEFAULT true,
  "metadata"      JSONB     NOT NULL DEFAULT '{}',
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "regions_pkey" PRIMARY KEY ("code")
);

-- ─── 3a. Node utilization samples (append-only timeseries) ──────────
CREATE TABLE "v2_ops"."node_utilization_samples" (
  "host_id"            TEXT     NOT NULL,
  "ts"                 TIMESTAMP(3) NOT NULL,
  "vcpu_used"          INTEGER  NOT NULL,
  "ram_gb_used"        DOUBLE PRECISION NOT NULL,
  "storage_gb_used"    DOUBLE PRECISION NOT NULL,
  "instances_running"  INTEGER  NOT NULL,
  "instances_total"    INTEGER  NOT NULL,
  CONSTRAINT "node_utilization_samples_pkey" PRIMARY KEY ("host_id", "ts")
);
CREATE INDEX "node_utilization_samples_ts_idx" ON "v2_ops"."node_utilization_samples"("ts");

-- ─── 3b. Sandbox usage sessions ────────────────────────────────────
CREATE TABLE "v2_ops"."sandbox_usage_sessions" (
  "id"                            TEXT      NOT NULL,
  "machine_id"                    TEXT      NOT NULL,
  "customer_id"                   TEXT,
  "started_at"                    TIMESTAMP(3) NOT NULL,
  "ended_at"                      TIMESTAMP(3),
  "vcpus"                         INTEGER   NOT NULL,
  "ram_gb"                        DOUBLE PRECISION NOT NULL,
  "storage_gb"                    DOUBLE PRECISION NOT NULL,
  "vcpu_seconds"                  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ram_gb_seconds"                DOUBLE PRECISION NOT NULL DEFAULT 0,
  "storage_gb_seconds_local"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "storage_gb_seconds_archive"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "state"                         TEXT      NOT NULL DEFAULT 'running',
  "created_at"                    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sandbox_usage_sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sandbox_usage_sessions_customer_id_started_at_idx" ON "v2_ops"."sandbox_usage_sessions"("customer_id", "started_at");
CREATE INDEX "sandbox_usage_sessions_machine_id_state_idx" ON "v2_ops"."sandbox_usage_sessions"("machine_id", "state");

-- ─── 4a. Cost ledger ────────────────────────────────────────────────
CREATE TABLE "v2_ops"."cost_ledger_entries" (
  "id"          TEXT      NOT NULL,
  "host_id"     TEXT      NOT NULL,
  "ts_from"     TIMESTAMP(3) NOT NULL,
  "ts_to"       TIMESTAMP(3) NOT NULL,
  "micro_eur"   BIGINT    NOT NULL,
  "sku"         TEXT,
  "reconciled"  BOOLEAN   NOT NULL DEFAULT false,
  "metadata"    JSONB     NOT NULL DEFAULT '{}',
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cost_ledger_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cost_ledger_entries_host_id_ts_from_idx" ON "v2_ops"."cost_ledger_entries"("host_id", "ts_from");
CREATE INDEX "cost_ledger_entries_ts_from_reconciled_idx" ON "v2_ops"."cost_ledger_entries"("ts_from", "reconciled");

-- ─── 4b. Revenue ledger ─────────────────────────────────────────────
CREATE TABLE "v2_ops"."revenue_ledger_entries" (
  "id"          TEXT      NOT NULL,
  "session_id"  TEXT,
  "machine_id"  TEXT,
  "customer_id" TEXT,
  "ts_from"     TIMESTAMP(3) NOT NULL,
  "ts_to"       TIMESTAMP(3) NOT NULL,
  "micro_eur"   BIGINT    NOT NULL,
  "metadata"    JSONB     NOT NULL DEFAULT '{}',
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "revenue_ledger_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "revenue_ledger_entries_customer_id_ts_from_idx" ON "v2_ops"."revenue_ledger_entries"("customer_id", "ts_from");
CREATE INDEX "revenue_ledger_entries_machine_id_ts_from_idx" ON "v2_ops"."revenue_ledger_entries"("machine_id", "ts_from");

-- ─── 5. Scaling proposals ───────────────────────────────────────────
CREATE TABLE "v2_ops"."scaling_proposals" (
  "id"                  TEXT      NOT NULL,
  "kind"                TEXT      NOT NULL,
  "cluster_id"          TEXT      NOT NULL,
  "host_id"             TEXT,
  "proposed_sku"        TEXT,
  "rationale"           TEXT      NOT NULL,
  "cost_impact_eur_mo"  DOUBLE PRECISION NOT NULL,
  "status"              TEXT      NOT NULL DEFAULT 'pending',
  "approved_by"         TEXT,
  "approved_at"         TIMESTAMP(3),
  "executed_at"         TIMESTAMP(3),
  "expires_at"          TIMESTAMP(3) NOT NULL,
  "metadata"            JSONB     NOT NULL DEFAULT '{}',
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scaling_proposals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "scaling_proposals_cluster_id_status_idx" ON "v2_ops"."scaling_proposals"("cluster_id", "status");
CREATE INDEX "scaling_proposals_status_expires_at_idx" ON "v2_ops"."scaling_proposals"("status", "expires_at");
