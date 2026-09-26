begin;

-- Garage V1 acceptance harness.
-- This replaces the original foundation-era assumptions about invoker RPCs
-- with the current controlled SECURITY DEFINER API model.

create or replace function private.reelmow_backend_acceptance()
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  r record;
  c boolean;
  result jsonb := '[]'::jsonb;
begin
  for r in select * from (values
    ('garage','organizations'),
    ('garage','garages'),
    ('garage','memberships'),
    ('garage','machines'),
    ('garage','machine_hours_log'),
    ('garage','machine_service_records'),
    ('garage','machine_faults'),
    ('garage','machine_photos'),
    ('garage','machine_documents'),
    ('garage','sync_operations')
  ) v(schema_name,table_name) loop
    execute format(
      'select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=%L and c.relname=%L',
      r.schema_name,r.table_name
    ) into c;
    perform private.reelmow_assert(c,r.schema_name||'.'||r.table_name||' RLS');
  end loop;

  for r in select * from (values
    ('garage.create_organization(text,text)'),
    ('garage.record_machine_hours(uuid,numeric,numeric,text,text)'),
    ('garage.record_machine_service(uuid,uuid,timestamptz,numeric,numeric,text,numeric,text,jsonb)'),
    ('garage.create_machine(uuid,uuid,uuid,text,text,text,date,numeric,date,date,text,text,text,text,numeric,numeric,text,text,text,text,bigint,jsonb)'),
    ('garage.update_machine_profile(uuid,text,text,text,date,numeric,text,text,date,date,text,text)'),
    ('garage.sync_record_machine_hours(uuid,uuid,numeric,numeric,text,text)'),
    ('garage.sync_record_machine_service(uuid,uuid,uuid,timestamptz,numeric,numeric,text,numeric,text,jsonb)'),
    ('garage.sync_report_machine_fault(uuid,uuid,text,text)'),
    ('garage.transition_machine_status(uuid,garage.machine_status,text)'),
    ('garage.acknowledge_machine_fault(uuid,text)'),
    ('garage.resolve_machine_fault(uuid,text)')
  ) v(signature) loop
    execute format('select prosecdef and coalesce(array_to_string(proconfig,'',''),'''') like ''%%search_path=""%%'' from pg_proc where oid=%L::regprocedure',r.signature) into c;
    perform private.reelmow_assert(c,r.signature||' controlled definer wrapper');
    execute format('select has_function_privilege(''authenticated'',%L::regprocedure,''execute'')',r.signature) into c;
    perform private.reelmow_assert(c,r.signature||' authenticated execute');
    execute format('select not has_function_privilege(''anon'',%L::regprocedure,''execute'')',r.signature) into c;
    perform private.reelmow_assert(c,r.signature||' anon denied');
  end loop;

  perform private.reelmow_assert(
    (select not prosecdef from pg_proc where oid='catalogue.match_machine_identification(text,text,text,text,text,text,integer)'::regprocedure),
    'catalogue matcher invoker'
  );
  perform private.reelmow_assert(
    has_function_privilege('authenticated','catalogue.match_machine_identification(text,text,text,text,text,text,integer)'::regprocedure,'execute'),
    'catalogue matcher authenticated execute'
  );
  perform private.reelmow_assert(
    not has_function_privilege('anon','catalogue.match_machine_identification(text,text,text,text,text,text,integer)'::regprocedure,'execute'),
    'catalogue matcher anon denied'
  );

  perform private.reelmow_assert(
    (select exists(select 1 from storage.buckets where id='reelmow-garage-private' and public=false)),
    'private evidence bucket'
  );
  perform private.reelmow_assert(
    (select exists(
      select 1 from pg_policies
      where schemaname='storage' and tablename='objects'
        and policyname='garage object insert'
        and with_check::text like '%storage.foldername(objects.name)%'
    )),
    'evidence insert policy uses object path'
  );

  perform private.reelmow_assert(
    (select count(*)=0 from garage.sync_operations),
    'sync operation queue empty'
  );

  return jsonb_build_object('status','PASS','timestamp',now(),'warnings',result);
end;
$$;

revoke all on function private.reelmow_backend_acceptance() from public,anon,authenticated;

commit;
