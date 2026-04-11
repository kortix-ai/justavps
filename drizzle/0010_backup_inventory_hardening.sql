ALTER TABLE "backup_artifacts" ADD COLUMN IF NOT EXISTS "account_id" uuid;
--> statement-breakpoint
ALTER TABLE "backup_artifacts" ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "backup_artifacts" ADD COLUMN IF NOT EXISTS "backup_kind" text DEFAULT 'user_snapshot' NOT NULL;
--> statement-breakpoint
ALTER TABLE "backup_artifacts" ADD COLUMN IF NOT EXISTS "inventory_scope" text DEFAULT 'customer' NOT NULL;
--> statement-breakpoint
ALTER TABLE "backup_artifacts" ADD COLUMN IF NOT EXISTS "storage_scope" text DEFAULT 'host_local' NOT NULL;
--> statement-breakpoint
ALTER TABLE "backup_artifacts" ADD COLUMN IF NOT EXISTS "display_name" text;
--> statement-breakpoint
ALTER TABLE "backup_artifacts" ADD COLUMN IF NOT EXISTS "source_machine_slug" text;
--> statement-breakpoint
ALTER TABLE "backup_artifacts" ADD COLUMN IF NOT EXISTS "last_verified_at" timestamp;
--> statement-breakpoint
ALTER TABLE "backup_artifacts" ADD COLUMN IF NOT EXISTS "restore_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "backup_artifacts" ADD COLUMN IF NOT EXISTS "last_restore_at" timestamp;
--> statement-breakpoint
ALTER TABLE "backup_artifacts" ADD CONSTRAINT "backup_artifacts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "backup_artifacts" ADD CONSTRAINT "backup_artifacts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backup_artifacts_account_scope_status_created_idx" ON "backup_artifacts" USING btree ("account_id","inventory_scope","status","created_at" desc);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backup_artifacts_kind_created_idx" ON "backup_artifacts" USING btree ("backup_kind","created_at" desc);
--> statement-breakpoint
ALTER TABLE "restore_executions" ADD COLUMN IF NOT EXISTS "account_id" uuid;
--> statement-breakpoint
ALTER TABLE "restore_executions" ADD COLUMN IF NOT EXISTS "source_host_id" uuid;
--> statement-breakpoint
ALTER TABLE "restore_executions" ADD COLUMN IF NOT EXISTS "trigger_source" text DEFAULT 'user_request' NOT NULL;
--> statement-breakpoint
ALTER TABLE "restore_executions" ADD COLUMN IF NOT EXISTS "duration_ms" integer;
--> statement-breakpoint
ALTER TABLE "restore_executions" ADD CONSTRAINT "restore_executions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "restore_executions" ADD CONSTRAINT "restore_executions_source_host_id_baremetal_hosts_id_fk" FOREIGN KEY ("source_host_id") REFERENCES "public"."baremetal_hosts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "restore_executions_account_status_created_idx" ON "restore_executions" USING btree ("account_id","status","created_at" desc);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "restore_executions_target_host_created_idx" ON "restore_executions" USING btree ("target_host_id","created_at" desc);
