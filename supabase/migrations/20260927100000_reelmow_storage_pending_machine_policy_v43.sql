begin;

-- V43: plate evidence is uploaded before create_machine().
-- The V40 INSERT/SELECT/DELETE policies required the machine row to exist,
-- but the browser deliberately uploads evidence before the machine RPC.
-- Scope these pre-create operations to a valid organisation path instead.
drop policy if exists "garage object insert" on storage.objects;
drop policy if exists "garage object read" on storage.objects;
drop policy if exists "garage object delete" on storage.objects;

create policy "garage object insert"
on storage.objects for insert to authenticated
with check (
  bucket_id='reelmow-garage-private'
  and (storage.foldername(name))[1]='org'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[3]='machines'
  and (storage.foldername(name))[4] ~* '^[0-9a-f-]{36}$'
  and private.has_org_role(
    ((storage.foldername(name))[2])::uuid,
    array['owner','admin','manager','operator']::garage.member_role[]
  )
);

create policy "garage object read"
on storage.objects for select to authenticated
using (
  bucket_id='reelmow-garage-private'
  and (storage.foldername(name))[1]='org'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[3]='machines'
  and (storage.foldername(name))[4] ~* '^[0-9a-f-]{36}$'
  and private.is_org_member(((storage.foldername(name))[2])::uuid)
);

create policy "garage object delete"
on storage.objects for delete to authenticated
using (
  bucket_id='reelmow-garage-private'
  and (storage.foldername(name))[1]='org'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[3]='machines'
  and (storage.foldername(name))[4] ~* '^[0-9a-f-]{36}$'
  and private.has_org_role(
    ((storage.foldername(name))[2])::uuid,
    array['owner','admin','manager','operator']::garage.member_role[]
  )
);

commit;
