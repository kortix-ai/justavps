ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "baremetal_host_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "machines" ADD CONSTRAINT "machines_baremetal_host_id_baremetal_hosts_id_fk" FOREIGN KEY ("baremetal_host_id") REFERENCES "public"."baremetal_hosts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "machines_baremetal_host_status_deleted_idx" ON "machines" USING btree ("baremetal_host_id","status","deleted_at");
