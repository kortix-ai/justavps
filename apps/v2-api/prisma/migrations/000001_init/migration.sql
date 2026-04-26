create schema if not exists v2_core;
create schema if not exists v2_incus;
create schema if not exists v2_ops;

create table if not exists v2_core.hosts (
  id text primary key,
  vendor text not null,
  provider_server_number text,
  host_class text not null,
  product_id text,
  region text not null,
  location text not null,
  name text not null,
  status text not null,
  schedulable boolean not null default false,
  public_ipv4 text,
  public_ipv6 text,
  incus_cluster_id text,
  incus_member_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists hosts_vendor_provider_server_number_key
  on v2_core.hosts (vendor, provider_server_number);
create index if not exists hosts_region_status_idx on v2_core.hosts (region, status);
create index if not exists hosts_incus_cluster_id_incus_member_name_idx on v2_core.hosts (incus_cluster_id, incus_member_name);

create table if not exists v2_core.machines (
  id text primary key,
  account_id text not null,
  name text not null,
  region text not null,
  type text not null,
  status text not null,
  source_type text not null,
  source_id text,
  incus_cluster_id text not null,
  incus_project text not null,
  incus_instance_name text not null,
  incus_member_name text,
  resources jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists machines_incus_cluster_id_incus_project_incus_instance_name_key
  on v2_core.machines (incus_cluster_id, incus_project, incus_instance_name);
create index if not exists machines_account_id_status_idx on v2_core.machines (account_id, status);

create table if not exists v2_core.images (
  id text primary key,
  account_id text,
  visibility text not null,
  name text not null,
  incus_cluster_id text not null,
  incus_project text not null,
  incus_fingerprint text not null,
  source_machine_id text,
  source_snapshot_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists images_incus_cluster_id_incus_project_incus_fingerprint_key
  on v2_core.images (incus_cluster_id, incus_project, incus_fingerprint);
create index if not exists images_account_id_visibility_idx on v2_core.images (account_id, visibility);

create table if not exists v2_core.snapshots (
  id text primary key,
  account_id text not null,
  machine_id text not null,
  name text not null,
  incus_snapshot_name text not null,
  status text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists snapshots_machine_id_incus_snapshot_name_key
  on v2_core.snapshots (machine_id, incus_snapshot_name);
create index if not exists snapshots_account_id_idx on v2_core.snapshots (account_id);

create table if not exists v2_core.backups (
  id text primary key,
  account_id text not null,
  machine_id text not null,
  status text not null,
  storage_uri text,
  incus_backup_name text,
  retention_policy jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists backups_account_id_status_idx on v2_core.backups (account_id, status);

create table if not exists v2_incus.clusters (
  id text primary key,
  name text not null,
  region text not null,
  endpoint text not null,
  project text not null,
  last_synced_at timestamptz,
  observed jsonb not null default '{}'::jsonb
);

create table if not exists v2_incus.members (
  cluster_id text not null,
  name text not null,
  url text not null,
  status text not null,
  roles jsonb not null default '[]'::jsonb,
  observed jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz not null default now(),
  primary key (cluster_id, name)
);

create index if not exists members_cluster_id_status_idx on v2_incus.members (cluster_id, status);

create table if not exists v2_incus.instances (
  cluster_id text not null,
  project text not null,
  name text not null,
  type text not null,
  status text not null,
  location text,
  observed jsonb not null,
  last_synced_at timestamptz not null default now(),
  primary key (cluster_id, project, name)
);

create index if not exists instances_cluster_id_location_idx on v2_incus.instances (cluster_id, location);

create table if not exists v2_incus.images (
  cluster_id text not null,
  project text not null,
  fingerprint text not null,
  aliases jsonb not null default '[]'::jsonb,
  observed jsonb not null,
  last_synced_at timestamptz not null default now(),
  primary key (cluster_id, project, fingerprint)
);

create table if not exists v2_ops.operations (
  id text primary key,
  account_id text,
  type text not null,
  status text not null,
  idempotency_key text unique,
  target_type text,
  target_id text,
  incus_cluster_id text,
  incus_operation_url text,
  request jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists operations_account_id_status_idx on v2_ops.operations (account_id, status);

create table if not exists v2_ops.procurements (
  id text primary key,
  vendor text not null,
  product_id text not null,
  host_class text not null,
  region text not null,
  location text not null,
  status text not null,
  provider_transaction_id text unique,
  host_id text,
  request jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists procurements_vendor_status_idx on v2_ops.procurements (vendor, status);
