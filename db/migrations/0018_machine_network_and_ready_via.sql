do $$ begin
  create type "machine_ready_via" as enum ('heartbeat', 'probe');
exception
  when duplicate_object then null;
end $$;

alter table "machines" add column if not exists "public_ipv4" text;
alter table "machines" add column if not exists "public_ipv6" text;
alter table "machines" add column if not exists "ssh_port" integer;
alter table "machines" add column if not exists "http_port" integer;
alter table "machines" add column if not exists "ready_via" "machine_ready_via";

update "machines" set "public_ipv4" = nullif(provider_meta->>'public_ipv4', '') where "public_ipv4" is null;
update "machines" set "public_ipv6" = nullif(provider_meta->>'public_ipv6', '') where "public_ipv6" is null;
update "machines" set "ssh_port" = nullif(provider_meta->>'ssh_port', '')::integer where "ssh_port" is null and nullif(provider_meta->>'ssh_port', '') is not null;
update "machines" set "http_port" = nullif(provider_meta->>'http_port', '')::integer where "http_port" is null and nullif(provider_meta->>'http_port', '') is not null;
update "machines" set "ready_via" = nullif(provider_meta->>'ready_via', '')::machine_ready_via where "ready_via" is null and nullif(provider_meta->>'ready_via', '') is not null;
