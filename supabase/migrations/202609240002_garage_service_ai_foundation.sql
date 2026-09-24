-- REELMOW Garage v0.3
-- Service tracking, safer hour/service writes, richer due logic, and AI-ingestion scaffolding.
-- Depends on 202609240001_reelmow_foundation_v02.sql.

begin;

-- ---------- service schedule semantics ----------
alter table catalogue.service_schedule_rules
  add column if not exists schedule_type text not null default 'recurring'
    check (schedule_type in ('recurring','initial','calendar','inspection'));

alter table catalogue.service_schedule_rules
  add column if not exists applies_from_engine_hours numeric
    check (applies_from_engine_hours is null or applies_from_engine_hours >= 0);

alter table catalogue.service_schedule_rules
  add column if not exists applies_from_reel_hours numeric
    check (applies_from_reel_hours is null or applies_from_reel_hours >= 0);

-- ---------- ingestion / AI provenance ----------
create table if not exists ingestion.ai_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ingestion.jobs(id) on delete cascade,
  document_id uuid references catalogue.documents(id) on delete set null,
  provider text not null default 'openai',
  model text not null,
  task text not null,
  status text not null default 'queued'
    check (status in ('queued','running','completed','failed','needs_review')),
  input_hash text,
  output_json jsonb,
  usage_json jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists ai_runs_job_idx on ingestion.ai_runs(job_id, created_at desc);
create index if not exists extracted_facts_document_idx on ingestion.extracted_facts(document_id, document_page_id);
create index if not exists extracted_facts_field_idx on ingestion.extracted_facts(entity_type, field_key, status);

-- Every AI-derived fact must remain reviewable. Canonical catalogue data is not written directly by the AI.
comment on table ingestion.ai_runs is
  'AI extraction audit trail. AI output is proposed evidence only; publication to catalogue requires validation.';
comment on table ingestion.extracted_facts is
  'Candidate facts extracted from source documents. These are not canonical until reviewed.';

-- ---------- robust service due calculation ----------
drop view if exists garage.machine_service_due;

create or replace view garage.machine_service_due
with (security_invoker = true) as
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
  count(sr.id)::integer as rule_count,
  min(sr.interval_engine_hours) filter (where sr.interval_engine_hours is not null) as interval_engine_hours,
  min(sr.interval_reel_hours) filter (where sr.interval_reel_hours is not null) as interval_reel_hours,
  min(sr.interval_calendar_days) filter (where sr.interval_calendar_days is not null) as interval_calendar_days,
  least(
    min(
      case
        when sr.interval_engine_hours is not null
         and m.current_engine_hours is not null
         and sr.schedule_type in ('recurring','inspection')
         and (sr.applies_from_engine_hours is null or m.current_engine_hours >= sr.applies_from_engine_hours)
        then coalesce(ls.engine_hours, 0) + sr.interval_engine_hours - m.current_engine_hours
      end
    ),
    min(
      case
        when sr.interval_reel_hours is not null
         and m.current_reel_hours is not null
         and sr.schedule_type in ('recurring','inspection')
         and (sr.applies_from_reel_hours is null or m.current_reel_hours >= sr.applies_from_reel_hours)
        then coalesce(ls.reel_hours, 0) + sr.interval_reel_hours - m.current_reel_hours
      end
    )
  ) as hours_remaining,
  min(
    case
      when sr.interval_calendar_days is not null
      then (coalesce(ls.serviced_at, m.created_at) + make_interval(days => sr.interval_calendar_days))::date
    end
  ) as calendar_due_date,
  case
    when bool_or(
      (sr.interval_engine_hours is not null and m.current_engine_hours is not null
       and sr.schedule_type in ('recurring','inspection')
       and (sr.applies_from_engine_hours is null or m.current_engine_hours >= sr.applies_from_engine_hours)
       and coalesce(ls.engine_hours,0) + sr.interval_engine_hours - m.current_engine_hours <= 0)
      or
      (sr.interval_reel_hours is not null and m.current_reel_hours is not null
       and sr.schedule_type in ('recurring','inspection')
       and (sr.applies_from_reel_hours is null or m.current_reel_hours >= sr.applies_from_reel_hours)
       and coalesce(ls.reel_hours,0) + sr.interval_reel_hours - m.current_reel_hours <= 0)
      or
      (sr.interval_calendar_days is not null
       and (coalesce(ls.serviced_at, m.created_at) + make_interval(days => sr.interval_calendar_days))::date <= current_date)
    ) then 'due'
    else 'upcoming'
  end as service_status
from garage.machines m
join catalogue.machine_variants mv on mv.id = m.machine_variant_id
join catalogue.service_tasks st on st.machine_variant_id = mv.id and st.status = 'active'
join catalogue.service_schedule_rules sr on sr.service_task_id = st.id and sr.status = 'active'
left join lateral (
  select x.serviced_at, x.engine_hours, x.reel_hours
  from garage.machine_service_records x
  where x.machine_id = m.id and x.service_task_id = st.id
  order by x.serviced_at desc, x.created_at desc
  limit 1
) ls on true
left join garage.machine_service_records srh on srh.machine_id = m.id and srh.service_task_id = st.id
group by
  m.id, st.id, st.task_key, st.task_name, st.instructions, st.safety_notes,
  st.confidence, st.source_id, st.source_page, m.current_engine_hours,
  m.current_reel_hours, ls.serviced_at, ls.engine_hours, ls.reel_hours;

grant select on garage.machine_service_due to authenticated;

-- ---------- atomic operational writes ----------
create or replace function garage.record_machine_hours(
  target_machine uuid,
  new_engine_hours numeric,
  new_reel_hours numeric,
  reading_source text default 'manual',
  reading_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  new_log uuid;
  org_id uuid;
  current_engine numeric;
  current_reel numeric;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;

  select g.organization_id, m.current_engine_hours, m.current_reel_hours
    into org_id, current_engine, current_reel
  from garage.machines m
  join garage.garages g on g.id = m.garage_id
  where m.id = target_machine;

  if org_id is null then raise exception 'machine not found'; end if;
  if not private.has_org_role(org_id,array['owner','admin','manager','operator']::garage.member_role[]) then
    raise exception 'not authorised';
  end if;
  if new_engine_hours is null and new_reel_hours is null then
    raise exception 'at least one hours reading is required';
  end if;
  if new_engine_hours is not null and new_engine_hours < 0 then
    raise exception 'engine hours cannot be negative';
  end if;
  if new_reel_hours is not null and new_reel_hours < 0 then
    raise exception 'reel hours cannot be negative';
  end if;
  if current_engine is not null and new_engine_hours is not null and new_engine_hours < current_engine then
    raise exception 'engine hours cannot be lower than the current machine reading';
  end if;
  if current_reel is not null and new_reel_hours is not null and new_reel_hours < current_reel then
    raise exception 'reel hours cannot be lower than the current machine reading';
  end if;

  insert into garage.machine_hours_log(machine_id,engine_hours,reel_hours,source,notes,created_by)
  values(target_machine,new_engine_hours,new_reel_hours,coalesce(nullif(reading_source,''),'manual'),reading_notes,(select auth.uid()))
  returning id into new_log;

  update garage.machines
  set current_engine_hours = coalesce(new_engine_hours,current_engine_hours),
      current_reel_hours = coalesce(new_reel_hours,current_reel_hours),
      updated_at = now()
  where id = target_machine;

  return new_log;
end;
$$;

create or replace function garage.record_machine_service(
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
as $$
declare
  new_record uuid;
  org_id uuid;
  current_engine numeric;
  current_reel numeric;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;

  select g.organization_id, m.current_engine_hours, m.current_reel_hours
    into org_id, current_engine, current_reel
  from garage.machines m
  join garage.garages g on g.id=m.garage_id
  where m.id=target_machine;

  if org_id is null then raise exception 'machine not found'; end if;
  if not private.has_org_role(org_id,array['owner','admin','manager','operator']::garage.member_role[]) then
    raise exception 'not authorised';
  end if;
  if service_engine_hours is not null and service_engine_hours < 0 then raise exception 'engine hours cannot be negative'; end if;
  if service_reel_hours is not null and service_reel_hours < 0 then raise exception 'reel hours cannot be negative'; end if;
  if service_cost is not null and service_cost < 0 then raise exception 'cost cannot be negative'; end if;

  insert into garage.machine_service_records(
    machine_id,service_task_id,serviced_at,engine_hours,reel_hours,
    performed_by,cost,notes,evidence,created_by
  )
  values(
    target_machine,target_service_task,coalesce(service_date,now()),
    service_engine_hours,service_reel_hours,performed_by_name,service_cost,
    service_notes,coalesce(evidence_json,'{}'::jsonb),(select auth.uid())
  )
  returning id into new_record;

  update garage.machines
  set current_engine_hours = greatest(coalesce(current_engine_hours,0),coalesce(service_engine_hours,current_engine_hours,0)),
      current_reel_hours = case
        when service_reel_hours is null then current_reel_hours
        when current_reel_hours is null then service_reel_hours
        else greatest(current_reel_hours,service_reel_hours)
      end,
      updated_at = now()
  where id=target_machine;

  return new_record;
end;
$$;

revoke all on function garage.record_machine_hours(uuid,numeric,numeric,text,text) from public;
revoke all on function garage.record_machine_service(uuid,uuid,timestamptz,numeric,numeric,text,numeric,text,jsonb) from public;
grant execute on function garage.record_machine_hours(uuid,numeric,numeric,text,text) to authenticated;
grant execute on function garage.record_machine_service(uuid,uuid,timestamptz,numeric,numeric,text,numeric,text,jsonb) to authenticated;

-- ---------- high-confidence LF3800 service seed ----------
with v as (
  select mv.id variant_id, s.id source_id
  from catalogue.machine_variants mv
  join catalogue.machine_models mm on mm.id=mv.machine_model_id and mm.slug='lf3800'
  join catalogue.sources s on s.canonical_url='https://www.jacobsen.com/manuals/4129587_205_a.pdf'
  where mv.variant_name='LF3800 5-Gang'
)
insert into catalogue.service_tasks(
  machine_variant_id,task_key,task_name,instructions,safety_notes,confidence,source_id,source_page,status
)
select variant_id,'engine_oil_change','Engine oil change',
       'Check engine oil daily. Change engine oil after the first 50 hours on a new engine and every 100 hours thereafter. Follow the engine manual for the engine-specific procedure and oil requirements.',
       'Stop the engine, remove the key and follow the manufacturer safety procedure before servicing.',
       'high',source_id,16,'active'
from v
on conflict(machine_variant_id,task_key) do update set
  instructions=excluded.instructions,safety_notes=excluded.safety_notes,
  confidence=excluded.confidence,source_id=excluded.source_id,source_page=excluded.source_page,status='active';

with t as (
  select st.id task_id,s.id source_id
  from catalogue.service_tasks st
  join catalogue.machine_variants mv on mv.id=st.machine_variant_id and mv.variant_name='LF3800 5-Gang'
  join catalogue.sources s on s.canonical_url='https://www.jacobsen.com/manuals/4129587_205_a.pdf'
  where st.task_key='engine_oil_change'
)
insert into catalogue.service_schedule_rules(
  service_task_id,interval_engine_hours,trigger_description,source_id,confidence,status,schedule_type,applies_from_engine_hours
)
select task_id,100,'Every 100 hours after the initial 50-hour service.',source_id,'high','active','recurring',50
from t
where not exists(select 1 from catalogue.service_schedule_rules r where r.service_task_id=t.task_id and r.interval_engine_hours=100 and r.schedule_type='recurring');

with v as (
  select mv.id variant_id,s.id source_id
  from catalogue.machine_variants mv
  join catalogue.machine_models mm on mm.id=mv.machine_model_id and mm.slug='lf3800'
  join catalogue.sources s on s.canonical_url='https://www.jacobsen.com/manuals/4129587_205_a.pdf'
  where mv.variant_name='LF3800 5-Gang'
)
insert into catalogue.service_tasks(machine_variant_id,task_key,task_name,instructions,confidence,source_id,source_page,status)
select variant_id,'fuel_lines_clamps','Inspect fuel lines and clamps',
       'Inspect fuel lines and clamps every 50 hours and replace at the first sign of damage.',
       'high',source_id,17,'active'
from v
on conflict(machine_variant_id,task_key) do update set
  instructions=excluded.instructions,confidence=excluded.confidence,source_id=excluded.source_id,source_page=excluded.source_page,status='active';

with t as (
  select st.id task_id,s.id source_id from catalogue.service_tasks st
  join catalogue.machine_variants mv on mv.id=st.machine_variant_id and mv.variant_name='LF3800 5-Gang'
  join catalogue.sources s on s.canonical_url='https://www.jacobsen.com/manuals/4129587_205_a.pdf'
  where st.task_key='fuel_lines_clamps'
)
insert into catalogue.service_schedule_rules(service_task_id,interval_engine_hours,source_id,confidence,status,schedule_type)
select task_id,50,source_id,'high','active','inspection' from t
where not exists(select 1 from catalogue.service_schedule_rules r where r.service_task_id=t.task_id and r.interval_engine_hours=50);

with v as (
  select mv.id variant_id,s.id source_id
  from catalogue.machine_variants mv
  join catalogue.machine_models mm on mm.id=mv.machine_model_id and mm.slug='lf3800'
  join catalogue.sources s on s.canonical_url='https://www.jacobsen.com/manuals/4129587_205_a.pdf'
  where mv.variant_name='LF3800 5-Gang'
)
insert into catalogue.service_tasks(machine_variant_id,task_key,task_name,instructions,confidence,source_id,source_page,status)
select variant_id,'battery_electrolyte','Check battery electrolyte',
       'Check electrolyte level every 100 hours. Keep battery terminals and posts clean.',
       'high',source_id,18,'active'
from v
on conflict(machine_variant_id,task_key) do update set
  instructions=excluded.instructions,confidence=excluded.confidence,source_id=excluded.source_id,source_page=excluded.source_page,status='active';

with t as (
  select st.id task_id,s.id source_id from catalogue.service_tasks st
  join catalogue.machine_variants mv on mv.id=st.machine_variant_id and mv.variant_name='LF3800 5-Gang'
  join catalogue.sources s on s.canonical_url='https://www.jacobsen.com/manuals/4129587_205_a.pdf'
  where st.task_key='battery_electrolyte'
)
insert into catalogue.service_schedule_rules(service_task_id,interval_engine_hours,source_id,confidence,status,schedule_type)
select task_id,100,source_id,'high','active','inspection' from t
where not exists(select 1 from catalogue.service_schedule_rules r where r.service_task_id=t.task_id and r.interval_engine_hours=100);

with v as (
  select mv.id variant_id,s.id source_id
  from catalogue.machine_variants mv
  join catalogue.machine_models mm on mm.id=mv.machine_model_id and mm.slug='lf3800'
  join catalogue.sources s on s.canonical_url='https://www.jacobsen.com/manuals/4129587_205_a.pdf'
  where mv.variant_name='LF3800 5-Gang'
)
insert into catalogue.service_tasks(machine_variant_id,task_key,task_name,instructions,confidence,source_id,source_page,status)
select variant_id,'grease_f1','Lubricate F1 grease points',
       'Lubricate F1 points every 50 hours: swivel housing, lift arm, lift cylinders, lift arm pivot, brake pedal pivot, traction pedal pivot, ball joint, steering pivot, steering cylinder and axle pivot.',
       'high',source_id,28,'active'
from v
on conflict(machine_variant_id,task_key) do update set
  instructions=excluded.instructions,confidence=excluded.confidence,source_id=excluded.source_id,source_page=excluded.source_page,status='active';

with t as (
  select st.id task_id,s.id source_id from catalogue.service_tasks st
  join catalogue.machine_variants mv on mv.id=st.machine_variant_id and mv.variant_name='LF3800 5-Gang'
  join catalogue.sources s on s.canonical_url='https://www.jacobsen.com/manuals/4129587_205_a.pdf'
  where st.task_key='grease_f1'
)
insert into catalogue.service_schedule_rules(service_task_id,interval_engine_hours,source_id,confidence,status,schedule_type)
select task_id,50,source_id,'high','active','recurring' from t
where not exists(select 1 from catalogue.service_schedule_rules r where r.service_task_id=t.task_id and r.interval_engine_hours=50);

with v as (
  select mv.id variant_id,s.id source_id
  from catalogue.machine_variants mv
  join catalogue.machine_models mm on mm.id=mv.machine_model_id and mm.slug='lf3800'
  join catalogue.sources s on s.canonical_url='https://www.jacobsen.com/manuals/4129587_205_a.pdf'
  where mv.variant_name='LF3800 5-Gang'
)
insert into catalogue.service_tasks(machine_variant_id,task_key,task_name,instructions,confidence,source_id,source_page,status)
select variant_id,'grease_f2','Lubricate F2 grease points',
       'Lubricate F2 points every 100 hours: reel bearing cavity, front roller, rear roller and U-joint driveshaft.',
       'high',source_id,28,'active'
from v
on conflict(machine_variant_id,task_key) do update set
  instructions=excluded.instructions,confidence=excluded.confidence,source_id=excluded.source_id,source_page=excluded.source_page,status='active';

with t as (
  select st.id task_id,s.id source_id from catalogue.service_tasks st
  join catalogue.machine_variants mv on mv.id=st.machine_variant_id and mv.variant_name='LF3800 5-Gang'
  join catalogue.sources s on s.canonical_url='https://www.jacobsen.com/manuals/4129587_205_a.pdf'
  where st.task_key='grease_f2'
)
insert into catalogue.service_schedule_rules(service_task_id,interval_engine_hours,source_id,confidence,status,schedule_type)
select task_id,100,source_id,'high','active','recurring' from t
where not exists(select 1 from catalogue.service_schedule_rules r where r.service_task_id=t.task_id and r.interval_engine_hours=100);

with v as (
  select mv.id variant_id,s.id source_id
  from catalogue.machine_variants mv
  join catalogue.machine_models mm on mm.id=mv.machine_model_id and mm.slug='lf3800'
  join catalogue.sources s on s.canonical_url='https://www.jacobsen.com/manuals/4129587_205_a.pdf'
  where mv.variant_name='LF3800 5-Gang'
)
insert into catalogue.service_tasks(machine_variant_id,task_key,task_name,instructions,confidence,source_id,source_page,status)
select variant_id,'grease_f3','Lubricate F3 grease points',
       'Lubricate F3 points every 250 hours: motor spline. Grease points are the same for all reels.',
       'high',source_id,28,'active'
from v
on conflict(machine_variant_id,task_key) do update set
  instructions=excluded.instructions,confidence=excluded.confidence,source_id=excluded.source_id,source_page=excluded.source_page,status='active';

with t as (
  select st.id task_id,s.id source_id from catalogue.service_tasks st
  join catalogue.machine_variants mv on mv.id=st.machine_variant_id and mv.variant_name='LF3800 5-Gang'
  join catalogue.sources s on s.canonical_url='https://www.jacobsen.com/manuals/4129587_205_a.pdf'
  where st.task_key='grease_f3'
)
insert into catalogue.service_schedule_rules(service_task_id,interval_engine_hours,source_id,confidence,status,schedule_type)
select task_id,250,source_id,'high','active','recurring' from t
where not exists(select 1 from catalogue.service_schedule_rules r where r.service_task_id=t.task_id and r.interval_engine_hours=250);

with v as (
  select mv.id variant_id,s.id source_id
  from catalogue.machine_variants mv
  join catalogue.machine_models mm on mm.id=mv.machine_model_id and mm.slug='lf3800'
  join catalogue.sources s on s.canonical_url='https://www.jacobsen.com/manuals/4129587_205_a.pdf'
  where mv.variant_name='LF3800 5-Gang'
)
insert into catalogue.service_tasks(machine_variant_id,task_key,task_name,instructions,confidence,source_id,source_page,status)
select variant_id,'wheel_bearings','Repack wheel bearings',
       'Remove wheels and repack bearings once a year.',
       'high',source_id,28,'active'
from v
on conflict(machine_variant_id,task_key) do update set
  instructions=excluded.instructions,confidence=excluded.confidence,source_id=excluded.source_id,source_page=excluded.source_page,status='active';

with t as (
  select st.id task_id,s.id source_id from catalogue.service_tasks st
  join catalogue.machine_variants mv on mv.id=st.machine_variant_id and mv.variant_name='LF3800 5-Gang'
  join catalogue.sources s on s.canonical_url='https://www.jacobsen.com/manuals/4129587_205_a.pdf'
  where st.task_key='wheel_bearings'
)
insert into catalogue.service_schedule_rules(service_task_id,interval_calendar_days,source_id,confidence,status,schedule_type)
select task_id,365,source_id,'high','active','calendar' from t
where not exists(select 1 from catalogue.service_schedule_rules r where r.service_task_id=t.task_id and r.interval_calendar_days=365);

commit;
