begin;

-- Correct Garage private-storage INSERT policy to validate storage.objects.name.
-- The previous policy parsed the garage row name instead of the object path,
-- which could reject valid evidence uploads.

drop policy if exists "garage object insert" on storage.objects;

create policy "garage object insert"
on storage.objects for insert to authenticated
with check (
  storage.objects.bucket_id='reelmow-garage-private'
  and (storage.foldername(storage.objects.name))[1]='org'
  and (storage.foldername(storage.objects.name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(storage.objects.name))[3]='machines'
  and (storage.foldername(storage.objects.name))[4] ~* '^[0-9a-f-]{36}$'
  and exists (
    select 1
    from garage.machines m
    join garage.garages g on g.id=m.garage_id
    where g.organization_id=((storage.foldername(storage.objects.name))[2])::uuid
      and m.id=((storage.foldername(storage.objects.name))[4])::uuid
      and private.has_org_role(
        g.organization_id,
        array['owner','admin','manager','operator']::garage.member_role[]
      )
  )
);

commit;
