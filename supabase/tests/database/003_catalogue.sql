begin;
select extensions.plan(11);
select extensions.ok(exists(select 1 from catalogue.manufacturers where slug='protea'),'Protea seeded');
select extensions.ok(exists(select 1 from catalogue.machine_models where model_code='SC610'),'SC610 seeded');
select extensions.ok(exists(select 1 from catalogue.machine_variants where variant_code='SC610-24'),'Protea SC610 variant seeded');
select extensions.ok(exists(select 1 from catalogue.manufacturers where slug='allett'),'Allett seeded');
select extensions.ok(exists(select 1 from catalogue.machine_variants where variant_code='SHAVER-24'),'Shaver 24 seeded');
select extensions.ok(exists(select 1 from catalogue.manufacturers where slug='atco'),'ATCO seeded');
select extensions.ok((select count(*) from catalogue.machine_variants where variant_code in ('F016310142','F016310542'))=2,'both Royale 24 variants seeded');
select extensions.ok(exists(select 1 from catalogue.search_machines('Protea',12)),'Protea search works');
select extensions.ok(exists(select 1 from catalogue.search_machines('Shaver 24',12)),'Shaver search works');
select extensions.ok((select count(*) from catalogue.search_machines('Royale 24',12))=2,'Royale search returns both variants');
select extensions.ok(
  exists(
    select 1 from catalogue.facts f
    join catalogue.spec_definitions sd on sd.id=f.spec_definition_id
    where f.machine_variant_id='019b888f-5fb5-40ed-a0c8-f999e6bc433e'
      and sd.key='reel_blades'
      and f.value_text='12'
      and f.value_number is null
  ),
  'SC610 reel blade count uses canonical text type'
);
select * from extensions.finish();
rollback;