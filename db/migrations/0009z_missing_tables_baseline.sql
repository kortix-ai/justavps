-- Baseline for tables that only ever existed via drizzle-kit push on dev
-- and were never given a migration file. Prod stopped at this gap: 0010
-- adds an FK to public.accounts, which never existed there. Runs before
-- 0010 (lexical order). Fully idempotent.

DO $$ BEGIN
	CREATE TYPE public.account_role AS ENUM (
	'owner',
	'admin',
	'member'
	);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TYPE public.account_role ADD VALUE IF NOT EXISTS 'owner';
--> statement-breakpoint
ALTER TYPE public.account_role ADD VALUE IF NOT EXISTS 'admin';
--> statement-breakpoint
ALTER TYPE public.account_role ADD VALUE IF NOT EXISTS 'member';
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE public.account_type AS ENUM (
	'personal',
	'organization'
	);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TYPE public.account_type ADD VALUE IF NOT EXISTS 'personal';
--> statement-breakpoint
ALTER TYPE public.account_type ADD VALUE IF NOT EXISTS 'organization';
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE public.cell_admission_state AS ENUM (
	'open',
	'restricted',
	'closed'
	);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TYPE public.cell_admission_state ADD VALUE IF NOT EXISTS 'open';
--> statement-breakpoint
ALTER TYPE public.cell_admission_state ADD VALUE IF NOT EXISTS 'restricted';
--> statement-breakpoint
ALTER TYPE public.cell_admission_state ADD VALUE IF NOT EXISTS 'closed';
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE public.cell_sellability_state AS ENUM (
	'sellable',
	'reserve_only',
	'unsellable'
	);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TYPE public.cell_sellability_state ADD VALUE IF NOT EXISTS 'sellable';
--> statement-breakpoint
ALTER TYPE public.cell_sellability_state ADD VALUE IF NOT EXISTS 'reserve_only';
--> statement-breakpoint
ALTER TYPE public.cell_sellability_state ADD VALUE IF NOT EXISTS 'unsellable';
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE public.machine_benchmark_scenario AS ENUM (
	'cold_create',
	'warm_pool_start',
	'snapshot_restore',
	'user_image_cold_create',
	'stop_start'
	);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TYPE public.machine_benchmark_scenario ADD VALUE IF NOT EXISTS 'cold_create';
--> statement-breakpoint
ALTER TYPE public.machine_benchmark_scenario ADD VALUE IF NOT EXISTS 'warm_pool_start';
--> statement-breakpoint
ALTER TYPE public.machine_benchmark_scenario ADD VALUE IF NOT EXISTS 'snapshot_restore';
--> statement-breakpoint
ALTER TYPE public.machine_benchmark_scenario ADD VALUE IF NOT EXISTS 'user_image_cold_create';
--> statement-breakpoint
ALTER TYPE public.machine_benchmark_scenario ADD VALUE IF NOT EXISTS 'stop_start';
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE public.machine_mode AS ENUM (
	'vm',
	'container'
	);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TYPE public.machine_mode ADD VALUE IF NOT EXISTS 'vm';
--> statement-breakpoint
ALTER TYPE public.machine_mode ADD VALUE IF NOT EXISTS 'container';
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE public.machine_telemetry_retention_class AS ENUM (
	'heartbeat_minute_7d',
	'alert_30d'
	);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TYPE public.machine_telemetry_retention_class ADD VALUE IF NOT EXISTS 'heartbeat_minute_7d';
--> statement-breakpoint
ALTER TYPE public.machine_telemetry_retention_class ADD VALUE IF NOT EXISTS 'alert_30d';
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE public.machine_telemetry_series AS ENUM (
	'heartbeat',
	'security_tamper',
	'network_anomaly',
	'watchdog_alert'
	);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TYPE public.machine_telemetry_series ADD VALUE IF NOT EXISTS 'heartbeat';
--> statement-breakpoint
ALTER TYPE public.machine_telemetry_series ADD VALUE IF NOT EXISTS 'security_tamper';
--> statement-breakpoint
ALTER TYPE public.machine_telemetry_series ADD VALUE IF NOT EXISTS 'network_anomaly';
--> statement-breakpoint
ALTER TYPE public.machine_telemetry_series ADD VALUE IF NOT EXISTS 'watchdog_alert';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type public.account_type DEFAULT 'personal'::public.account_type NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    personal_for_user_id uuid,
    billing_email text,
    stripe_customer_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.account_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role public.account_role DEFAULT 'member'::public.account_role NOT NULL,
    created_by_user_id uuid,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.account_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    email text NOT NULL,
    role public.account_role DEFAULT 'member'::public.account_role NOT NULL,
    token_sha256 text NOT NULL,
    invited_by_user_id uuid NOT NULL,
    accepted_by_user_id uuid,
    expires_at timestamp without time zone NOT NULL,
    accepted_at timestamp without time zone,
    revoked_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.proxy_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    account_id uuid,
    machine_id uuid NOT NULL,
    token_hash text NOT NULL,
    token_sha256 text NOT NULL,
    token_prefix text NOT NULL,
    label text,
    ports integer[],
    expires_at timestamp without time zone NOT NULL,
    revoked_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.cells (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    region text NOT NULL,
    host_class text NOT NULL,
    generation text DEFAULT 'gen1'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    reserve_policy jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.cell_admission_controls (
    cell_id uuid NOT NULL,
    admission_state public.cell_admission_state DEFAULT 'open'::public.cell_admission_state NOT NULL,
    sellability_state public.cell_sellability_state DEFAULT 'sellable'::public.cell_sellability_state NOT NULL,
    reason text,
    source text DEFAULT 'manual'::text NOT NULL,
    set_at timestamp without time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.machine_heartbeat_states (
    machine_id uuid NOT NULL,
    account_id uuid,
    daemon_version text,
    last_heartbeat_at timestamp without time zone NOT NULL,
    last_projected_at timestamp without time zone,
    heartbeat_count integer DEFAULT 0 NOT NULL,
    last_ready_at timestamp without time zone,
    uptime_sec integer,
    services jsonb DEFAULT '{}'::jsonb NOT NULL,
    load jsonb DEFAULT '{"cpu": 0, "disk": 0, "memory": 0}'::jsonb NOT NULL,
    network jsonb,
    security jsonb,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.machine_telemetry_rollups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    machine_id uuid NOT NULL,
    account_id uuid,
    series public.machine_telemetry_series NOT NULL,
    retention_class public.machine_telemetry_retention_class NOT NULL,
    bucket_start timestamp without time zone NOT NULL,
    bucket_resolution_sec integer DEFAULT 60 NOT NULL,
    first_observed_at timestamp without time zone NOT NULL,
    last_observed_at timestamp without time zone NOT NULL,
    sample_count integer DEFAULT 1 NOT NULL,
    last_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    retention_until timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.machine_routing_states (
    machine_id uuid NOT NULL,
    account_id uuid,
    machine_slug text NOT NULL,
    desired_state text DEFAULT 'absent'::text NOT NULL,
    machine_status text DEFAULT 'provisioning'::text NOT NULL,
    desired_ip text,
    desired_origin_port integer,
    desired_origin_hostname text,
    kv_state text DEFAULT 'pending'::text NOT NULL,
    dns_state text DEFAULT 'pending'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    last_applied_at timestamp without time zone,
    last_kv_synced_at timestamp without time zone,
    last_dns_synced_at timestamp without time zone,
    last_repair_at timestamp without time zone,
    last_error text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.machine_benchmarks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    machine_id uuid,
    account_id uuid,
    baremetal_host_id uuid,
    machine_mode public.machine_mode NOT NULL,
    machine_benchmark_scenario public.machine_benchmark_scenario NOT NULL,
    success boolean DEFAULT true NOT NULL,
    total_ms integer,
    stage_timings jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.baremetal_host_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    host_id uuid NOT NULL,
    image_id uuid,
    image_alias text,
    image_ref text NOT NULL,
    availability_state text DEFAULT 'unknown'::text NOT NULL,
    source text DEFAULT 'unknown'::text NOT NULL,
    last_seen_at timestamp without time zone,
    last_requested_at timestamp without time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.control_plane_service_states (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service text NOT NULL,
    scope text DEFAULT 'global'::text NOT NULL,
    lease_owner text,
    lease_expires_at timestamp without time zone,
    last_started_at timestamp without time zone,
    last_completed_at timestamp without time zone,
    checkpoint jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.accounts ADD CONSTRAINT accounts_slug_unique UNIQUE (slug);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.accounts ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.accounts ADD CONSTRAINT accounts_personal_for_user_id_unique UNIQUE (personal_for_user_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.accounts ADD CONSTRAINT accounts_personal_for_user_id_users_id_fk FOREIGN KEY (personal_for_user_id) REFERENCES public.users(id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.account_memberships ADD CONSTRAINT account_memberships_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.account_memberships ADD CONSTRAINT account_memberships_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.account_memberships ADD CONSTRAINT account_memberships_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.account_memberships ADD CONSTRAINT account_memberships_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.account_invitations ADD CONSTRAINT account_invitations_token_sha256_unique UNIQUE (token_sha256);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.account_invitations ADD CONSTRAINT account_invitations_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.account_invitations ADD CONSTRAINT account_invitations_accepted_by_user_id_users_id_fk FOREIGN KEY (accepted_by_user_id) REFERENCES public.users(id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.account_invitations ADD CONSTRAINT account_invitations_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.account_invitations ADD CONSTRAINT account_invitations_invited_by_user_id_users_id_fk FOREIGN KEY (invited_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.proxy_tokens ADD CONSTRAINT proxy_tokens_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.proxy_tokens ADD CONSTRAINT proxy_tokens_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES public.accounts(id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.proxy_tokens ADD CONSTRAINT proxy_tokens_machine_id_machines_id_fk FOREIGN KEY (machine_id) REFERENCES public.machines(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.proxy_tokens ADD CONSTRAINT proxy_tokens_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES public.users(id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.cells ADD CONSTRAINT cells_slug_unique UNIQUE (slug);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.cells ADD CONSTRAINT cells_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.cell_admission_controls ADD CONSTRAINT cell_admission_controls_pkey PRIMARY KEY (cell_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.cell_admission_controls ADD CONSTRAINT cell_admission_controls_cell_id_cells_id_fk FOREIGN KEY (cell_id) REFERENCES public.cells(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.machine_heartbeat_states ADD CONSTRAINT machine_heartbeat_states_pkey PRIMARY KEY (machine_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.machine_heartbeat_states ADD CONSTRAINT machine_heartbeat_states_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES public.accounts(id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.machine_heartbeat_states ADD CONSTRAINT machine_heartbeat_states_machine_id_machines_id_fk FOREIGN KEY (machine_id) REFERENCES public.machines(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.machine_telemetry_rollups ADD CONSTRAINT machine_telemetry_rollups_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.machine_telemetry_rollups ADD CONSTRAINT machine_telemetry_rollups_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.machine_telemetry_rollups ADD CONSTRAINT machine_telemetry_rollups_machine_id_machines_id_fk FOREIGN KEY (machine_id) REFERENCES public.machines(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.machine_routing_states ADD CONSTRAINT machine_routing_states_pkey PRIMARY KEY (machine_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.machine_routing_states ADD CONSTRAINT machine_routing_states_machine_slug_unique UNIQUE (machine_slug);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.machine_routing_states ADD CONSTRAINT machine_routing_states_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES public.accounts(id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.machine_routing_states ADD CONSTRAINT machine_routing_states_machine_id_machines_id_fk FOREIGN KEY (machine_id) REFERENCES public.machines(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.machine_benchmarks ADD CONSTRAINT machine_benchmarks_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.machine_benchmarks ADD CONSTRAINT machine_benchmarks_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.machine_benchmarks ADD CONSTRAINT machine_benchmarks_baremetal_host_id_baremetal_hosts_id_fk FOREIGN KEY (baremetal_host_id) REFERENCES public.baremetal_hosts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.machine_benchmarks ADD CONSTRAINT machine_benchmarks_machine_id_machines_id_fk FOREIGN KEY (machine_id) REFERENCES public.machines(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.baremetal_host_images ADD CONSTRAINT baremetal_host_images_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.baremetal_host_images ADD CONSTRAINT baremetal_host_images_host_id_baremetal_hosts_id_fk FOREIGN KEY (host_id) REFERENCES public.baremetal_hosts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.baremetal_host_images ADD CONSTRAINT baremetal_host_images_image_id_images_id_fk FOREIGN KEY (image_id) REFERENCES public.images(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE ONLY public.control_plane_service_states ADD CONSTRAINT control_plane_service_states_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS account_memberships_account_user_uidx ON public.account_memberships USING btree (account_id, user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS cells_region_host_class_generation_uidx ON public.cells USING btree (region, host_class, generation);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cells_status_region_idx ON public.cells USING btree (status, region, updated_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cell_admission_controls_sellability_idx ON public.cell_admission_controls USING btree (sellability_state, updated_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cell_admission_controls_state_idx ON public.cell_admission_controls USING btree (admission_state, updated_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS machine_heartbeat_states_account_heartbeat_idx ON public.machine_heartbeat_states USING btree (account_id, last_heartbeat_at DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS machine_heartbeat_states_projected_heartbeat_idx ON public.machine_heartbeat_states USING btree (last_projected_at, last_heartbeat_at DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS machine_telemetry_rollups_account_series_bucket_idx ON public.machine_telemetry_rollups USING btree (account_id, series, bucket_start DESC NULLS LAST);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS machine_telemetry_rollups_machine_series_bucket_uidx ON public.machine_telemetry_rollups USING btree (machine_id, series, bucket_start, bucket_resolution_sec);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS machine_telemetry_rollups_retention_idx ON public.machine_telemetry_rollups USING btree (retention_until, series);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS machine_routing_states_desired_state_idx ON public.machine_routing_states USING btree (desired_state, updated_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS machine_routing_states_repair_idx ON public.machine_routing_states USING btree (kv_state, dns_state, updated_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS machine_benchmarks_account_created_idx ON public.machine_benchmarks USING btree (account_id, created_at DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS machine_benchmarks_machine_created_idx ON public.machine_benchmarks USING btree (machine_id, created_at DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS machine_benchmarks_mode_scenario_created_idx ON public.machine_benchmarks USING btree (machine_mode, machine_benchmark_scenario, created_at DESC NULLS LAST);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS baremetal_host_images_host_image_ref_uidx ON public.baremetal_host_images USING btree (host_id, image_ref);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS baremetal_host_images_host_state_idx ON public.baremetal_host_images USING btree (host_id, availability_state);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS baremetal_host_images_image_ref_state_idx ON public.baremetal_host_images USING btree (image_ref, availability_state);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS control_plane_service_states_completed_at_idx ON public.control_plane_service_states USING btree (last_completed_at, updated_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS control_plane_service_states_service_lease_idx ON public.control_plane_service_states USING btree (service, lease_expires_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS control_plane_service_states_service_scope_uidx ON public.control_plane_service_states USING btree (service, scope);
