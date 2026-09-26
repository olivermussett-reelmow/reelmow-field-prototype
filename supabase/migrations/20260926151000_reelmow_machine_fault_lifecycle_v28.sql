create or replace function garage.acknowledge_machine_fault(p_fault_id uuid,p_notes text default null)
returns garage.machine_faults language plpgsql security definer set search_path to ''
as $$
declare f garage.machine_faults%rowtype; org_id uuid; current_role garage.member_role;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select mf.* into f from garage.machine_faults mf join garage.machines m on m.id=mf.machine_id join garage.garages g on g.id=m.garage_id
 where mf.id=p_fault_id and exists(select 1 from garage.memberships ms where ms.organization_id=g.organization_id and ms.user_id=auth.uid()) for update;
 if not found then raise exception 'Problem not found or access denied'; end if;
 select g.organization_id into org_id from garage.machines m join garage.garages g on g.id=m.garage_id where m.id=f.machine_id;
 select role into current_role from garage.memberships where organization_id=org_id and user_id=auth.uid() limit 1;
 if current_role='viewer' then raise exception 'Your role cannot acknowledge problems'; end if;
 if f.status='resolved' then raise exception 'Problem is already resolved'; end if;
 update garage.machine_faults set status='acknowledged',updated_at=now() where id=p_fault_id returning * into f;
 perform garage.transition_machine_status(f.machine_id,'in_service',coalesce(p_notes,'Problem acknowledged'));
 return f;
end $$;

create or replace function garage.resolve_machine_fault(p_fault_id uuid,p_resolution_notes text)
returns garage.machine_faults language plpgsql security definer set search_path to ''
as $$
declare f garage.machine_faults%rowtype; org_id uuid; current_role garage.member_role;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if length(btrim(coalesce(p_resolution_notes,'')))<2 then raise exception 'Resolution notes are required'; end if;
 select mf.* into f from garage.machine_faults mf join garage.machines m on m.id=mf.machine_id join garage.garages g on g.id=m.garage_id
 where mf.id=p_fault_id and exists(select 1 from garage.memberships ms where ms.organization_id=g.organization_id and ms.user_id=auth.uid()) for update;
 if not found then raise exception 'Problem not found or access denied'; end if;
 select g.organization_id into org_id from garage.machines m join garage.garages g on g.id=m.garage_id where m.id=f.machine_id;
 select role into current_role from garage.memberships where organization_id=org_id and user_id=auth.uid() limit 1;
 if current_role='viewer' then raise exception 'Your role cannot resolve problems'; end if;
 if f.status='resolved' then return f; end if;
 update garage.machine_faults set status='resolved',resolved_at=now(),resolution_notes=btrim(p_resolution_notes),updated_at=now() where id=p_fault_id returning * into f;
 perform garage.transition_machine_status(f.machine_id,'repaired',coalesce(p_resolution_notes,'Problem repaired'));
 return f;
end $$;

revoke all on function garage.acknowledge_machine_fault(uuid,text) from public;
grant execute on function garage.acknowledge_machine_fault(uuid,text) to authenticated;
revoke all on function garage.resolve_machine_fault(uuid,text) from public;
grant execute on function garage.resolve_machine_fault(uuid,text) to authenticated;
