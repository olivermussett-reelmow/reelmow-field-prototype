-- REELMOW backend contract tests
-- Run with the Supabase CLI against an isolated local database.
begin;

select plan(18);

select has_schema('catalogue','catalogue schema');
select has_schema('garage','garage schema');
select has_schema('ingestion','ingestion schema');

select has_table('catalogue','manufacturers','manufacturers table');
select has_table('catalogue','machine_models','machine models table');
select has_table('catalogue','machine_variants','machine variants table');
select has_table('catalogue','facts','facts table');

select has_table('garage','organizations','organizations table');
select has_table('garage','memberships','memberships table');
select has_table('garage','machines','machines table');
select has_table('garage','machine_hours_log','hours table');
select has_table('garage','machine_service_records','service table');

select has_table('garage','machine_documents','documents table');
select has_table('garage','machine_photos','photos table');

select col_is_pk('garage','machines','id','machines primary key');
select col_is_pk('catalogue','machine_variants','id','variants primary key');

select ok(
  not exists (
    select 1 from catalogue.facts
    where ((machine_model_id is null)::int + (machine_variant_id is null)::int) <> 1
  ),
  'every catalogue fact has exactly one model/variant scope'
);

select ok(
  not exists (
    select 1 from pg_policies
    where schemaname='ingestion'
      and roles @> array['authenticated'::name]
      and (qual <> 'false' or with_check <> 'false')
  ),
  'authenticated users have no ingestion-table access'
);

select * from finish();
rollback;
