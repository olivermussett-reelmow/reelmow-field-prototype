begin;

-- Keep the storage path checks explicit after the pending-machine policies
-- replace the earlier machine-row-scoped policies. This makes every path
-- reference unambiguous in the storage.objects policy context.
drop policy if exists "garage object insert" on storage.objects;
drop policy if exists "garage object read" on storage.objects;
drop policy if exists "garage object delete" on storage.objects;

create policy "garage object insert"
on storage.objects for insert to authenticated
with check (
  storage.objects.bucket_id='reelmow-garage-private'
  and (storage.foldername(storage.objects.name))[1]='org'
  and (storage.foldername(storage.objects.name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(storage.objects.name))[3]='machines'
  and (storage.foldername(storage.objects.name))[4] ~* '^[0-9a-f-]{36}$'
  and private.has_org_role(
    ((storage.foldername(storage.objects.name))[2])::uuid,
    array['owner','admin','manager','operator']::garage.member_role[]
  )
);

create policy "garage object read"
on storage.objects for select to authenticated
using (
  storage.objects.bucket_id='reelmow-garage-private'
  and (storage.foldername(storage.objects.name))[1]='org'
  and (storage.foldername(storage.objects.name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(storage.objects.name))[3]='machines'
  and (storage.foldername(storage.objects.name))[4] ~* '^[0-9a-f-]{36}$'
  and private.is_org_member(((storage.foldername(storage.objects.name))[2])::uuid)
);

create policy "garage object delete"
on storage.objects for delete to authenticated
using (
  storage.objects.bucket_id='reelmow-garage-private'
  and (storage.foldername(storage.objects.name))[1]='org'
  and (storage.foldername(storage.objects.name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(storage.objects.name))[3]='machines'
  and (storage.foldername(storage.objects.name))[4] ~* '^[0-9a-f-]{36}$'
  and private.has_org_role(
    ((storage.foldername(storage.objects.name))[2])::uuid,
    array['owner','admin','manager','operator']::garage.member_role[]
  )
);

commit;
