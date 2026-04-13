do $$ begin
  create type "machine_mode" as enum ('vm', 'container');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type "machine_benchmark_scenario" as enum (
    'cold_create',
    'warm_pool_start',
    'snapshot_restore',
    'user_image_cold_create',
    'stop_start'
  );
exception
  when duplicate_object then null;
end $$;

alter table "machines"
  add column if not exists "machine_mode" "machine_mode" not null default 'vm';

create table if not exists "machine_benchmarks" (
  "id" uuid primary key default gen_random_uuid() not null,
  "machine_id" uuid,
  "account_id" uuid,
  "baremetal_host_id" uuid,
  "machine_mode" "machine_mode" not null,
  "machine_benchmark_scenario" "machine_benchmark_scenario" not null,
  "success" boolean not null default true,
  "total_ms" integer,
  "stage_timings" jsonb not null default '{}'::jsonb,
  "metadata" jsonb not null default '{}'::jsonb,
  "created_at" timestamp default now() not null
);

do $$ begin
  alter table "machine_benchmarks"
    add constraint "machine_benchmarks_machine_id_machines_id_fk"
    foreign key ("machine_id") references "public"."machines"("id") on delete cascade on update no action;
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter table "machine_benchmarks"
    add constraint "machine_benchmarks_account_id_accounts_id_fk"
    foreign key ("account_id") references "public"."accounts"("id") on delete set null on update no action;
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter table "machine_benchmarks"
    add constraint "machine_benchmarks_baremetal_host_id_baremetal_hosts_id_fk"
    foreign key ("baremetal_host_id") references "public"."baremetal_hosts"("id") on delete set null on update no action;
exception
  when duplicate_object then null;
end $$;

create index if not exists "machine_benchmarks_machine_created_idx" on "machine_benchmarks" using btree ("machine_id", "created_at" desc);
create index if not exists "machine_benchmarks_account_created_idx" on "machine_benchmarks" using btree ("account_id", "created_at" desc);
create index if not exists "machine_benchmarks_mode_scenario_created_idx" on "machine_benchmarks" using btree ("machine_mode", "machine_benchmark_scenario", "created_at" desc);
