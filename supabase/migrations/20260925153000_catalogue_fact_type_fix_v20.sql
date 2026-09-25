-- Correct variant-scoped SC610 reel blade fact by stable catalogue identity.
update catalogue.facts f
set value_text=f.value_number::text,value_number=null
from catalogue.spec_definitions sd
where f.spec_definition_id=sd.id
  and f.machine_variant_id in (
    select mv.id
    from catalogue.machine_variants mv
    join catalogue.machine_models mm on mm.id=mv.machine_model_id
    join catalogue.product_families pf on pf.id=mm.product_family_id
    join catalogue.manufacturers m on m.id=pf.manufacturer_id
    where m.slug='protea' and mm.slug='sc610-supercut' and mv.variant_code='SC610-24'
  )
  and sd.key='reel_blades'
  and f.value_number is not null
  and f.value_text is null;