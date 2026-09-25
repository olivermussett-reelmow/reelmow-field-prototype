-- REELMOW catalogue contract tests
begin;

select plan(10);

select ok(exists(select 1 from catalogue.manufacturers where slug='protea'),'Protea seeded');
select ok(exists(select 1 from catalogue.machine_models where model_code='SC610'),'SC610 seeded');
select ok(exists(select 1 from catalogue.machine_variants where variant_code='SC610-24'),'Protea SC610 variant seeded');

select ok(exists(select 1 from catalogue.manufacturers where slug='allett'),'Allett seeded');
select ok(exists(select 1 from catalogue.machine_variants where variant_code='SHAVER-24'),'Shaver 24 seeded');

select ok(exists(select 1 from catalogue.manufacturers where slug='atco'),'ATCO seeded');
select ok(
  (select count(*) from catalogue.machine_variants where variant_code in ('F016310142','F016310542'))=2,
  'both Royale 24 variants seeded'
);

select ok(
  exists(select 1 from catalogue.search_machines('Protea',12)),
  'Protea search works'
);

select ok(
  exists(select 1 from catalogue.search_machines('Shaver 24',12)),
  'Shaver search works'
);

select ok(
  (select count(*) from catalogue.search_machines('Royale 24',12))=2,
  'Royale search returns both variants'
);

select * from finish();
rollback;
