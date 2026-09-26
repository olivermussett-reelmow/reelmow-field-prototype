-- REELMOW Garage V1: catalogue matching, confirmed onboarding and audited profile writes
create or replace function catalogue.match_machine_identification(
  manufacturer_text text default null,
  product_family_text text default null,
  model_text text default null,
  variant_text text default null,
  serial_number_text text default null,
  visible_text text default null,
  result_limit integer default 6
)
returns table(
  model_id uuid,
  manufacturer_name text,
  family_name text,
  model_name text,
  variant_id uuid,
  variant_name text,
  variant_code text,
  machine_type text,
  rank real,
  match_reasons jsonb
)
language sql
security invoker
set search_path = ''
stable
as $$
  with input as (
    select
      lower(regexp_replace(coalesce(manufacturer_text,''),'[^a-z0-9]+','','g')) as man,
      lower(regexp_replace(coalesce(product_family_text,''),'[^a-z0-9]+','','g')) as fam,
      lower(regexp_replace(coalesce(model_text,''),'[^a-z0-9]+','','g')) as model,
      lower(regexp_replace(coalesce(variant_text,''),'[^a-z0-9]+','','g')) as variant,
      lower(regexp_replace(coalesce(serial_number_text,''),'[^a-z0-9]+','','g')) as serial,
      lower(coalesce(visible_text,'')) as visible
  ),
  scored as (
    select
      s.model_id,s.manufacturer_name,s.family_name,s.model_name,s.variant_id,
      s.variant_name,s.variant_code,s.machine_type,
      greatest(
        case when i.model <> '' and lower(regexp_replace(s.model_name,'[^a-z0-9]+','','g'))=i.model then 0.62 else 0 end,
        0
      )
      + case when i.man <> '' and lower(regexp_replace(s.manufacturer_name,'[^a-z0-9]+','','g'))=i.man then 0.18 else 0 end
      + case when i.fam <> '' and lower(regexp_replace(s.family_name,'[^a-z0-9]+','','g'))=i.fam then 0.08
             when i.fam <> '' then greatest(0, extensions.similarity(lower(s.family_name),i.fam))*0.04 else 0 end
      + case when i.variant <> '' and lower(regexp_replace(coalesce(s.variant_name,''),'[^a-z0-9]+','','g'))=i.variant then 0.08
             when i.variant <> '' then greatest(0, extensions.similarity(lower(coalesce(s.variant_name,'')),i.variant))*0.04 else 0 end
      + case when i.model <> '' then greatest(0, extensions.similarity(lower(s.model_name),coalesce(model_text,'')))*0.08 else 0 end
      + case when i.man <> '' and position(i.man in lower(regexp_replace(s.manufacturer_name,'[^a-z0-9]+','','g'))) > 0 then 0.02 else 0 end
      + case when i.model <> '' and position(i.model in lower(regexp_replace(coalesce(s.variant_name,''),'[^a-z0-9]+','','g'))) > 0 then 0.03 else 0 end
      + case when i.serial <> '' and v.serial_prefix is not null
                  and left(i.serial,length(lower(regexp_replace(v.serial_prefix,'[^a-z0-9]+','','g'))))=lower(regexp_replace(v.serial_prefix,'[^a-z0-9]+','','g'))
             then 0.15 else 0 end
      + case when i.visible <> '' and i.model <> '' and position(lower(s.model_name) in i.visible)>0 then 0.06 else 0 end
      as raw_rank,
      i.*
    from catalogue.machine_search s join catalogue.machine_variants v on v.id=s.variant_id cross join input i
    where
      (i.model <> '' and (
        s.model_name ilike '%'||model_text||'%' or s.variant_name ilike '%'||model_text||'%'
        or extensions.similarity(lower(s.model_name),lower(model_text)) >= 0.35
      ))
      or (i.man <> '' and s.manufacturer_name ilike '%'||manufacturer_text||'%')
      or (i.fam <> '' and s.family_name ilike '%'||product_family_text||'%')
      or (i.variant <> '' and s.variant_name ilike '%'||variant_text||'%')
      or (i.serial <> '' and v.serial_prefix is not null
          and left(i.serial,length(lower(regexp_replace(v.serial_prefix,'[^a-z0-9]+','','g'))))=lower(regexp_replace(v.serial_prefix,'[^a-z0-9]+','','g')))
      or (i.visible <> '' and i.model <> '' and position(lower(s.model_name) in i.visible)>0)
  )
  select
    model_id,manufacturer_name,family_name,model_name,variant_id,variant_name,variant_code,machine_type,
    least(1.0,raw_rank)::real as rank,
    jsonb_build_object(
      'manufacturer_exact', (raw_rank >= 0.18 and i.man <> '' and lower(regexp_replace(manufacturer_name,'[^a-z0-9]+','','g'))=i.man),
      'model_exact', (i.model <> '' and lower(regexp_replace(model_name,'[^a-z0-9]+','','g'))=i.model),
      'variant_exact', (i.variant <> '' and lower(regexp_replace(coalesce(variant_name,''),'[^a-z0-9]+','','g'))=i.variant),
      'serial_prefix', (i.serial <> '' and position(lower(regexp_replace(coalesce(variant_code,''),'[^a-z0-9]+','','g')) in i.serial)>0)
    ) as match_reasons
  from scored
  order by raw_rank desc, manufacturer_name, model_name, variant_name
  limit greatest(1,least(coalesce(result_limit,6),12));
$$;

revoke execute on function catalogue.match_machine_identification(text,text,text,text,text,text,integer) from public, anon;
grant execute on function catalogue.match_machine_identification(text,text,text,text,text,text,integer) to authenticated;

create or replace function garage.create_machine(
  p_machine_id uuid,
  p_garage_id uuid,
  p_machine_variant_id uuid,
  p_serial_number text default null,
  p_asset_number text default null,
  p_nickname text default null,
  p_purchase_date date default null,
  p_purchase_price numeric default null,
  p_warranty_start_date date default null,
  p_warranty_end_date date default null,
  p_warranty_provider text default null,
  p_ownership_type text default null,
  p_ownership_name text default null,
  p_notes text default null,
  p_current_engine_hours numeric default null,
  p_current_reel_hours numeric default null,
  p_photo_bucket text default null,
  p_photo_path text default null,
  p_photo_caption text default null,
  p_photo_mime_type text default null,
  p_photo_file_size bigint default null,
  p_photo_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare org_id uuid;
begin
  if (auth.uid() is null) then raise exception 'Authentication required'; end if;
  select g.organization_id into org_id from garage.garages g where g.id=p_garage_id;
  if org_id is null then raise exception 'Garage not found'; end if;
  if not private.has_org_role(org_id, array['owner'::garage.member_role,'admin'::garage.member_role,'manager'::garage.member_role,'operator'::garage.member_role]) then
    raise exception 'You do not have permission to add machines';
  end if;
  if p_machine_id is null then raise exception 'Machine id is required'; end if;
  if p_machine_variant_id is null or not exists (
    select 1 from catalogue.machine_variants v where v.id=p_machine_variant_id and v.status='active'
  ) then raise exception 'A valid catalogue variant is required'; end if;
  if p_purchase_price is not null and p_purchase_price < 0 then raise exception 'Purchase price cannot be negative'; end if;
  if p_current_engine_hours is not null and p_current_engine_hours < 0 then raise exception 'Engine hours cannot be negative'; end if;
  if p_current_reel_hours is not null and p_current_reel_hours < 0 then raise exception 'Reel hours cannot be negative'; end if;
  if p_serial_number is not null and exists (
    select 1 from garage.machines m where m.garage_id=p_garage_id and lower(m.serial_number)=lower(p_serial_number)
  ) then raise exception 'A machine with this serial number is already in this Garage'; end if;
  if p_photo_path is not null and (
    p_photo_bucket <> 'reelmow-garage-private'
    or p_photo_path not like 'org/'||org_id::text||'/machines/'||p_machine_id::text||'/%'
  ) then raise exception 'Invalid machine evidence path'; end if;

  insert into garage.machines(
    id,garage_id,machine_variant_id,serial_number,asset_number,nickname,purchase_date,purchase_price,
    warranty_start_date,warranty_end_date,warranty_provider,ownership_type,ownership_name,notes,
    current_engine_hours,current_reel_hours,created_by
  ) values (
    p_machine_id,p_garage_id,p_machine_variant_id,nullif(p_serial_number,''),nullif(p_asset_number,''),
    nullif(p_nickname,''),p_purchase_date,p_purchase_price,p_warranty_start_date,p_warranty_end_date,
    nullif(p_warranty_provider,''),nullif(p_ownership_type,''),nullif(p_ownership_name,''),nullif(p_notes,''),
    p_current_engine_hours,p_current_reel_hours,auth.uid()
  );

  if p_photo_path is not null then
    insert into garage.machine_photos(
      machine_id,storage_bucket,storage_path,caption,photo_type,metadata,mime_type,file_size_bytes,captured_at,created_by
    ) values (
      p_machine_id,p_photo_bucket,p_photo_path,coalesce(p_photo_caption,'Machine model / serial plate'),
      'serial_plate',coalesce(p_photo_metadata,'{}'::jsonb),p_photo_mime_type,p_photo_file_size,now(),auth.uid()
    );
  end if;

  return p_machine_id;
end;
$$;

revoke execute on function garage.create_machine(uuid,uuid,uuid,text,text,text,date,numeric,date,date,text,text,text,text,numeric,numeric,text,text,text,text,bigint,jsonb) from public, anon;
grant execute on function garage.create_machine(uuid,uuid,uuid,text,text,text,date,numeric,date,date,text,text,text,text,numeric,numeric,text,text,text,text,bigint,jsonb) to authenticated;


create or replace function garage.update_machine_profile(
  p_machine_id uuid,
  p_serial_number text default null,
  p_asset_number text default null,
  p_nickname text default null,
  p_purchase_date date default null,
  p_purchase_price numeric default null,
  p_ownership_type text default null,
  p_ownership_name text default null,
  p_warranty_start_date date default null,
  p_warranty_end_date date default null,
  p_warranty_provider text default null,
  p_notes text default null
)
returns garage.machines
language plpgsql
security definer
set search_path = ''
as $$
declare current_row garage.machines;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select m.* into current_row
  from garage.machines m
  join garage.garages g on g.id=m.garage_id
  where m.id=p_machine_id
    and private.has_org_role(g.organization_id, array['owner'::garage.member_role,'admin'::garage.member_role,'manager'::garage.member_role,'operator'::garage.member_role]);
  if current_row.id is null then raise exception 'Machine not found or permission denied'; end if;
  if p_purchase_price is not null and p_purchase_price < 0 then raise exception 'Purchase price cannot be negative'; end if;
  if p_warranty_start_date is not null and p_warranty_end_date is not null and p_warranty_end_date < p_warranty_start_date then
    raise exception 'Warranty end cannot be before warranty start';
  end if;
  if p_serial_number is not null and exists (
    select 1 from garage.machines m
    where m.garage_id=current_row.garage_id
      and m.id<>p_machine_id
      and lower(m.serial_number)=lower(p_serial_number)
  ) then raise exception 'A machine with this serial number is already in this Garage'; end if;

  update garage.machines
  set serial_number=nullif(p_serial_number,''),
      asset_number=nullif(p_asset_number,''),
      nickname=nullif(p_nickname,''),
      purchase_date=p_purchase_date,
      purchase_price=p_purchase_price,
      ownership_type=nullif(p_ownership_type,''),
      ownership_name=nullif(p_ownership_name,''),
      warranty_start_date=p_warranty_start_date,
      warranty_end_date=p_warranty_end_date,
      warranty_provider=nullif(p_warranty_provider,''),
      notes=nullif(p_notes,''),
      updated_at=now()
  where id=p_machine_id
  returning * into current_row;
  return current_row;
end;
$$;

revoke execute on function garage.update_machine_profile(uuid,text,text,text,date,numeric,text,text,date,date,text,text) from public, anon;
grant execute on function garage.update_machine_profile(uuid,text,text,text,date,numeric,text,text,date,date,text,text) to authenticated;
