begin;
drop policy if exists "garage object read" on storage.objects;
drop policy if exists "garage object update" on storage.objects;
drop policy if exists "garage object delete" on storage.objects;

create policy "garage object read"
on storage.objects for select to authenticated
using (
  storage.objects.bucket_id='reelmow-garage-private'
  and (storage.foldername(storage.objects.name))[1]='org'
  and (storage.foldername(storage.objects.name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(storage.objects.name))[3]='machines'
  and (storage.foldername(storage.objects.name))[4] ~* '^[0-9a-f-]{36}$'
  and exists (
    select 1 from garage.machines m
    join garage.garages g on g.id=m.garage_id
    where g.organization_id=((storage.foldername(storage.objects.name))[2])::uuid
      and m.id=((storage.foldername(storage.objects.name))[4])::uuid
      and private.is_org_member(g.organization_id)
  )
);

create policy "garage object update"
on storage.objects for update to authenticated
using (
  storage.objects.bucket_id='reelmow-garage-private'
  and (storage.foldername(storage.objects.name))[1]='org'
  and (storage.foldername(storage.objects.name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(storage.objects.name))[3]='machines'
  and (storage.foldername(storage.objects.name))[4] ~* '^[0-9a-f-]{36}$'
  and exists (
    select 1 from garage.machines m
    join garage.garages g on g.id=m.garage_id
    where g.organization_id=((storage.foldername(storage.objects.name))[2])::uuid
      and m.id=((storage.foldername(storage.objects.name))[4])::uuid
      and private.has_org_role(g.organization_id,array['owner','admin','manager']::garage.member_role[])
  )
)
with check (
  storage.objects.bucket_id='reelmow-garage-private'
  and (storage.foldername(storage.objects.name))[1]='org'
  and (storage.foldername(storage.objects.name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(storage.objects.name))[3]='machines'
  and (storage.foldername(storage.objects.name))[4] ~* '^[0-9a-f-]{36}$'
  and exists (
    select 1 from garage.machines m
    join garage.garages g on g.id=m.garage_id
    where g.organization_id=((storage.foldername(storage.objects.name))[2])::uuid
      and m.id=((storage.foldername(storage.objects.name))[4])::uuid
      and private.has_org_role(g.organization_id,array['owner','admin','manager']::garage.member_role[])
  )
);

create policy "garage object delete"
on storage.objects for delete to authenticated
using (
  storage.objects.bucket_id='reelmow-garage-private'
  and (storage.foldername(storage.objects.name))[1]='org'
  and (storage.foldername(storage.objects.name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(storage.objects.name))[3]='machines'
  and (storage.foldername(storage.objects.name))[4] ~* '^[0-9a-f-]{36}$'
  and exists (
    select 1 from garage.machines m
    join garage.garages g on g.id=m.garage_id
    where g.organization_id=((storage.foldername(storage.objects.name))[2])::uuid
      and m.id=((storage.foldername(storage.objects.name))[4])::uuid
      and private.has_org_role(g.organization_id,array['owner','admin','manager']::garage.member_role[])
  )
);
commit;