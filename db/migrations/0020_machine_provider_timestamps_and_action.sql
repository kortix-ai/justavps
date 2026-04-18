alter table "machines" add column if not exists "create_action_id" text;
alter table "machines" add column if not exists "last_callback_at" text;
alter table "machines" add column if not exists "last_probe_at" text;
alter table "machines" add column if not exists "daemon_reachable_at" text;

update "machines" set "create_action_id" = nullif(provider_meta->>'create_action_id', '') where "create_action_id" is null;
update "machines" set "last_callback_at" = nullif(provider_meta->>'last_callback_at', '') where "last_callback_at" is null;
update "machines" set "last_probe_at" = nullif(provider_meta->>'last_probe_at', '') where "last_probe_at" is null;
update "machines" set "daemon_reachable_at" = nullif(provider_meta->>'daemon_reachable_at', '') where "daemon_reachable_at" is null;
