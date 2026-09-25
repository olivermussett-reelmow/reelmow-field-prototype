-- REELMOW backend foundation final hardening v1.1
-- Complete the public RPC boundary: API-facing wrappers are controlled
-- SECURITY DEFINER entrypoints with a pinned empty search_path. The private
-- implementations remain inaccessible to API roles and perform the actual
-- authentication and organisation-role checks.
begin;

create or replace function garage.create_organization(org_name text, org_slug text)
returns uuid language sql security definer set search_path=''
as $$ select private.create_organization(org_name,org_slug); $$;

create or replace function garage.record_machine_hours(
  target_machine uuid, new_engine_hours numeric, new_reel_hours numeric,
  reading_source text default 'manual', reading_notes text default null
)
returns uuid language sql security definer set search_path=''
as $$ select private.record_machine_hours(target_machine,new_engine_hours,new_reel_hours,reading_source,reading_notes); $$;

create or replace function garage.record_machine_service(
  target_machine uuid, target_service_task uuid, service_date timestamptz,
  service_engine_hours numeric, service_reel_hours numeric, performed_by_name text,
  service_cost numeric, service_notes text, evidence_json jsonb default '{}'::jsonb
)
returns uuid language sql security definer set search_path=''
as $$ select private.record_machine_service(target_machine,target_service_task,service_date,service_engine_hours,service_reel_hours,performed_by_name,service_cost,service_notes,evidence_json); $$;

commit;
