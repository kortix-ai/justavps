alter table "machines" add column if not exists "provider_progress" integer;
alter table "machines" add column if not exists "provider_status" text;
alter table "machines" add column if not exists "callback_expected" boolean;
alter table "machines" add column if not exists "callback_url" text;

update "machines" set "provider_progress" = case
  when jsonb_typeof(provider_meta->'create_progress') = 'number' and (provider_meta->>'create_progress') ~ '^[0-9.]+$'
    then case when (provider_meta->>'create_progress')::numeric <= 1 then round((provider_meta->>'create_progress')::numeric * 100)::integer else round((provider_meta->>'create_progress')::numeric)::integer end
  else null
end
where "provider_progress" is null;

update "machines" set "provider_status" = nullif(provider_meta->>'create_status', '') where "provider_status" is null;
update "machines" set "callback_expected" = (provider_meta->>'callback_expected')::boolean where "callback_expected" is null and nullif(provider_meta->>'callback_expected', '') is not null;
update "machines" set "callback_url" = nullif(provider_meta->>'callback_url', '') where "callback_url" is null;
