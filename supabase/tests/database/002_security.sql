-- REELMOW security contract tests
begin;

select plan(12);

select ok(
  not exists(select 1 from pg_proc where pronamespace='garage'::regnamespace and prosecdef),
  'customer Garage RPCs are SECURITY INVOKER'
);

select ok(
  not exists(
    select 1 from pg_proc
    where pronamespace='catalogue'::regnamespace
      and proname='search_machines'
      and prosecdef
  ),
  'catalogue search is SECURITY INVOKER'
);

select ok(
  not exists(
    select 1 from pg_proc
    where pronamespace='private'::regnamespace
      and proname in ('create_organization','record_machine_hours','record_machine_service')
      and has_function_privilege('authenticated',oid,'execute')
  ),
  'private write implementations are not callable by authenticated users'
);

select ok(
  not has_function_privilege(
    'anon',
    'catalogue.search_machines(text,integer)'::regprocedure,
    'execute'
  ),
  'anonymous users cannot execute catalogue search'
);

select ok(
  not has_function_privilege(
    'anon',
    'garage.create_organization(text,text)'::regprocedure,
    'execute'
  ),
  'anonymous users cannot create organisations'
);

select ok(
  exists(select 1 from pg_class where oid='ingestion.ai_runs'::regclass and relrowsecurity),
  'AI runs RLS enabled'
);

select ok(
  exists(select 1 from pg_class where oid='ingestion.ai_runs'::regclass and relforcerowsecurity),
  'AI runs FORCE RLS enabled'
);

select ok(
  not exists(
    select 1 from pg_class
    where relnamespace='garage'::regnamespace
      and relkind='r'
      and not relrowsecurity
  ),
  'all Garage base tables have RLS'
);

select ok(
  not exists(
    select 1 from pg_policies
    where schemaname='ingestion'
      and roles @> array['authenticated'::name]
      and (qual <> 'false' or with_check <> 'false')
  ),
  'ingestion remains deny-by-default'
);

select ok(
  not exists(
    select 1 from catalogue.facts
    where ((machine_model_id is null)::int+(machine_variant_id is null)::int)<>1
  ),
  'catalogue fact scope integrity'
);

select ok(
  not exists(
    select 1 from catalogue.facts
    where (value_text is not null)::int+
          (value_number is not null)::int+
          (value_boolean is not null)::int+
          (value_json is not null)::int <> 1
  ),
  'catalogue fact value integrity'
);

select ok(
  exists(select 1 from pg_extension where extname='pgtap'),
  'pgTAP is installed'
);

select * from finish();
rollback;
