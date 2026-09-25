-- REELMOW backend acceptance test harness
-- Run private.reelmow_backend_acceptance() from a privileged database test
-- context. It intentionally has no API execution grant.
begin;

create or replace function private.reelmow_assert(condition boolean, message text)
returns void language plpgsql security invoker set search_path=''
as $$
begin
  if not coalesce(condition,false) then
    raise exception 'REELMOW TEST FAILED: %', message;
  end if;
end;
$$;

create or replace function private.reelmow_backend_acceptance()
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare r record; c boolean; result jsonb := '[]'::jsonb;
begin
  perform private.reelmow_assert((select relrowsecurity from pg_class where oid='ingestion.ai_runs'::regclass),'ai_runs RLS');
  perform private.reelmow_assert((select relforcerowsecurity from pg_class where oid='ingestion.ai_runs'::regclass),'ai_runs FORCE RLS');

  for r in select * from (values
    ('ingestion','ai_runs'),('ingestion','jobs'),('ingestion','job_documents'),
    ('ingestion','extracted_facts'),('ingestion','review_queue')
  ) v(schema_name,table_name) loop
    execute format(
      'select exists(select 1 from pg_policies where schemaname=%L and tablename=%L and roles @> ARRAY[''authenticated''::name] and qual=''false'' and with_check=''false'')',
      r.schema_name,r.table_name
    ) into c;
    perform private.reelmow_assert(c,r.schema_name||'.'||r.table_name||' deny policy');
  end loop;

  for r in select * from (values
    ('garage.create_organization(text,text)'),
    ('garage.record_machine_hours(uuid,numeric,numeric,text,text)'),
    ('garage.record_machine_service(uuid,uuid,timestamptz,numeric,numeric,text,numeric,text,jsonb)'),
    ('catalogue.search_machines(text,integer)')
  ) v(signature) loop
    execute format('select not prosecdef from pg_proc where oid=%L::regprocedure',r.signature) into c;
    perform private.reelmow_assert(c,r.signature||' invoker');
  end loop;

  for r in select * from (values
    ('private.create_organization(text,text)'),
    ('private.record_machine_hours(uuid,numeric,numeric,text,text)'),
    ('private.record_machine_service(uuid,uuid,timestamptz,numeric,numeric,text,numeric,text,jsonb)')
  ) v(signature) loop
    execute format('select not has_function_privilege(''authenticated'',%L::regprocedure,''execute'')',r.signature) into c;
    perform private.reelmow_assert(c,r.signature||' private');
  end loop;

  perform private.reelmow_assert(not has_function_privilege('anon','catalogue.search_machines(text,integer)'::regprocedure,'execute'),'anon search');
  perform private.reelmow_assert(not has_function_privilege('anon','garage.create_organization(text,text)'::regprocedure,'execute'),'anon create org');
  perform private.reelmow_assert(not exists(select 1 from catalogue.facts where (machine_model_id is not null)::int+(machine_variant_id is not null)::int<>1),'fact scope');

  return jsonb_build_object('status','PASS','timestamp',now(),'warnings',result);
end; $$;

revoke all on function private.reelmow_assert(boolean,text) from public,anon,authenticated;
revoke all on function private.reelmow_backend_acceptance() from public,anon,authenticated;

commit;
