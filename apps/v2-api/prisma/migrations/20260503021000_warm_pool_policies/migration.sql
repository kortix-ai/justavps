CREATE TABLE IF NOT EXISTS "v2_core"."warm_pool_policies" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "region" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "target" INTEGER NOT NULL DEFAULT 1,
  "resources" JSONB NOT NULL,
  "billing_mode" TEXT NOT NULL DEFAULT 'reserved',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "warm_pool_policies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "warm_pool_policies_account_id_status_idx"
  ON "v2_core"."warm_pool_policies"("account_id", "status");

CREATE INDEX IF NOT EXISTS "warm_pool_policies_region_type_source_type_source_id_idx"
  ON "v2_core"."warm_pool_policies"("region", "type", "source_type", "source_id");
