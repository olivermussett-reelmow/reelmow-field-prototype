-- REELMOW Garage v0.6
-- Follow-up production correctness migration.
begin;

create or replace function private.write_garage_audit()
returns trigger language plpgsql security definer set search_path=''
as $$
declare target_org uuid; machine_ref uuid; row_id uuid;
begin
  row_id:=coalesce(NEW.id,OLD.id);
  if TG_TABLE_NAME='machines' then
    machine_ref:=row_id;
    select g.organization_id into target_org from garage.garages g where g.id=coalesce(NEW.garage_id,OLD.garage_id);
  else
    machine_ref:=coalesce(NEW.machine_id,OLD.machine_id);
    select g.organization_id into target_org from garage.machines m join garage.garages g on g.id=m.garage_id where m.id=machine_ref;
  end if;
  if target_org is null then return coalesce(NEW,OLD); end if;
  insert into garage.audit_events(organization_id,user_id,entity_type,entity_id,action,before_data,after_data,metadata)
  values(target_org,(select auth.uid()),'garage.'||TG_TABLE_NAME,row_id,lower(TG_OP),
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) else null end,
    case when TG_OP in ('INSERT','UPDATE') then to_jsonb(NEW) else null end,
    jsonb_build_object('machine_id',machine_ref,'source','database_trigger'));
  return coalesce(NEW,OLD);
end;
$$;

create or replace view garage.machine_service_due
with (security_invoker=true) as
select
  m.id as machine_id, st.id as service_task_id, st.task_key, st.task_name, st.instructions, st.safety_notes,
  st.confidence as task_confidence, st.source_id, st.source_page,
  m.current_engine_hours, m.current_reel_hours,
  ls.serviced_at as last_serviced_at, ls.engine_hours as last_service_engine_hours, ls.reel_hours as last_service_reel_hours,
  count(sr.id)::integer as rule_count,
  min(sr.interval_engine_hours) filter (where sr.interval_engine_hours is not null) as interval_engine_hours,
  min(sr.interval_reel_hours) filter (where sr.interval_reel_hours is not null) as interval_reel_hours,
  min(sr.interval_calendar_days) filter (where sr.interval_calendar_days is not null) as interval_calendar_days,
  least(
    min(case
      when sr.interval_engine_hours is not null and m.current_engine_hours is not null
       and ((sr.schedule_type in ('recurring','inspection')) or (sr.schedule_type='initial' and ls.serviced_at is null))
       and (sr.applies_from_engine_hours is null or m.current_engine_hours >= sr.applies_from_engine_hours)
      then coalesce(ls.engine_hours,0)+sr.interval_engine_hours-m.current_engine_hours end),
    min(case
      when sr.interval_reel_hours is not null and m.current_reel_hours is not null
       and ((sr.schedule_type in ('recurring','inspection')) or (sr.schedule_type='initial' and ls.serviced_at is null))
       and (sr.applies_from_reel_hours is null or m.current_reel_hours >= sr.applies_from_reel_hours)
      then coalesce(ls.reel_hours,0)+sr.interval_reel_hours-m.current_reel_hours end)
  ) as hours_remaining,
  min(case when sr.interval_calendar_days is not null
    then (coalesce(ls.serviced_at,m.created_at)+make_interval(days=>sr.interval_calendar_days))::date end) as calendar_due_date,
  case when bool_or(
    (sr.interval_engine_hours is not null and m.current_engine_hours is not null
      and ((sr.schedule_type in ('recurring','inspection')) or (sr.schedule_type='initial' and ls.serviced_at is null))
      and (sr.applies_from_engine_hours is null or m.current_engine_hours >= sr.applies_from_engine_hours)
      and coalesce(ls.engine_hours,0)+sr.interval_engine_hours-m.current_engine_hours<=0)
    or
    (sr.interval_reel_hours is not null and m.current_reel_hours is not null
      and ((sr.schedule_type in ('recurring','inspection')) or (sr.schedule_type='initial' and ls.serviced_at is null))
      and (sr.applies_from_reel_hours is null or m.current_reel_hours >= sr.applies_from_reel_hours)
      and coalesce(ls.reel_hours,0)+sr.interval_reel_hours-m.current_reel_hours<=0)
    or
    (sr.interval_calendar_days is not null
      and (coalesce(ls.serviced_at,m.created_at)+make_interval(days=>sr.interval_calendar_days))::date<=current_date)
  ) then 'due' else 'upcoming' end as service_status
from garage.machines m
join catalogue.machine_variants mv on mv.id=m.machine_variant_id
join catalogue.service_tasks st on st.machine_variant_id=mv.id and st.status='active'
join catalogue.service_schedule_rules sr on sr.service_task_id=st.id and sr.status='active'
left join lateral (
  select x.serviced_at,x.engine_hours,x.reel_hours
  from garage.machine_service_records x
  where x.machine_id=m.id and x.service_task_id=st.id
  order by x.serviced_at desc,x.created_at desc limit 1
) ls on true
left join garage.machine_service_records srh on srh.machine_id=m.id and srh.service_task_id=st.id
group by m.id,st.id,st.task_key,st.task_name,st.instructions,st.safety_notes,st.confidence,st.source_id,st.source_page,
  m.current_engine_hours,m.current_reel_hours,ls.serviced_at,ls.engine_hours,ls.reel_hours;

grant select on garage.machine_service_due to authenticated;

with t as (
  select st.id task_id,s.id source_id
  from catalogue.service_tasks st
  join catalogue.machine_variants mv on mv.id=st.machine_variant_id and mv.variant_name='LF3800 5-Gang'
  join catalogue.sources s on s.canonical_url='https://www.jacobsen.com/manuals/4129587_205_a.pdf'
  where st.task_key='engine_oil_change'
)
insert into catalogue.service_schedule_rules(service_task_id,interval_engine_hours,trigger_description,source_id,confidence,status,schedule_type,applies_from_engine_hours)
select task_id,50,'Initial engine oil service at 50 hours on a new engine.',source_id,'high','active','initial',0
from t
where not exists(select 1 from catalogue.service_schedule_rules r where r.service_task_id=t.task_id and r.schedule_type='initial');

commit;
