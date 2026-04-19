DO $$ BEGIN
	CREATE TYPE "machine_port_protocol" AS ENUM('ssh', 'http');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "machine_port_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"protocol" "machine_port_protocol" NOT NULL,
	"public_port" integer NOT NULL,
	"target_port" integer NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "machine_port_allocations" ADD CONSTRAINT "machine_port_allocations_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "machine_port_allocations" ADD CONSTRAINT "machine_port_allocations_host_id_baremetal_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."baremetal_hosts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "machine_port_allocations_host_protocol_port_uidx" ON "machine_port_allocations" USING btree ("host_id","protocol","public_port");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "machine_port_allocations_machine_protocol_uidx" ON "machine_port_allocations" USING btree ("machine_id","protocol");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "machine_port_allocations_host_protocol_idx" ON "machine_port_allocations" USING btree ("host_id","protocol","updated_at");
