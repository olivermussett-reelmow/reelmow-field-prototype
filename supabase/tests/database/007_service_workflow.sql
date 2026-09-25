begin;
select extensions.plan(10);

-- Synthetic authenticated owner and Garage machine. Everything rolls back.
insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at,is_sso_user,is_anonymous)
values('00000000-0000-0000-0000-0000000000d1','authenticated','authenticated','reelmow-service-test@example.invalid',now(),now(),now(),false,false);

insert into garage.organizations(id,name,slug,created_by)
values('00000000-0000-0000-0000-0000000000d2','Service Test Org','reelmow-service-test','00000000-0000-0000-0000-0000000000d1');
insert into garage.memberships(organization_id,user_id,role)
values('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000d1','owner');
insert into garage.garages(id,organization_id,name)
values('00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-0000000000d2','Service Test Garage');
insert into garage.machines(id,garage_id,machine_variant_id,nickname,created_by,current_engine_hours)
values(
 '00000000-0000-0000-0000-0000000000d4',
 '00000000-0000-0000-0000-0000000000d3',
 (select mv.id from catalogue.machine_variants mv join catalogue.machine_models mm on mm.id=mv.machine_model_id where mm.slug='lf3800' and mv.variant_name='LF3800 5-Gang'),
 'Service Test Machine',
 '00000000-0000-0000-0000-0000000000d1',
 49
);

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',true);
select set_config('request.jwt.claim.role','authenticated',true);

select extensions.ok(
  exists(select 1 from garage.machine_service_due
    where machine_id='00000000-0000-0000-0000-0000000000d4'
      and task_key='engine_oil_change'
      and hours_remaining=1
      and service_status='upcoming'),
  'initial 50-hour service is one hour away'
);

select extensions.ok(
  garage.record_machine_hours(
    '00000000-0000-0000-0000-0000000000d4',50,null,'test','reach initial service'
  ) is not null,
  'hours RPC records a legitimate reading'
);

select extensions.ok(
  exists(select 1 from garage.machine_service_due
    where machine_id='00000000-0000-0000-0000-0000000000d4'
      and task_key='engine_oil_change'
      and hours_remaining=0
      and service_status='due'),
  'initial 50-hour service becomes due at threshold'
);

select extensions.ok(
  (select current_engine_hours from garage.machines where id='00000000-0000-0000-0000-0000000000d4')=50,
  'machine current engine hours are updated'
);

select extensions.ok(
  (select count(*) from garage.machine_hours_log where machine_id='00000000-0000-0000-0000-0000000000d4')=1,
  'hours history contains the reading'
);

select extensions.ok(
  (select garage.record_machine_service(
    '00000000-0000-0000-0000-0000000000d4',
    (select st.id from catalogue.service_tasks st join catalogue.machine_variants mv on mv.id=st.machine_variant_id join catalogue.machine_models mm on mm.id=mv.machine_model_id where mm.slug='lf3800' and mv.variant_name='LF3800 5-Gang' and st.task_key='engine_oil_change'),
    now(),50,null,'REELMOW test',0,'initial service','{}'::jsonb
  )) is not null,
  'service RPC records the matching active task'
);

select extensions.ok(
  exists(select 1 from garage.machine_service_due
    where machine_id='00000000-0000-0000-0000-0000000000d4'
      and task_key='engine_oil_change'
      and hours_remaining=100
      and service_status='upcoming'),
  'recurring interval restarts from the latest service'
);

select extensions.ok(
  (select count(*) from garage.machine_service_records where machine_id='00000000-0000-0000-0000-0000000000d4')=1,
  'service history contains one service'
);

select extensions.ok(
  (select current_engine_hours from garage.machines where id='00000000-0000-0000-0000-0000000000d4')=50,
  'service does not reduce current engine hours'
);

select extensions.ok(
  not exists(select 1 from garage.machine_service_records
    where machine_id='00000000-0000-0000-0000-0000000000d4' and service_task_id is null),
  'service history always retains a service task'
);

select * from extensions.finish();
rollback;