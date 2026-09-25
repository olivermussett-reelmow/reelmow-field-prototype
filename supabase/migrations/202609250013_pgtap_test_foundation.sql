-- REELMOW pgTAP-ready backend test foundation
begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to postgres;
grant execute on all functions in schema extensions to postgres;

create schema if not exists tests;

create or replace function tests.reelmow_core_structure()
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare failures int:=0; total int:=0; v boolean;
begin
  total:=total+1; select exists(select 1 from pg_namespace where nspname='catalogue') into v; if not v then failures:=failures+1; end if;
  total:=total+1; select exists(select 1 from pg_namespace where nspname='garage') into v; if not v then failures:=failures+1; end if;
  total:=total+1; select exists(select 1 from pg_namespace where nspname='ingestion') into v; if not v then failures:=failures+1; end if;
  total:=total+1; select to_regclass('catalogue.manufacturers') is not null into v; if not v then failures:=failures+1; end if;
  total:=total+1; select to_regclass('catalogue.machine_models') is not null into v; if not v then failures:=failures+1; end if;
  total:=total+1; select to_regclass('catalogue.machine_variants') is not null into v; if not v then failures:=failures+1; end if;
  total:=total+1; select to_regclass('catalogue.facts') is not null into v; if not v then failures:=failures+1; end if;
  total:=total+1; select to_regclass('garage.organizations') is not null into v; if not v then failures:=failures+1; end if;
  total:=total+1; select to_regclass('garage.machines') is not null into v; if not v then failures:=failures+1; end if;
  total:=total+1; select to_regclass('garage.machine_hours_log') is not null into v; if not v then failures:=failures+1; end if;
  total:=total+1; select to_regclass('garage.machine_service_records') is not null into v; if not v then failures:=failures+1; end if;
  total:=total+1; select to_regclass('garage.machine_documents') is not null into v; if not v then failures:=failures+1; end if;
  total:=total+1; select to_regclass('garage.machine_photos') is not null into v; if not v then failures:=failures+1; end if;
  total:=total+1; select exists(select 1 from information_schema.columns where table_schema='garage' and table_name='machines' and column_name='garage_id') into v; if not v then failures:=failures+1; end if;
  total:=total+1; select exists(select 1 from information_schema.columns where table_schema='garage' and table_name='machines' and column_name='machine_variant_id') into v; if not v then failures:=failures+1; end if;
  total:=total+1; select exists(select 1 from information_schema.columns where table_schema='garage' and table_name='machines' and column_name='current_engine_hours') into v; if not v then failures:=failures+1; end if;
  total:=total+1; select exists(select 1 from information_schema.columns where table_schema='garage' and table_name='machines' and column_name='current_reel_hours') into v; if not v then failures:=failures+1; end if;
  total:=total+1; select exists(select 1 from pg_constraint where conrelid='garage.machines'::regclass and contype='p') into v; if not v then failures:=failures+1; end if;
  total:=total+1; select exists(select 1 from pg_constraint where conrelid='catalogue.machine_variants'::regclass and contype='p') into v; if not v then failures:=failures+1; end if;
  total:=total+1; select exists(select 1 from pg_constraint where conrelid='catalogue.facts'::regclass and contype='p') into v; if not v then failures:=failures+1; end if;
  return jsonb_build_object('status',case when failures=0 then 'PASS' else 'FAIL' end,'tests',total,'failures',failures,'timestamp',now());
end; $$;

revoke all on function tests.reelmow_core_structure() from public,anon,authenticated;

commit;
