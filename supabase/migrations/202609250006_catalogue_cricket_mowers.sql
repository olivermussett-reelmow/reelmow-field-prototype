-- REELMOW catalogue expansion: cricket / fine-turf machines
-- Adds the three additional machines used by the REELMOW prototype test garage.
-- Variant-scoped facts intentionally populate only machine_variant_id because facts_scope_exactly_one requires exactly one scope.
-- Canonical identity is seeded conservatively; exact physical variant/serial remains a user confirmation step.

-- ---------- shared specification definitions ----------
insert into catalogue.spec_definitions(key,label,value_type,default_unit) values
('working_width','Working width','number','mm'),
('engine_power','Engine power','number','kW'),
('engine_displacement','Engine displacement','number','cc'),
('engine_speed','Engine speed','number','rpm'),
('fuel_tank_capacity','Fuel tank capacity','number','L'),
('weight','Machine weight','number','kg'),
('clip_rate','Clip rate','number','clips/m'),
('grassbox_capacity','Grassbox capacity','number','L'),
('overall_width','Overall width','number','mm')
on conflict(key) do nothing;

-- ============================================================
-- PROTEA SC610 SUPERcut 24"
-- ============================================================
insert into catalogue.manufacturers(name,slug,website_url,country_code)
values('Protea','protea','https://proteamachines.com','ZA')
on conflict(slug) do update set website_url=excluded.website_url;

insert into catalogue.product_families(manufacturer_id,name,slug,machine_type)
select id,'SC Supercut Precision Cylinder Mower Range','sc-supercut','Cylinder Mower'
from catalogue.manufacturers where slug='protea'
on conflict(manufacturer_id,slug) do nothing;

insert into catalogue.machine_models(manufacturer_id,product_family_id,model_name,model_code,slug,description)
select m.id,pf.id,'SC610 Supercut','SC610','sc610-supercut',
       '24-inch Supercut precision cylinder mower for fine turf and sports surfaces.'
from catalogue.manufacturers m
join catalogue.product_families pf on pf.manufacturer_id=m.id and pf.slug='sc-supercut'
where m.slug='protea'
on conflict(manufacturer_id,slug) do nothing;

insert into catalogue.machine_variants(machine_model_id,variant_name,variant_code,confidence,status)
select id,'SC610 24-inch','SC610-24','verified','active'
from catalogue.machine_models where slug='sc610-supercut'
on conflict(machine_model_id,variant_name) do nothing;

insert into catalogue.sources(manufacturer_id,source_kind,title,canonical_url,publisher,is_primary)
select id,'technical_spec','Protea SC610 / SC510 Product Catalogue',
       'https://proteamachines.com/wp-content/uploads/Protea-Turf-Catalog-Master-v1.0.pdf',
       'Protea Machines',true
from catalogue.manufacturers where slug='protea'
on conflict do nothing;

insert into catalogue.sources(manufacturer_id,source_kind,title,canonical_url,publisher,is_primary)
select id,'operator_manual','Protea Supercut SC Manual',
       'https://proteamachines.com/wp-content/uploads/HD.SC-Manual-2021-WEB.pdf',
       'Protea Machines',true
from catalogue.manufacturers where slug='protea'
on conflict do nothing;

with refs as (
  select mm.id model_id,mv.id variant_id
  from catalogue.machine_models mm
  join catalogue.machine_variants mv on mv.machine_model_id=mm.id and mv.variant_name='SC610 24-inch'
  where mm.slug='sc610-supercut'
), vals(key,value_number,unit,confidence) as (
  values
    ('working_width',609.6,'mm','verified'::catalogue.confidence_level),
    ('reel_blades',12,null,'verified'::catalogue.confidence_level)
)
insert into catalogue.facts(machine_variant_id,spec_definition_id,value_number,unit,confidence,status)
select refs.variant_id,sd.id,vals.value_number,vals.unit,vals.confidence,'active'
from refs cross join vals join catalogue.spec_definitions sd on sd.key=vals.key
on conflict do nothing;

insert into catalogue.facts(machine_variant_id,spec_definition_id,value_number,unit,confidence,status)
select mm.id,mv.id,sd.id,2.5,'mm','verified','active'
from catalogue.machine_models mm
join catalogue.machine_variants mv on mv.machine_model_id=mm.id and mv.variant_name='SC610 24-inch'
join catalogue.spec_definitions sd on sd.key='height_of_cut_min'
where mm.slug='sc610-supercut'
on conflict do nothing;

insert into catalogue.facts(machine_variant_id,spec_definition_id,value_text,confidence,status)
select mm.id,mv.id,sd.id,'5HP/6HP','verified','active'
from catalogue.machine_models mm
join catalogue.machine_variants mv on mv.machine_model_id=mm.id and mv.variant_name='SC610 24-inch'
join catalogue.spec_definitions sd on sd.key='engine'
where mm.slug='sc610-supercut'
on conflict do nothing;

insert into catalogue.fact_sources(fact_id,source_id,source_locator)
select f.id,s.id,'catalogue:SC610 specification'
from catalogue.facts f
join catalogue.machine_variants mv on mv.id=f.machine_variant_id and mv.variant_name='SC610 24-inch'
join catalogue.sources s on s.canonical_url='https://proteamachines.com/wp-content/uploads/Protea-Turf-Catalog-Master-v1.0.pdf'
join catalogue.machine_models mm on mm.id=mv.machine_model_id and mm.slug='sc610-supercut'
where not exists(select 1 from catalogue.fact_sources fs where fs.fact_id=f.id and fs.source_id=s.id);

-- ============================================================
-- ALLETT SHAVER 24
-- ============================================================
insert into catalogue.manufacturers(name,slug,website_url)
values('Allett','allett','https://allett.co.uk')
on conflict(slug) do update set website_url=excluded.website_url;

insert into catalogue.product_families(manufacturer_id,name,slug,machine_type)
select id,'Shaver Sports Pro','shaver','Cylinder Mower'
from catalogue.manufacturers where slug='allett'
on conflict(manufacturer_id,slug) do nothing;

insert into catalogue.machine_models(manufacturer_id,product_family_id,model_name,model_code,slug,description)
select m.id,pf.id,'Shaver','SHAVER','shaver',
       'Sports Pro fine-turf precision cylinder mower.'
from catalogue.manufacturers m
join catalogue.product_families pf on pf.manufacturer_id=m.id and pf.slug='shaver'
where m.slug='allett'
on conflict(manufacturer_id,slug) do nothing;

insert into catalogue.machine_variants(machine_model_id,variant_name,variant_code,confidence,status)
select id,'Shaver 24','SHAVER-24','verified','active'
from catalogue.machine_models where slug='shaver'
on conflict(machine_model_id,variant_name) do nothing;

insert into catalogue.sources(manufacturer_id,source_kind,title,canonical_url,publisher,is_primary)
select id,'manufacturer_page','Allett Shaver Sports Pro',
       'https://allett.co.uk/pages/shaver','Allett',true
from catalogue.manufacturers where slug='allett'
on conflict do nothing;

with refs as (
  select mm.id model_id,mv.id variant_id
  from catalogue.machine_models mm
  join catalogue.machine_variants mv on mv.machine_model_id=mm.id and mv.variant_name='Shaver 24'
  where mm.slug='shaver'
), vals(key,value_number,unit) as (
  values
    ('working_width',610,'mm'),
    ('reel_diameter',120,'mm'),
    ('height_of_cut_min',2.4,'mm'),
    ('height_of_cut_max',19,'mm'),
    ('clip_rate',217,'clips/m'),
    ('weight',91.5,'kg'),
    ('overall_width',788,'mm')
)
insert into catalogue.facts(machine_variant_id,spec_definition_id,value_number,unit,confidence,status)
select refs.variant_id,sd.id,vals.value_number,vals.unit,'verified','active'
from refs cross join vals join catalogue.spec_definitions sd on sd.key=vals.key
on conflict do nothing;

insert into catalogue.facts(machine_variant_id,spec_definition_id,value_number,unit,confidence,status)
select mm.id,mv.id,sd.id,3.6,'kW','verified','active'
from catalogue.machine_models mm
join catalogue.machine_variants mv on mv.machine_model_id=mm.id and mv.variant_name='Shaver 24'
join catalogue.spec_definitions sd on sd.key='engine_power'
where mm.slug='shaver'
on conflict do nothing;

insert into catalogue.facts(machine_variant_id,spec_definition_id,value_text,confidence,status)
select mm.id,mv.id,sd.id,'Honda GX160','verified','active'
from catalogue.machine_models mm
join catalogue.machine_variants mv on mv.machine_model_id=mm.id and mv.variant_name='Shaver 24'
join catalogue.spec_definitions sd on sd.key='engine'
where mm.slug='shaver'
on conflict do nothing;

insert into catalogue.facts(machine_variant_id,spec_definition_id,value_text,confidence,status)
select mm.id,mv.id,sd.id,'10','verified','active'
from catalogue.machine_models mm
join catalogue.machine_variants mv on mv.machine_model_id=mm.id and mv.variant_name='Shaver 24'
join catalogue.spec_definitions sd on sd.key='reel_blades'
where mm.slug='shaver'
on conflict do nothing;

insert into catalogue.facts(machine_variant_id,spec_definition_id,value_text,confidence,status)
select mm.id,mv.id,sd.id,'Petrol','verified','active'
from catalogue.machine_models mm
join catalogue.machine_variants mv on mv.machine_model_id=mm.id and mv.variant_name='Shaver 24'
join catalogue.spec_definitions sd on sd.key='fuel'
where mm.slug='shaver'
on conflict do nothing;

insert into catalogue.fact_sources(fact_id,source_id,source_locator)
select f.id,s.id,'manufacturer-page:Shaver 24'
from catalogue.facts f
join catalogue.machine_variants mv on mv.id=f.machine_variant_id and mv.variant_name='Shaver 24'
join catalogue.sources s on s.canonical_url='https://allett.co.uk/pages/shaver'
join catalogue.machine_models mm on mm.id=mv.machine_model_id and mm.slug='shaver'
where not exists(select 1 from catalogue.fact_sources fs where fs.fact_id=f.id and fs.source_id=s.id);

-- ============================================================
-- ATCO ROYALE 24
-- ============================================================
insert into catalogue.manufacturers(name,slug,website_url)
values('Atco','atco','https://www.atco.co.uk')
on conflict(slug) do update set website_url=excluded.website_url;

insert into catalogue.product_families(manufacturer_id,name,slug,machine_type)
select id,'Royale Series','royale','Cylinder Mower'
from catalogue.manufacturers where slug='atco'
on conflict(manufacturer_id,slug) do nothing;

insert into catalogue.machine_models(manufacturer_id,product_family_id,model_name,model_code,slug,description)
select m.id,pf.id,'Royale 24','F016310142','royale-24',
       'Atco Royale 24 cylinder mower. Exact physical specification should be confirmed from the machine rating plate.'
from catalogue.manufacturers m
join catalogue.product_families pf on pf.manufacturer_id=m.id and pf.slug='royale'
where m.slug='atco'
on conflict(manufacturer_id,slug) do nothing;

insert into catalogue.machine_variants(machine_model_id,variant_name,variant_code,confidence,status)
select id,'Royale 24 - F016310142','F016310142','provisional','active'
from catalogue.machine_models where slug='royale-24'
on conflict(machine_model_id,variant_name) do nothing;

insert into catalogue.machine_variants(machine_model_id,variant_name,variant_code,confidence,status)
select id,'Royale 24 I/C - F016310542','F016310542','provisional','active'
from catalogue.machine_models where slug='royale-24'
on conflict(machine_model_id,variant_name) do nothing;

insert into catalogue.sources(manufacturer_id,source_kind,title,canonical_url,publisher,is_primary)
select id,'operator_manual','ATCO Club/Royale Operating Instructions',
       'https://manualsnet.com/atco/royale-24e','ATCO / Bosch','false'
from catalogue.manufacturers where slug='atco'
on conflict do nothing;

insert into catalogue.sources(manufacturer_id,source_kind,title,canonical_url,publisher,is_primary)
select id,'parts_diagram','ATCO Royale 24 parts reference - F016310142',
       'https://www.gardenhirespares.co.uk/menu-parts-diagrams/atco-parts-diagrams/atco-cylinder-mower-parts-diagrams/atco-petrol-cylinder-mower-parts-diagrams/royale-series/royale-24-series/atco-royale-24-f016310142.html',
       'Garden Hire Spares','false'
from catalogue.manufacturers where slug='atco'
on conflict do nothing;

-- These specifications are tied only to the documented 24E I/C variant.
-- They remain provisional because the user's physical machine has not yet been
-- matched to a serial/rating plate.
with refs as (
  select mm.id model_id,mv.id variant_id
  from catalogue.machine_models mm
  join catalogue.machine_variants mv on mv.machine_model_id=mm.id and mv.variant_code='F016310542'
  where mm.slug='royale-24'
), vals(key,value_number,unit) as (
  values
    ('working_width',610,'mm'),
    ('engine_displacement',206,'cc'),
    ('engine_speed',2800,'rpm'),
    ('fuel_tank_capacity',4.1,'L'),
    ('engine_power',6.5,'kW'),
    ('height_of_cut_min',5,'mm'),
    ('height_of_cut_max',35,'mm'),
    ('clip_rate',73,'clips/m'),
    ('grassbox_capacity',99,'L'),
    ('weight',111,'kg'),
    ('overall_width',790,'mm')
)
insert into catalogue.facts(machine_variant_id,spec_definition_id,value_number,unit,confidence,status)
select refs.variant_id,sd.id,vals.value_number,vals.unit,'provisional','active'
from refs cross join vals join catalogue.spec_definitions sd on sd.key=vals.key
on conflict do nothing;

insert into catalogue.facts(machine_variant_id,spec_definition_id,value_text,confidence,status)
select mm.id,mv.id,sd.id,'B&S Intek Pro','provisional','active'
from catalogue.machine_models mm
join catalogue.machine_variants mv on mv.machine_model_id=mm.id and mv.variant_code='F016310542'
join catalogue.spec_definitions sd on sd.key='engine'
where mm.slug='royale-24'
on conflict do nothing;

insert into catalogue.facts(machine_variant_id,spec_definition_id,value_text,confidence,status)
select mm.id,mv.id,sd.id,'Petrol','provisional','active'
from catalogue.machine_models mm
join catalogue.machine_variants mv on mv.machine_model_id=mm.id and mv.variant_code='F016310542'
join catalogue.spec_definitions sd on sd.key='fuel'
where mm.slug='royale-24'
on conflict do nothing;

insert into catalogue.fact_sources(fact_id,source_id,source_locator)
select f.id,s.id,'manual:ATCO Club/Royale specification'
from catalogue.facts f
join catalogue.machine_variants mv on mv.id=f.machine_variant_id and mv.variant_code='F016310542'
join catalogue.sources s on s.canonical_url='https://manualsnet.com/atco/royale-24e'
join catalogue.machine_models mm on mm.id=mv.machine_model_id and mm.slug='royale-24'
where not exists(select 1 from catalogue.fact_sources fs where fs.fact_id=f.id and fs.source_id=s.id);
