do $$ begin
  create type "machine_image_source_kind" as enum ('golden', 'catalog', 'docker');
exception
  when duplicate_object then null;
end $$;

alter table "machines"
  add column if not exists "requested_image_kind" "machine_image_source_kind" default 'golden';

alter table "machines"
  add column if not exists "requested_image_ref" text;

update "machines"
set "requested_image_kind" = coalesce(
  nullif(provider_meta->>'requested_image_kind', ''),
  case when image_id is not null then 'catalog' else 'golden' end
)::machine_image_source_kind
where "requested_image_kind" is null;

update "machines"
set "requested_image_ref" = nullif(provider_meta->>'requested_image_ref', '')
where "requested_image_ref" is null;
