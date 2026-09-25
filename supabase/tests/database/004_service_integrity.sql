-- REELMOW service integrity tests
begin;

select plan(8);

select ok(
  not exists(
    select 1
    from catalogue.service_schedule_rules r
    left join catalogue.service_tasks t on t.id=r.service_task_id
    where t.id is null
  ),
  'service schedule rules have valid service tasks'
);

select ok(
  not exists(
    select 1
    from catalogue.part_fitments f
    left join catalogue.machine_variants v on v.id=f.machine_variant_id
    where v.id is null
  ),
  'part fitments have valid variants'
);

select ok(
  not exists(
    select 1
    from garage.machine_service_records s
    where s.cost < 0
  ),
  'service costs are non-negative'
);

select ok(
  not exists(
    select 1
    from garage.machine_hours_log h
    where coalesce(h.engine_hours,0) < 0 or coalesce(h.reel_hours,0) < 0
  ),
  'stored hours are non-negative'
);

select ok(
  not exists(
    select 1
    from garage.machine_service_records s
    left join garage.machines m on m.id=s.machine_id
    where m.id is null
  ),
  'service records have valid machines'
);

select ok(
  not exists(
    select 1
    from garage.machine_hours_log h
    left join garage.machines m on m.id=h.machine_id
    where m.id is null
  ),
  'hours records have valid machines'
);

select ok(
  not exists(
    select 1
    from garage.machine_documents d
    left join garage.machines m on m.id=d.machine_id
    where m.id is null
  ),
  'machine documents have valid machines'
);

select ok(
  not exists(
    select 1
    from garage.machine_photos p
    left join garage.machines m on m.id=p.machine_id
    where m.id is null
  ),
  'machine photos have valid machines'
);

select * from finish();
rollback;
