-- Keep reel blade counts as text because the canonical spec is text
update catalogue.facts f
set value_text=f.value_number::text,value_number=null
from catalogue.spec_definitions sd
where f.spec_definition_id=sd.id
  and sd.key='reel_blades'
  and f.machine_variant_id='019b888f-5fb5-40ed-a0c8-f999e6bc433e'
  and f.value_number is not null
  and f.value_text is null;