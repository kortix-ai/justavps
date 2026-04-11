ALTER TABLE "baremetal_hosts" ADD COLUMN IF NOT EXISTS "maintenance_state" text DEFAULT 'in_service' NOT NULL;
--> statement-breakpoint
ALTER TABLE "baremetal_hosts" ADD COLUMN IF NOT EXISTS "maintenance_requested_at" timestamp;
--> statement-breakpoint
ALTER TABLE "baremetal_hosts" ADD COLUMN IF NOT EXISTS "maintenance_started_at" timestamp;
--> statement-breakpoint
ALTER TABLE "baremetal_hosts" ADD COLUMN IF NOT EXISTS "maintenance_completed_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "baremetal_hosts_maintenance_state_updated_idx" ON "baremetal_hosts" USING btree ("maintenance_state","updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "backup_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_id" uuid,
	"image_id" uuid,
	"artifact_type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_artifact_id" text,
	"storage_url" text,
	"size_bytes" integer,
	"checksum" text,
	"retention_until" timestamp,
	"status" text DEFAULT 'creating' NOT NULL,
	"source_host_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "backup_artifacts" ADD CONSTRAINT "backup_artifacts_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "backup_artifacts" ADD CONSTRAINT "backup_artifacts_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "backup_artifacts" ADD CONSTRAINT "backup_artifacts_source_host_id_baremetal_hosts_id_fk" FOREIGN KEY ("source_host_id") REFERENCES "public"."baremetal_hosts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backup_artifacts_machine_created_idx" ON "backup_artifacts" USING btree ("machine_id","created_at" desc);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backup_artifacts_status_created_idx" ON "backup_artifacts" USING btree ("status","created_at" desc);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "backup_artifacts_provider_artifact_uidx" ON "backup_artifacts" USING btree ("provider","provider_artifact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backup_artifacts_source_host_created_idx" ON "backup_artifacts" USING btree ("source_host_id","created_at" desc);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "restore_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"machine_id" uuid,
	"target_host_id" uuid,
	"execution_type" text DEFAULT 'snapshot_restore' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"requested_by_user_id" uuid,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"error" text,
	"result" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "restore_executions" ADD CONSTRAINT "restore_executions_artifact_id_backup_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."backup_artifacts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restore_executions" ADD CONSTRAINT "restore_executions_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restore_executions" ADD CONSTRAINT "restore_executions_target_host_id_baremetal_hosts_id_fk" FOREIGN KEY ("target_host_id") REFERENCES "public"."baremetal_hosts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restore_executions" ADD CONSTRAINT "restore_executions_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "restore_executions_artifact_created_idx" ON "restore_executions" USING btree ("artifact_id","created_at" desc);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "restore_executions_status_created_idx" ON "restore_executions" USING btree ("status","created_at" desc);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "restore_executions_machine_created_idx" ON "restore_executions" USING btree ("machine_id","created_at" desc);
