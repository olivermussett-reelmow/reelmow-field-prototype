begin;

-- 1. Storage object policies must validate the object's path, not the garage
-- row's human-readable name. The previous UPDATE/DELETE/SELECT policies
-- accidentally parsed g.name instead of storage.objects.name.
drop policy if exists "garage object read" on storage.objects;
drop policy if exists "garage object update" on storage.objects;
drop policy if exists "garage object delete" on storage.objects;

create policy "garage object read"
on storage.objects for select to authenticated
using (
  bucket_id='reelmow-garage-private'
  and (storage.foldername(name))[1]='org'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[3]='machines'
  and (storage.foldername(name))[4] ~* '^[0-9a-f-]{36}$'
  and exists (
    select 1
    from garage.machines m
    join garage.garages g on g.id=m.garage_id
    where g.organization_id=((storage.foldername(name))[2])::uuid
      and m.id=((storage.foldername(name))[4])::uuid
      and private.is_org_member(g.organization_id)
  )
);

create policy "garage object update"
on storage.objects for update to authenticated
using (
  bucket_id='reelmow-garage-private'
  and (storage.foldername(name))[1]='org'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[3]='machines'
  and (storage.foldername(name))[4] ~* '^[0-9a-f-]{36}$'
  and exists (
    select 1
    from garage.machines m
    join garage.garages g on g.id=m.garage_id
    where g.organization_id=((storage.foldername(name))[2])::uuid
      and m.id=((storage.foldername(name))[4])::uuid
      and private.has_org_role(g.organization_id,array['owner','admin','manager']::garage.member_role[])
  )
)
with check (
  bucket_id='reelmow-garage-private'
  and (storage.foldername(name))[1]='org'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[3]='machines'
  and (storage.foldername(name))[4] ~* '^[0-9a-f-]{36}$'
  and exists (
    select 1
    from garage.machines m
    join garage.garages g on g.id=m.garage_id
    where g.organization_id=((storage.foldername(name))[2])::uuid
      and m.id=((storage.foldername(name))[4])::uuid
      and private.has_org_role(g.organization_id,array['owner','admin','manager']::garage.member_role[])
  )
);

create policy "garage object delete"
on storage.objects for delete to authenticated
using (
  bucket_id='reelmow-garage-private'
  and (storage.foldername(name))[1]='org'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[3]='machines'
  and (storage.foldername(name))[4] ~* '^[0-9a-f-]{36}$'
  and exists (
    select 1
    from garage.machines m
    join garage.garages g on g.id=m.garage_id
    where g.organization_id=((storage.foldername(name))[2])::uuid
      and m.id=((storage.foldername(name))[4])::uuid
      and private.has_org_role(g.organization_id,array['owner','admin','manager']::garage.member_role[])
  )
);

-- 2. Make service records consistent with machine state and catalogue fitment.
create or replace function private.record_machine_service(
  target_machine uuid,
  target_service_task uuid,
  service_date timestamptz,
  service_engine_hours numeric,
  service_reel_hours numeric,
  performed_by_name text,
  service_cost numeric,
  service_notes text,
  evidence_json jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  new_record uuid;
  org_id uuid;
  machine_variant uuid;
  current_engine numeric;
  current_reel numeric;
  task_variant uuid;
  task_status catalogue.record_status;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select g.organization_id,m.machine_variant_id,m.current_engine_hours,m.current_reel_hours
    into org_id,machine_variant,current_engine,current_reel
  from garage.machines m
  join garage.garages g on g.id=m.garage_id
  where m.id=target_machine;

  if org_id is null then raise exception 'machine not found'; end if;

  if not private.has_org_role(
    org_id,array['owner','admin','manager','operator']::garage.member_role[]
  ) then
    raise exception 'not authorised';
  end if;

  select st.machine_variant_id,st.status
    into task_variant,task_status
  from catalogue.service_tasks st
  where st.id=target_service_task;

  if task_variant is null or task_variant<>machine_variant
     or task_status<> 'active'::catalogue.record_status then
    raise exception 'service task does not belong to this machine variant';
  end if;

  if service_engine_hours is not null and service_engine_hours < 0
    then raise exception 'engine hours cannot be negative'; end if;
  if service_reel_hours is not null and service_reel_hours < 0
    then raise exception 'reel hours cannot be negative'; end if;
  if service_cost is not null and service_cost < 0
    then raise exception 'cost cannot be negative'; end if;

  if current_engine is not null and service_engine_hours is not null
     and service_engine_hours < current_engine
    then raise exception 'service engine hours cannot be lower than the current machine reading'; end if;

  if current_reel is not null and service_reel_hours is not null
     and service_reel_hours < current_reel
    then raise exception 'service reel hours cannot be lower than the current machine reading'; end if;

  insert into garage.machine_service_records(
    machine_id,service_task_id,serviced_at,engine_hours,reel_hours,
    performed_by,cost,notes,evidence,created_by
  )
  values(
    target_machine,target_service_task,coalesce(service_date,now()),
    service_engine_hours,service_reel_hours,performed_by_name,
    service_cost,service_notes,coalesce(evidence_json,'{}'::jsonb),auth.uid()
  )
  returning id into new_record;

  update garage.machines
  set current_engine_hours=greatest(
        coalesce(current_engine_hours,0),
        coalesce(service_engine_hours,current_engine_hours,0)
      ),
      current_reel_hours=case
        when service_reel_hours is null then current_reel_hours
        when current_reel_hours is null then service_reel_hours
        else greatest(current_reel_hours,service_reel_hours)
      end,
      updated_at=now()
  where id=target_machine;

  return new_record;
end;
$function$;

-- 3. Correct service due semantics:
--    * before an initial threshold, due at the threshold;
--    * once the threshold is reached with no prior service, status is due;
--    * after a recorded service, recurring intervals start from that service.
create or replace view garage.machine_service_due
with (security_invoker=true)
as
select
  m.id as machine_id,
  st.id as service_task_id,
  st.task_key,
  st.task_name,
  st.instructions,
  st.safety_notes,
  st.confidence as task_confidence,
  st.source_id,
  st.source_page,
  m.current_engine_hours,
  m.current_reel_hours,
  ls.serviced_at as last_serviced_at,
  ls.engine_hours as last_service_engine_hours,
  ls.reel_hours as last_service_reel_hours,
  count(distinct sr.id)::integer as rule_count,
  min(sr.interval_engine_hours) filter (where sr.interval_engine_hours is not null) as interval_engine_hours,
  min(sr.interval_reel_hours) filter (where sr.interval_reel_hours is not null) as interval_reel_hours,
  min(sr.interval_calendar_days) filter (where sr.interval_calendar_days is not null) as interval_calendar_days,
  least(
    min(
      case
        when sr.interval_engine_hours is null
          or m.current_engine_hours is null
          or sr.schedule_type not in ('recurring','inspection')
        then null
        when ls.engine_hours is not null
        then (ls.engine_hours + sr.interval_engine_hours) - m.current_engine_hours
        when sr.applies_from_engine_hours is not null
        then sr.applies_from_engine_hours - m.current_engine_hours
        else sr.interval_engine_hours - m.current_engine_hours
      end
    ),
    min(
      case
        when sr.interval_reel_hours is null
          or m.current_reel_hours is null
          or sr.schedule_type not in ('recurring','inspection')
        then null
        when ls.reel_hours is not null
        then (ls.reel_hours + sr.interval_reel_hours) - m.current_reel_hours
        when sr.applies_from_reel_hours is not null
        then sr.applies_from_reel_hours - m.current_reel_hours
        else sr.interval_reel_hours - m.current_reel_hours
      end
    )
  ) as hours_remaining,
  min(
    case
      when sr.interval_calendar_days is not null
      then (coalesce(ls.serviced_at,m.created_at)+make_interval(days=>sr.interval_calendar_days))::date
      else null::date
    end
  ) as calendar_due_date,
  case
    when bool_or(
      (
        sr.interval_engine_hours is not null
        and m.current_engine_hours is not null
        and sr.schedule_type in ('recurring','inspection')
        and (
          case
            when ls.engine_hours is not null
            then (ls.engine_hours + sr.interval_engine_hours) - m.current_engine_hours <= 0
            when sr.applies_from_engine_hours is not null
            then sr.applies_from_engine_hours - m.current_engine_hours <= 0
            else sr.interval_engine_hours - m.current_engine_hours <= 0
          end
        )
      )
      or (
        sr.interval_reel_hours is not null
        and m.current_reel_hours is not null
        and sr.schedule_type in ('recurring','inspection')
        and (
          case
            when ls.reel_hours is not null
            then (ls.reel_hours + sr.interval_reel_hours) - m.current_reel_hours <= 0
            when sr.applies_from_reel_hours is not null
            then sr.applies_from_reel_hours - m.current_reel_hours <= 0
            else sr.interval_reel_hours - m.current_reel_hours <= 0
          end
        )
      )
      or (
        sr.interval_calendar_days is not null
        and (coalesce(ls.serviced_at,m.created_at)+make_interval(days=>sr.interval_calendar_days))::date <= current_date
      )
    )
    then 'due'::text
    else 'upcoming'::text
  end as service_status
from garage.machines m
join catalogue.machine_variants mv on mv.id=m.machine_variant_id
join catalogue.service_tasks st
  on st.machine_variant_id=mv.id
 and st.status='active'::catalogue.record_status
join catalogue.service_schedule_rules sr
  on sr.service_task_id=st.id
 and sr.status='active'::catalogue.record_status
left join lateral (
  select x.serviced_at,x.engine_hours,x.reel_hours
  from garage.machine_service_records x
  where x.machine_id=m.id and x.service_task_id=st.id
  order by x.serviced_at desc,x.created_at desc
  limit 1
) ls on true
group by
  m.id,st.id,st.task_key,st.task_name,st.instructions,st.safety_notes,
  st.confidence,st.source_id,st.source_page,m.current_engine_hours,
  m.current_reel_hours,ls.serviced_at,ls.engine_hours,ls.reel_hours;

commit;