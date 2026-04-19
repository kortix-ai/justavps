ALTER TABLE "baremetal_procurements" ADD COLUMN IF NOT EXISTS "generation" text DEFAULT 'gen1' NOT NULL;
--> statement-breakpoint
ALTER TABLE "baremetal_procurements" ADD COLUMN IF NOT EXISTS "target_cell_id" uuid;
--> statement-breakpoint
ALTER TABLE "baremetal_procurements" ADD COLUMN IF NOT EXISTS "procurement_purpose" text DEFAULT 'capacity_growth' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "baremetal_procurements" ADD CONSTRAINT "baremetal_procurements_target_cell_id_cells_id_fk" FOREIGN KEY ("target_cell_id") REFERENCES "public"."cells"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "baremetal_procurements_target_cell_status_idx" ON "baremetal_procurements" USING btree ("target_cell_id","status","created_at" desc);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "baremetal_procurements_host_class_generation_idx" ON "baremetal_procurements" USING btree ("host_class","generation","status");
