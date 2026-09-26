begin;

-- Harden machine status transitions so the role check cannot be bypassed
-- by relying on a SECURITY DEFINER function's session-role context.

create or replace function garage.transition_machine_status(
  p_machine_id uuid,
  p_target_status garage.machine_status,
  p_notes text default null
)
returns garage.machines
language plpgsql
security definer
set search_path to ''
as $$
declare
  m garage.machines%rowtype;
  org_id uuid;
  old_status text;
  allowed boolean:=false;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select g.organization_id into org_id
  from garage.machines m0
  join garage.garages g on g.id=m0.garage_id
  where m0.id=p_machine_id
    and exists(
      select 1 from garage.memberships ms
      where ms.organization_id=g.organization_id
        and ms.user_id=(select auth.uid())
    );

  if org_id is null then raise exception 'Machine not found or access denied'; end if;

  if not private.has_org_role(
    org_id,
    array['owner','admin','manager','operator']::garage.member_role[]
  ) then
    raise exception 'Your role cannot change machine status';
  end if;

  if p_target_status='retired'
     and not private.has_org_role(
       org_id,
       array['owner','admin']::garage.member_role[]
     ) then
    raise exception 'Only an owner or admin can retire a machine';
  end if;

  select m0.* into m
  from garage.machines m0
  where m0.id=p_machine_id
  for update;

  old_status=m.status::text;

  allowed:=
    (m.status='ready' and p_target_status in ('service_due','in_service','out_of_service'))
    or (m.status='service_due' and p_target_status in ('in_service','ready','out_of_service'))
    or (m.status='in_service' and p_target_status in ('ready','service_due','out_of_service','repaired'))
    or (m.status='out_of_service' and p_target_status in ('in_service','repaired','retired'))
    or (m.status='repaired' and p_target_status in ('ready','out_of_service'))
    or (m.status='retired' and p_target_status='retired');

  if not allowed then
    raise exception 'Invalid status transition from % to %',m.status,p_target_status;
  end if;

  update garage.machines
  set status=p_target_status,updated_at=now()
  where id=p_machine_id
  returning * into m;

  insert into garage.audit_events(
    organization_id,user_id,entity_type,entity_id,action,before_data,after_data,metadata
  )
  values(
    org_id,(select auth.uid()),'machine',m.id,'status_changed',
    jsonb_build_object('status',old_status),
    jsonb_build_object('status',p_target_status::text),
    jsonb_build_object('notes',coalesce(p_notes,''))
  );

  return m;
end;
$$;

revoke all on function garage.transition_machine_status(uuid,garage.machine_status,text) from public,anon;
grant execute on function garage.transition_machine_status(uuid,garage.machine_status,text) to authenticated;

commit;
