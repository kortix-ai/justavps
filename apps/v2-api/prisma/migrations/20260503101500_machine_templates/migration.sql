CREATE TABLE "v2_core"."machine_templates" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "region" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "incus_cluster_id" TEXT NOT NULL,
    "incus_project" TEXT NOT NULL,
    "incus_alias" TEXT NOT NULL,
    "incus_fingerprint" TEXT NOT NULL,
    "default_resources" JSONB NOT NULL,
    "source_kind" TEXT NOT NULL,
    "source_ref" TEXT,
    "measured_bytes" BIGINT,
    "billable_gib" DECIMAL(20,9),
    "storage_eur_month" DECIMAL(20,6),
    "prepared_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machine_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "machine_templates_account_id_slug_key" ON "v2_core"."machine_templates"("account_id", "slug");
CREATE UNIQUE INDEX "machine_templates_incus_cluster_id_incus_project_incus_alias_key" ON "v2_core"."machine_templates"("incus_cluster_id", "incus_project", "incus_alias");
CREATE INDEX "machine_templates_account_id_status_visibility_idx" ON "v2_core"."machine_templates"("account_id", "status", "visibility");
CREATE INDEX "machine_templates_region_type_status_idx" ON "v2_core"."machine_templates"("region", "type", "status");
