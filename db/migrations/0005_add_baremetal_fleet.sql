CREATE TABLE IF NOT EXISTS "baremetal_hosts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "vendor" text DEFAULT 'hetzner_robot' NOT NULL,
  "host_class" text NOT NULL,
  "region" text NOT NULL,
  "location" text NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'requested' NOT NULL,
  "provider_server_number" text,
  "provider_transaction_id" text,
  "public_ipv4" text,
  "public_ipv6" text,
  "runner_base_url" text,
  "runner_token" text,
  "total_vcpu" integer,
  "total_memory_gb" integer,
  "total_disk_gb" integer,
  "used_vcpu" integer DEFAULT 0 NOT NULL,
  "used_memory_gb" integer DEFAULT 0 NOT NULL,
  "used_disk_gb" integer DEFAULT 0 NOT NULL,
  "last_heartbeat_at" timestamp,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "baremetal_hosts_name_unique" UNIQUE("name"),
  CONSTRAINT "baremetal_hosts_provider_server_number_unique" UNIQUE("provider_server_number")
);

CREATE TABLE IF NOT EXISTS "baremetal_procurements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "vendor" text DEFAULT 'hetzner_robot' NOT NULL,
  "host_class" text NOT NULL,
  "product_id" text NOT NULL,
  "region" text NOT NULL,
  "location" text NOT NULL,
  "status" text DEFAULT 'requested' NOT NULL,
  "requested_by_user_id" uuid NOT NULL,
  "approved_by_user_id" uuid,
  "host_id" uuid,
  "provider_transaction_id" text,
  "requires_approval" boolean DEFAULT true NOT NULL,
  "error" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "approved_at" timestamp,
  "ordered_at" timestamp,
  "resolved_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "baremetal_procurements" ADD CONSTRAINT "baremetal_procurements_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "baremetal_procurements" ADD CONSTRAINT "baremetal_procurements_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "baremetal_procurements" ADD CONSTRAINT "baremetal_procurements_host_id_baremetal_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."baremetal_hosts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
