CREATE TABLE IF NOT EXISTS "cell_capacity_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cell_id" uuid,
	"cell_slug" text NOT NULL,
	"region" text NOT NULL,
	"host_class" text NOT NULL,
	"generation" text NOT NULL,
	"admission_state" "cell_admission_state" NOT NULL,
	"sellability_state" "cell_sellability_state" NOT NULL,
	"host_count" integer NOT NULL,
	"active_host_count" integer NOT NULL,
	"constrained_host_count" integer NOT NULL,
	"total_vcpu" integer NOT NULL,
	"total_memory_gb" integer NOT NULL,
	"total_disk_gb" integer NOT NULL,
	"used_vcpu" integer NOT NULL,
	"used_memory_gb" integer NOT NULL,
	"used_disk_gb" integer NOT NULL,
	"reserved_vcpu" integer NOT NULL,
	"reserved_memory_gb" integer NOT NULL,
	"reserved_disk_gb" integer NOT NULL,
	"reserve_budget_vcpu" integer NOT NULL,
	"reserve_budget_memory_gb" integer NOT NULL,
	"reserve_budget_disk_gb" integer NOT NULL,
	"available_vcpu" integer NOT NULL,
	"available_memory_gb" integer NOT NULL,
	"available_disk_gb" integer NOT NULL,
	"sellable_vcpu" integer NOT NULL,
	"sellable_memory_gb" integer NOT NULL,
	"sellable_disk_gb" integer NOT NULL,
	"utilization_score_basis_points" integer NOT NULL,
	"snapshot_window_start" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "cell_capacity_snapshots" ADD CONSTRAINT "cell_capacity_snapshots_cell_id_cells_id_fk" FOREIGN KEY ("cell_id") REFERENCES "public"."cells"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cell_capacity_snapshots_cell_window_uidx" ON "cell_capacity_snapshots" USING btree ("cell_slug","snapshot_window_start");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cell_capacity_snapshots_cell_observed_idx" ON "cell_capacity_snapshots" USING btree ("cell_id","snapshot_window_start" desc);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cell_capacity_snapshots_observed_idx" ON "cell_capacity_snapshots" USING btree ("snapshot_window_start" desc,"region","host_class");
