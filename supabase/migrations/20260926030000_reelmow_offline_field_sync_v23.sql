-- REELMOW offline field mutation idempotency.
-- Applied to production Supabase as reelmow_offline_sync_operations_v23,
-- reelmow_offline_sync_helpers_v23 and reelmow_offline_sync_wrappers_v23.

create table if not exists garage.sync_operations (
  operation_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_type text not null check (operation_type = any (array['hours','service','fault'])),
  machine_id uuid not null references garage.machines(id) on delete cascade,
  status text not null default 'processing' check (status = any (array['processing','completed'])),
  result_id uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists sync_operations_user_created_idx on garage.sync_operations(user_id,created_at desc);
alter table garage.sync_operations enable row level security;

create or replace function private.begin_sync_operation(p_operation_id uuid,p_operation_type text,p_machine_id uuid) returns uuid language plpgsql security definer set search_path to '' as $function$
declare existing_user uuid; existing_type text; existing_status text; existing_result uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select user_id,operation_type,status,result_id into existing_user,existing_type,existing_status,existing_result from garage.sync_operations where operation_id=p_operation_id for update;
  if existing_user is not null then
    if existing_user<>auth.uid() or existing_type<>p_operation_type then raise exception 'operation id cannot be reused'; end if;
    if existing_status='completed' then return existing_result; end if;
    raise exception 'operation is already processing';
  end if;
  insert into garage.sync_operations(operation_id,user_id,operation_type,machine_id) values(p_operation_id,auth.uid(),p_operation_type,p_machine_id);
  return null;
end;$function$;

create or replace function private.complete_sync_operation(p_operation_id uuid,p_result_id uuid) returns uuid language sql security definer set search_path to '' as $function$
update garage.sync_operations set status='completed',result_id=p_result_id,completed_at=now() where operation_id=p_operation_id and user_id=auth.uid() returning result_id;$function$;

create or replace function garage.sync_record_machine_hours(operation_id uuid,target_machine uuid,new_engine_hours numeric,new_reel_hours numeric,reading_source text default 'manual',reading_notes text default null) returns uuid language plpgsql security definer set search_path to '' as $function$
declare existing_result uuid; new_result uuid;
begin
  existing_result:=private.begin_sync_operation(operation_id,'hours',target_machine);
  if existing_result is not null then return existing_result; end if;
  new_result:=private.record_machine_hours(target_machine,new_engine_hours,new_reel_hours,reading_source,reading_notes);
  return private.complete_sync_operation(operation_id,new_result);
end;$function$;

create or replace function garage.sync_record_machine_service(operation_id uuid,target_machine uuid,target_service_task uuid,service_date timestamptz,service_engine_hours numeric,service_reel_hours numeric,performed_by_name text,service_cost numeric,service_notes text,evidence_json jsonb default '{}'::jsonb) returns uuid language plpgsql security definer set search_path to '' as $function$
declare existing_result uuid; new_result uuid;
begin
  existing_result:=private.begin_sync_operation(operation_id,'service',target_machine);
  if existing_result is not null then return existing_result; end if;
  new_result:=private.record_machine_service(target_machine,target_service_task,service_date,service_engine_hours,service_reel_hours,performed_by_name,service_cost,service_notes,evidence_json);
  return private.complete_sync_operation(operation_id,new_result);
end;$function$;

create or replace function garage.sync_report_machine_fault(operation_id uuid,target_machine uuid,target_severity text,target_description text) returns uuid language plpgsql security definer set search_path to '' as $function$
declare existing_result uuid; new_result uuid; org_id uuid;
begin
  existing_result:=private.begin_sync_operation(operation_id,'fault',target_machine);
  if existing_result is not null then return existing_result; end if;
  select g.organization_id into org_id from garage.machines m join garage.garages g on g.id=m.garage_id where m.id=target_machine;
  if org_id is null then raise exception 'machine not found'; end if;
  if not private.has_org_role(org_id,array['owner','admin','manager','operator']::garage.member_role[]) then raise exception 'not authorised'; end if;
  if target_severity not in ('low','medium','high','critical') then raise exception 'invalid severity'; end if;
  if length(btrim(coalesce(target_description,'')))<2 then raise exception 'problem description is required'; end if;
  insert into garage.machine_faults(machine_id,severity,status,description,reported_by) values(target_machine,target_severity,'open',btrim(target_description),auth.uid()) returning id into new_result;
  return private.complete_sync_operation(operation_id,new_result);
end;$function$;

grant execute on function garage.sync_record_machine_hours(uuid,uuid,numeric,numeric,text,text) to authenticated;
grant execute on function garage.sync_record_machine_service(uuid,uuid,uuid,timestamptz,numeric,numeric,text,numeric,text,jsonb) to authenticated;
grant execute on function garage.sync_report_machine_fault(uuid,uuid,text,text) to authenticated;