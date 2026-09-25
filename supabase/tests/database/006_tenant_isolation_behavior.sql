-- REELMOW behavioral tenant-isolation tests.
-- Seed two synthetic organisations, then execute as authenticated user A.
-- All seed rows are rolled back at the end; no production data is used.
begin;

select plan(16);

set local role postgres;

select extensions.ok(
  exists(select 1 from pg_roles where rolname='authenticated'),
  'authenticated role exists'
);

create temporary table _reelmow_test_ids (
  user_a uuid,
  user_b uuid,
  org_a uuid,
  org_b uuid,
  garage_a uuid,
  garage_b uuid,
  machine_a uuid,
  machine_b uuid
) on commit drop;

insert into _reelmow_test_ids values (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-0000000000a2',
  '00000000-0000-0000-0000-0000000000b2',
  '00000000-0000-0000-0000-0000000000a3',
  '00000000-0000-0000-0000-0000000000b3',
  '00000000-0000-0000-0000-0000000000a4',
  '00000000-0000-0000-0000-0000000000b4'
);

insert into garage.organizations(id,name,slug,created_by)
select org_a,'REELMOW TEST A','reelmow-test-a',user_a from _reelmow_test_ids
union all
select org_b,'REELMOW TEST B','reelmow-test-b',user_b from _reelmow_test_ids;

insert into garage.memberships(organization_id,user_id,role)
select org_a,user_a,'owner'::garage.member_role from _reelmow_test_ids
union all
select org_b,user_b,'owner'::garage.member_role from _reelmow_test_ids;

insert into garage.garages(id,organization_id,name)
select garage_a,org_a,'Test Garage A' from _reelmow_test_ids
union all
select garage_b,org_b,'Test Garage B' from _reelmow_test_ids;

insert into garage.machines(id,garage_id,nickname,created_by)
select machine_a,garage_a,'Machine A',user_a from _reelmow_test_ids
union all
select machine_b,garage_b,'Machine B',user_b from _reelmow_test_ids;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
select set_config('request.jwt.claim.role','authenticated',true);

select is(auth.uid()::text,'00000000-0000-0000-0000-0000000000a1','JWT identity resolves to user A');

select is(
  (select count(*) from garage.organizations),
  1::bigint,
  'user A sees only organisation A'
);

select is(
  (select count(*) from garage.garages),
  1::bigint,
  'user A sees only garage A'
);

select is(
  (select count(*) from garage.machines),
  1::bigint,
  'user A sees only machine A'
);

select is(
  (select count(*) from garage.machines where id='00000000-0000-0000-0000-0000000000b4'),
  0::bigint,
  'user A cannot read machine B directly'
);

select is(
  (select count(*) from garage.memberships),
  1::bigint,
  'user A sees only their own membership'
);

select is(
  (select count(*) from garage.memberships where organization_id='00000000-0000-0000-0000-0000000000b2'),
  0::bigint,
  'user A cannot read organisation B membership'
);

select lives_ok(
  $$ update garage.machines
     set nickname='MUST NOT CHANGE'
     where id='00000000-0000-0000-0000-0000000000b4' $$,
  'cross-tenant machine update is rejected or safely filtered'
);

select is(
  (select nickname from garage.machines where id='00000000-0000-0000-0000-0000000000b4'),
  null::text,
  'machine B remains invisible after attempted update'
);

select lives_ok(
  $$ delete from garage.machines
     where id='00000000-0000-0000-0000-0000000000b4' $$,
  'cross-tenant machine delete is rejected or safely filtered'
);

select ok(
  private.is_org_member('00000000-0000-0000-0000-0000000000a2'),
  'user A is member of organisation A'
);

select ok(
  not private.is_org_member('00000000-0000-0000-0000-0000000000b2'),
  'user A is not member of organisation B'
);

select ok(
  private.has_org_role('00000000-0000-0000-0000-0000000000a2',
    array['owner']::garage.member_role[]),
  'user A has owner role in organisation A'
);

select ok(
  not private.has_org_role('00000000-0000-0000-0000-0000000000b2',
    array['owner']::garage.member_role[]),
  'user A has no role in organisation B'
);

select lives_ok(
  $$ select garage.record_machine_hours(
       '00000000-0000-0000-0000-0000000000b4',
       10, null, 'test', 'cross tenant'
     ) $$,
  'cross-tenant hours call is safely rejected without database corruption'
);

select is(
  (select count(*) from garage.machine_hours_log
   where machine_id='00000000-0000-0000-0000-0000000000b4'),
  0::bigint,
  'cross-tenant hours record was not created'
);

select * from finish();
rollback;
