CREATE TABLE IF NOT EXISTS "host_capacity_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"reservation_type" text DEFAULT 'machine_create' NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"vcpu" integer NOT NULL,
	"memory_gb" integer NOT NULL,
	"disk_gb" integer NOT NULL,
	"expires_at" timestamp,
	"committed_at" timestamp,
	"released_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "host_capacity_reservations" ADD CONSTRAINT "host_capacity_reservations_host_id_baremetal_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."baremetal_hosts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "host_capacity_reservations" ADD CONSTRAINT "host_capacity_reservations_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "host_capacity_reservations_host_state_expires_idx" ON "host_capacity_reservations" USING btree ("host_id","state","expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "host_capacity_reservations_machine_type_uidx" ON "host_capacity_reservations" USING btree ("machine_id","reservation_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "host_capacity_reservations_state_expires_idx" ON "host_capacity_reservations" USING btree ("state","expires_at");
