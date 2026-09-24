-- REELMOW Garage v0.5
-- Production hardening: data integrity, audit trail, storage path isolation and least privilege.
begin;
alter table catalogue.facts drop constraint if exists facts_scope_exactly_one;
alter table catalogue.facts add constraint facts_scope_exactly_one check (num_nonnulls(machine_model_id, machine_variant_id) = 1);
grant select on garage.audit_events to authenticated;

create or replace function private.write_garage_audit()
returns trigger language plpgsql security definer set search_path=''
as $$
declare target_org uuid; target_id uuid; before_payload jsonb; after_payload jsonb;
begin
  if TG_TABLE_NAME='machines' then
    target_id:=coalesce(NEW.id,OLD.id);
    select g.organization_id into target_org from garage.garages g where g.id=coalesce(NEW.garage_id,OLD.garage_id);
  else
    target_id:=coalesce(NEW.machine_id,OLD.machine_id);
    select g.organization_id into target_org from garage.machines m join garage.garages g on g.id=m.garage_id where m.id=target_id;
  end if;
  if target_org is null then return coalesce(NEW,OLD); end if;
  before_payload:=case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) else null end;
  after_payload:=case when TG_OP in ('INSERT','UPDATE') then to_jsonb(NEW) else null end;
  insert into garage.audit_events(organization_id,user_id,entity_type,entity_id,action,before_data,after_data,metadata)
  values(target_org,(select auth.uid()),'garage.'||TG_TABLE_NAME,target_id,lower(TG_OP),before_payload,after_payload,jsonb_build_object('source','database_trigger'));
  return coalesce(NEW,OLD);
end;
$$;
revoke all on function private.write_garage_audit() from public;
grant execute on function private.write_garage_audit() to authenticated;

drop trigger if exists audit_machines on garage.machines;
create trigger audit_machines after insert or update or delete on garage.machines for each row execute function private.write_garage_audit();
drop trigger if exists audit_machine_hours on garage.machine_hours_log;
create trigger audit_machine_hours after insert or update or delete on garage.machine_hours_log for each row execute function private.write_garage_audit();
drop trigger if exists audit_machine_service on garage.machine_service_records;
create trigger audit_machine_service after insert or update or delete on garage.machine_service_records for each row execute function private.write_garage_audit();
drop trigger if exists audit_machine_documents on garage.machine_documents;
create trigger audit_machine_documents after insert or update or delete on garage.machine_documents for each row execute function private.write_garage_audit();
drop trigger if exists audit_machine_photos on garage.machine_photos;
create trigger audit_machine_photos after insert or update or delete on garage.machine_photos for each row execute function private.write_garage_audit();

drop policy if exists "garage object read" on storage.objects;
drop policy if exists "garage object insert" on storage.objects;
drop policy if exists "garage object update" on storage.objects;
drop policy if exists "garage object delete" on storage.objects;

create policy "garage object read" on storage.objects for select to authenticated using (
 bucket_id='reelmow-garage-private' and (storage.foldername(name))[1]='org' and (storage.foldername(name))[3]='machines'
 and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$' and (storage.foldername(name))[4] ~* '^[0-9a-f-]{36}$'
 and exists(select 1 from garage.machines m join garage.garages g on g.id=m.garage_id where g.organization_id=((storage.foldername(name))[2])::uuid and m.id=((storage.foldername(name))[4])::uuid and private.is_org_member(g.organization_id))
);
create policy "garage object insert" on storage.objects for insert to authenticated with check (
 bucket_id='reelmow-garage-private' and (storage.foldername(name))[1]='org' and (storage.foldername(name))[3]='machines'
 and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$' and (storage.foldername(name))[4] ~* '^[0-9a-f-]{36}$'
 and exists(select 1 from garage.machines m join garage.garages g on g.id=m.garage_id where g.organization_id=((storage.foldername(name))[2])::uuid and m.id=((storage.foldername(name))[4])::uuid and private.has_org_role(g.organization_id,array['owner','admin','manager','operator']::garage.member_role[]))
);
create policy "garage object update" on storage.objects for update to authenticated using (
 bucket_id='reelmow-garage-private' and (storage.foldername(name))[1]='org' and (storage.foldername(name))[3]='machines'
 and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$' and (storage.foldername(name))[4] ~* '^[0-9a-f-]{36}$'
 and exists(select 1 from garage.machines m join garage.garages g on g.id=m.garage_id where g.organization_id=((storage.foldername(name))[2])::uuid and m.id=((storage.foldername(name))[4])::uuid and private.has_org_role(g.organization_id,array['owner','admin','manager']::garage.member_role[]))
) with check (
 bucket_id='reelmow-garage-private' and (storage.foldername(name))[1]='org' and (storage.foldername(name))[3]='machines'
 and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$' and (storage.foldername(name))[4] ~* '^[0-9a-f-]{36}$'
 and exists(select 1 from garage.machines m join garage.garages g on g.id=m.garage_id where g.organization_id=((storage.foldername(name))[2])::uuid and m.id=((storage.foldername(name))[4])::uuid and private.has_org_role(g.organization_id,array['owner','admin','manager']::garage.member_role[]))
);
create policy "garage object delete" on storage.objects for delete to authenticated using (
 bucket_id='reelmow-garage-private' and (storage.foldername(name))[1]='org' and (storage.foldername(name))[3]='machines'
 and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$' and (storage.foldername(name))[4] ~* '^[0-9a-f-]{36}$'
 and exists(select 1 from garage.machines m join garage.garages g on g.id=m.garage_id where g.organization_id=((storage.foldername(name))[2])::uuid and m.id=((storage.foldername(name))[4])::uuid and private.has_org_role(g.organization_id,array['owner','admin','manager']::garage.member_role[]))
);
commit;