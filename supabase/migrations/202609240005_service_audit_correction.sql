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
  values(
    target_org,(select auth.uid()),'garage.'||TG_TABLE_NAME,row_id,lower(TG_OP),
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) else null end,
    case when TG_OP in ('INSERT','UPDATE') then to_jsonb(NEW) else null end,
    jsonb_build_object('machine_id',machine_ref,'source','database_trigger')
  );
  return coalesce(NEW,OLD);
end;
$$;

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
