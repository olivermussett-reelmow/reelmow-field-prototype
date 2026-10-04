begin;

alter table garage.machines
  add column if not exists discovered_image_url text,
  add column if not exists discovered_image_source_url text;

drop function if exists garage.create_web_discovered_machine(uuid,uuid,text,text,text,text,text,text,jsonb,text,text,text,numeric,numeric,text);

create function garage.create_web_discovered_machine(
  p_machine_id uuid,
  p_garage_id uuid,
  p_discovered_manufacturer text,
  p_discovered_model text,
  p_discovered_equipment_type text,
  p_discovered_match_type text,
  p_discovered_match_reason text,
  p_discovered_evidence text,
  p_discovered_source_urls jsonb,
  p_nickname text default null,
  p_serial_number text default null,
  p_asset_number text default null,
  p_current_engine_hours numeric default null,
  p_current_reel_hours numeric default null,
  p_notes text default null,
  p_discovered_image_url text default null,
  p_discovered_image_source_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select g.organization_id into org_id
  from garage.garages g where g.id=p_garage_id;
  if org_id is null then raise exception 'Garage not found'; end if;
  if not private.has_org_role(org_id,array['owner'::garage.member_role,'admin'::garage.member_role,'manager'::garage.member_role,'operator'::garage.member_role]) then
    raise exception 'You do not have permission to add machines';
  end if;
  if p_machine_id is null then raise exception 'Machine id is required'; end if;
  if length(trim(coalesce(p_discovered_manufacturer,''))) not between 1 and 120
     or length(trim(coalesce(p_discovered_model,''))) not between 1 and 160 then
    raise exception 'A manufacturer and model are required';
  end if;
  if p_discovered_match_type is null or p_discovered_match_type not in ('exact_match','close_match','related_option') then
    raise exception 'Invalid web match type';
  end if;
  if p_discovered_source_urls is null or jsonb_typeof(p_discovered_source_urls) is distinct from 'array' then
    raise exception 'At least one source link is required';
  end if;
  if jsonb_array_length(p_discovered_source_urls) not between 1 and 5 then raise exception 'At least one source link is required'; end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_discovered_source_urls) as source(url)
    where source.url !~ '^https://[^[:space:]]+$'
  ) then raise exception 'Source links must use HTTPS'; end if;
  if (p_discovered_image_url is null) <> (p_discovered_image_source_url is null) then raise exception 'Image URL and source must be provided together'; end if;
  if p_discovered_image_url is not null and (p_discovered_image_url !~ '^https://[^[:space:]]+$' or p_discovered_image_source_url !~ '^https://[^[:space:]]+$') then
    raise exception 'Machine image and source must use HTTPS';
  end if;
  if exists(select 1 from garage.machines m where m.garage_id=p_garage_id and p_serial_number is not null and lower(m.serial_number)=lower(p_serial_number)) then
    raise exception 'A machine with this serial number is already in this Garage';
  end if;

  insert into garage.machines(
    id,garage_id,machine_variant_id,serial_number,asset_number,nickname,notes,
    current_engine_hours,current_reel_hours,created_by,
    discovered_manufacturer,discovered_model,discovered_equipment_type,
    discovered_match_type,discovered_match_reason,discovered_evidence,discovered_source_urls,
    discovered_image_url,discovered_image_source_url
  ) values (
    p_machine_id,p_garage_id,null,nullif(trim(p_serial_number),''),nullif(trim(p_asset_number),''),
    nullif(trim(p_nickname),''),nullif(trim(p_notes),''),p_current_engine_hours,p_current_reel_hours,auth.uid(),
    trim(p_discovered_manufacturer),trim(p_discovered_model),nullif(trim(p_discovered_equipment_type),''),
    p_discovered_match_type,nullif(trim(p_discovered_match_reason),''),nullif(trim(p_discovered_evidence),''),p_discovered_source_urls,
    p_discovered_image_url,p_discovered_image_source_url
  );
  return p_machine_id;
end;
$$;

revoke execute on function garage.create_web_discovered_machine(uuid,uuid,text,text,text,text,text,text,jsonb,text,text,text,numeric,numeric,text,text,text) from public,anon;
grant execute on function garage.create_web_discovered_machine(uuid,uuid,text,text,text,text,text,text,jsonb,text,text,text,numeric,numeric,text,text,text) to authenticated;

commit;
