-- pg_trgm was moved from public to extensions. Keep catalogue search
-- explicitly qualified so future extension hardening cannot break it.
begin;

create or replace function catalogue.search_machines(search_text text, result_limit integer default 12)
returns table(
  model_id uuid,
  manufacturer_name text,
  model_name text,
  variant_id uuid,
  variant_name text,
  machine_type text,
  rank real
)
language sql
security invoker
set search_path=''
as $$
  select s.model_id,s.manufacturer_name,s.model_name,s.variant_id,s.variant_name,s.machine_type,
         greatest(
           extensions.similarity(s.model_name,search_text),
           extensions.similarity(coalesce(s.variant_name,''),search_text),
           extensions.similarity(s.manufacturer_name,search_text)
         )::real as rank
  from catalogue.machine_search s
  where s.model_name ilike '%'||search_text||'%'
     or s.variant_name ilike '%'||search_text||'%'
     or s.manufacturer_name ilike '%'||search_text||'%'
  order by rank desc, s.manufacturer_name, s.model_name
  limit greatest(1,least(result_limit,100));
$$;

revoke execute on function catalogue.search_machines(text,integer) from public,anon;
grant execute on function catalogue.search_machines(text,integer) to authenticated;

commit;
