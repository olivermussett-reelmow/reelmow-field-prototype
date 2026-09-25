-- REELMOW backend v0.8
-- Move privileged write implementations behind private SECURITY DEFINER
-- functions; expose only SECURITY INVOKER Garage API wrappers.
begin;

create or replace function private.create_organization(org_name text, org_slug text)
returns uuid language plpgsql security definer set search_path=''
as $$
declare new_org uuid;
begin
  if (auth.uid()) is null then raise exception 'authentication required'; end if;
  insert into garage.organizations(name,slug,created_by)
  values(org_name,org_slug,auth.uid()) returning id into new_org;
  insert into garage.memberships(organization_id,user_id,role)
  values(new_org,auth.uid(),'owner');
  return new_org;
end;
$$;

create or replace function private.record_machine_hours(
  target_machine uuid,new_engine_hours numeric,new_reel_hours numeric,
  reading_source text default 'manual',reading_notes text default null
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare new_log uuid; org_id uuid; current_engine numeric; current_reel numeric;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select g.organization_id,m.current_engine_hours,m.current_reel_hours
    into org_id,current_engine,current_reel
  from garage.machines m join garage.garages g on g.id=m.garage_id
  where m.id=target_machine;
  if org_id is null then raise exception 'machine not found'; end if;
  if not private.has_org_role(org_id,array['owner','admin','manager','operator']::garage.member_role[]) then raise exception 'not authorised'; end if;
  if new_engine_hours is null and new_reel_hours is null then raise exception 'at least one hours reading is required'; end if;
  if new_engine_hours is not null and new_engine_hours < 0 then raise exception 'engine hours cannot be negative'; end if;
  if new_reel_hours is not null and new_reel_hours < 0 then raise exception 'reel hours cannot be negative'; end if;
  if current_engine is not null and new_engine_hours is not null and new_engine_hours < current_engine then raise exception 'engine hours cannot be lower than the current machine reading'; end if;
  if current_reel is not null and new_reel_hours is not null and new_reel_hours < current_reel then raise exception 'reel hours cannot be lower than the current machine reading'; end if;
  insert into garage.machine_hours_log(machine_id,engine_hours,reel_hours,source,notes,created_by)
  values(target_machine,new_engine_hours,new_reel_hours,coalesce(nullif(reading_source,''),'manual'),reading_notes,auth.uid())
  returning id into new_log;
  update garage.machines
  set current_engine_hours=coalesce(new_engine_hours,current_engine_hours),
      current_reel_hours=coalesce(new_reel_hours,current_reel_hours),updated_at=now()
  where id=target_machine;
  return new_log;
end;
$$;

create or replace function private.record_machine_service(
  target_machine uuid,target_service_task uuid,service_date timestamptz,
  service_engine_hours numeric,service_reel_hours numeric,performed_by_name text,
  service_cost numeric,service_notes text,evidence_json jsonb default '{}'::jsonb
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare new_record uuid; org_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select g.organization_id into org_id
  from garage.machines m join garage.garages g on g.id=m.garage_id
  where m.id=target_machine;
  if org_id is null then raise exception 'machine not found'; end if;
  if not private.has_org_role(org_id,array['owner','admin','manager','operator']::garage.member_role[]) then raise exception 'not authorised'; end if;
  if service_engine_hours is not null and service_engine_hours < 0 then raise exception 'engine hours cannot be negative'; end if;
  if service_reel_hours is not null and service_reel_hours < 0 then raise exception 'reel hours cannot be negative'; end if;
  if service_cost is not null and service_cost < 0 then raise exception 'cost cannot be negative'; end if;
  insert into garage.machine_service_records(machine_id,service_task_id,serviced_at,engine_hours,reel_hours,performed_by,cost,notes,evidence,created_by)
  values(target_machine,target_service_task,coalesce(service_date,now()),service_engine_hours,service_reel_hours,
    performed_by_name,service_cost,service_notes,coalesce(evidence_json,'{}'::jsonb),auth.uid())
  returning id into new_record;
  update garage.machines
  set current_engine_hours=case when service_engine_hours is null then current_engine_hours when current_engine_hours is null then service_engine_hours else greatest(current_engine_hours,service_engine_hours) end,
      current_reel_hours=case when service_reel_hours is null then current_reel_hours when current_reel_hours is null then service_reel_hours else greatest(current_reel_hours,service_reel_hours) end,
      updated_at=now()
  where id=target_machine;
  return new_record;
end;
$$;

revoke all on function private.create_organization(text,text) from public,anon,authenticated;
revoke all on function private.record_machine_hours(uuid,numeric,numeric,text,text) from public,anon,authenticated;
revoke all on function private.record_machine_service(uuid,uuid,timestamptz,numeric,numeric,text,numeric,text,jsonb) from public,anon,authenticated;

create or replace function garage.create_organization(org_name text,org_slug text)
returns uuid language sql security invoker set search_path=''
as $$ select private.create_organization(org_name,org_slug); $$;

create or replace function garage.record_machine_hours(
  target_machine uuid,new_engine_hours numeric,new_reel_hours numeric,
  reading_source text default 'manual',reading_notes text default null
)
returns uuid language sql security invoker set search_path=''
as $$ select private.record_machine_hours(target_machine,new_engine_hours,new_reel_hours,reading_source,reading_notes); $$;

create or replace function garage.record_machine_service(
  target_machine uuid,target_service_task uuid,service_date timestamptz,
  service_engine_hours numeric,service_reel_hours numeric,performed_by_name text,
  service_cost numeric,service_notes text,evidence_json jsonb default '{}'::jsonb
)
returns uuid language sql security invoker set search_path=''
as $$ select private.record_machine_service(target_machine,target_service_task,service_date,service_engine_hours,service_reel_hours,performed_by_name,service_cost,service_notes,evidence_json); $$;

revoke all on function garage.create_organization(text,text) from public,anon;
revoke all on function garage.record_machine_hours(uuid,numeric,numeric,text,text) from public,anon;
revoke all on function garage.record_machine_service(uuid,uuid,timestamptz,numeric,numeric,text,numeric,text,jsonb) from public,anon;
grant execute on function garage.create_organization(text,text) to authenticated;
grant execute on function garage.record_machine_hours(uuid,numeric,numeric,text,text) to authenticated;
grant execute on function garage.record_machine_service(uuid,uuid,timestamptz,numeric,numeric,text,numeric,text,jsonb) to authenticated;

commit;
