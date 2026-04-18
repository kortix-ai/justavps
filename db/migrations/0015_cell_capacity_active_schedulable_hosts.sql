alter table "cell_capacity_snapshots"
  add column if not exists "active_schedulable_host_count" integer not null default 0;

update "cell_capacity_snapshots"
set "active_schedulable_host_count" = "active_host_count"
where "active_schedulable_host_count" = 0;
