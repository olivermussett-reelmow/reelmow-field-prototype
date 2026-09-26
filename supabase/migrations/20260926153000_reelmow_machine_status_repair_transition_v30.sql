create or replace function garage.transition_machine_status(p_machine_id uuid,p_target_status garage.machine_status,p_notes text default null)
returns garage.machines language plpgsql security definer set search_path to ''
as $$
declare m garage.machines%rowtype; current_role garage.member_role; allowed boolean:=false; old_status text;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select m0.* into m from garage.machines m0 join garage.garages g on g.id=m0.garage_id
 where m0.id=p_machine_id and exists(select 1 from garage.memberships ms where ms.organization_id=g.organization_id and ms.user_id=auth.uid()) for update;
 if not found then raise exception 'Machine not found or access denied'; end if;
 old_status=m.status::text;
 select ms.role into current_role from garage.memberships ms join garage.garages g on g.organization_id=ms.organization_id where g.id=m.garage_id and ms.user_id=auth.uid() limit 1;
 if current_role='viewer' then raise exception 'Your role cannot change machine status'; end if;
 if p_target_status='retired' and current_role not in ('owner','admin') then raise exception 'Only an owner or admin can retire a machine'; end if;
 allowed:=(m.status='ready' and p_target_status in ('service_due','in_service','out_of_service'))
 or (m.status='service_due' and p_target_status in ('in_service','ready','out_of_service'))
 or (m.status='in_service' and p_target_status in ('ready','service_due','out_of_service','repaired'))
 or (m.status='out_of_service' and p_target_status in ('in_service','repaired','retired'))
 or (m.status='repaired' and p_target_status in ('ready','out_of_service'))
 or (m.status='retired' and p_target_status='retired');
 if not allowed then raise exception 'Invalid status transition from % to %',m.status,p_target_status; end if;
 update garage.machines set status=p_target_status,updated_at=now() where id=p_machine_id returning * into m;
 insert into garage.audit_events(organization_id,user_id,entity_type,entity_id,action,before_data,after_data,metadata)
 select g.organization_id,auth.uid(),'machine',m.id,'status_changed',jsonb_build_object('status',old_status),jsonb_build_object('status',p_target_status::text),jsonb_build_object('notes',coalesce(p_notes,''))
 from garage.garages g where g.id=m.garage_id;
 return m;
end $$;