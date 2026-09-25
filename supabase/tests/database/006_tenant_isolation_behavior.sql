-- REELMOW behavioral tenant-isolation tests.
-- Two synthetic organisations are seeded, then the database is queried as
-- authenticated user A. Everything is rolled back at the end.
begin;

select extensions.plan(17);

set local role postgres;

select extensions.ok(
  exists(select 1 from pg_roles where rolname='authenticated'),
  'authenticated role exists'
);

create temporary table _reelmow_test_ids (
  user_a uuid, user_b uuid, org_a uuid, org_b uuid,
  garage_a uuid, garage_b uuid, machine_a uuid, machine_b uuid
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

insert into auth.users (
  id, aud, role, email, email_confirmed_at, created_at, updated_at,
  is_sso_user, is_anonymous
)
select user_a,'authenticated','authenticated','reelmow-test-a@example.invalid',now(),now(),now(),false,false
from _reelmow_test_ids
union all
select user_b,'authenticated','authenticated','reelmow-test-b@example.invalid',now(),now(),now(),false,false
from _reelmow_test_ids;

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

select extensions.is(auth.uid()::text,'00000000-0000-0000-0000-0000000000a1','JWT identity resolves to user A');

select extensions.is((select count(*) from garage.organizations),1::bigint,'user A sees only organisation A');
select extensions.is((select count(*) from garage.garages),1::bigint,'user A sees only garage A');
select extensions.is((select count(*) from garage.machines),1::bigint,'user A sees only machine A');
select extensions.is((select count(*) from garage.machines where id='00000000-0000-0000-0000-0000000000b4'),0::bigint,'user A cannot read machine B directly');
select extensions.is((select count(*) from garage.memberships),1::bigint,'user A sees only their own membership');
select extensions.is((select count(*) from garage.memberships where organization_id='00000000-0000-0000-0000-0000000000b2'),0::bigint,'user A cannot read organisation B membership');

select extensions.lives_ok(
  $$ update garage.machines set nickname='MUST NOT CHANGE' where id='00000000-0000-0000-0000-0000000000b4 $$,
  'cross-tenant machine update is safely filtered'
);

select extensions.is(
  (select count(*) from garage.machines where id='00000000-0000-0000-0000-0000000000b4'),
  0::bigint,
  'machine B remains invisible after attempted update'
);

select extensions.lives_ok(
  $$ delete from garage.machines where id='00000000-0000-0000-0000-0000000000b4 $$,
  'cross-tenant machine delete is safely filtered'
);

select extensions.ok(
  private.is_org_member('00000000-0000-0000-0000-0000000000a2'),
  'user A is member of organisation A'
);

select extensions.ok(
  not private.is_org_member('00000000-0000-0000-0000-0000000000b2'),
  'user A is not member of organisation B'
);

select extensions.ok(
  private.has_org_role('00000000-0000-0000-0000-0000000000a2',array['owner']::garage.member_role[]),
  'user A has owner role in organisation A'
);

select extensions.ok(
  not private.has_org_role('00000000-0000-0000-0000-0000000000b2',array['owner']::garage.member_role[]),
  'user A has no role in organisation B'
);

select extensions.throws_ok(
  $$ select garage.record_machine_hours('00000000-0000-0000-0000-0000000000b4',10,null,'test','cross tenant') $$,
  'P0001',
  'not authorised',
  'cross-tenant hours RPC is rejected'
);

select extensions.is(
  (select count(*) from garage.machine_hours_log where machine_id='00000000-0000-0000-0000-0000000000b4'),
  0::bigint,
  'cross-tenant hours record was not created'
);

select * from extensions.finish();
rollback;
