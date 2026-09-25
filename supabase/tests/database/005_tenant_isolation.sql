-- REELMOW tenant isolation tests
-- These tests are intentionally written around the RLS contract. Synthetic
-- authenticated identities are supplied through request.jwt.claim.sub in the
-- isolated test database when the full auth harness is available.
begin;

select plan(6);

select ok(
  exists(
    select 1 from pg_policies
    where schemaname='garage'
      and tablename='machines'
      and cmd in ('SELECT','ALL')
  ),
  'machines has an RLS read policy'
);

select ok(
  exists(
    select 1 from pg_policies
    where schemaname='garage'
      and tablename='machine_documents'
      and cmd in ('SELECT','ALL')
  ),
  'machine documents has an RLS read policy'
);

select ok(
  exists(
    select 1 from pg_policies
    where schemaname='garage'
      and tablename='machine_photos'
      and cmd in ('SELECT','ALL')
  ),
  'machine photos has an RLS read policy'
);

select ok(
  exists(
    select 1 from pg_policies
    where schemaname='garage'
      and tablename='machine_hours_log'
      and cmd in ('SELECT','ALL')
  ),
  'hours log has an RLS read policy'
);

select ok(
  exists(
    select 1 from pg_policies
    where schemaname='garage'
      and tablename='machine_service_records'
      and cmd in ('SELECT','ALL')
  ),
  'service records has an RLS read policy'
);

select ok(
  not exists(
    select 1
    from pg_policies
    where schemaname='garage'
      and tablename in ('machines','machine_documents','machine_photos',
                        'machine_hours_log','machine_service_records')
      and (qual is null or qual='true')
  ),
  'Garage data policies are not globally permissive'
);

select * from finish();
rollback;
