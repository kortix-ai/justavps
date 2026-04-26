alter table if exists v2_core.hosts
  add column if not exists schedulable boolean not null default false;

alter table if exists v2_core.machines
  add column if not exists metadata jsonb not null default '{}'::jsonb;
