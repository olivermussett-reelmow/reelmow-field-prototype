create or replace function garage.acknowledge_machine_fault(p_fault_id uuid, p_notes text default null)
returns garage.machine_faults
language plpgsql
security definer
set search_path to ''
as $function$
declare
  f garage.machine_faults%rowtype;
  org_id uuid;
  current_role garage.member_role;
  machine_status garage.machine_status;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select mf.* into f
  from garage.machine_faults mf
  join garage.machines m on m.id=mf.machine_id
  join garage.garages g on g.id=m.garage_id
  where mf.id=p_fault_id
    and exists(
      select 1 from garage.memberships ms
      where ms.organization_id=g.organization_id and ms.user_id=auth.uid()
    )
  for update;

  if not found then raise exception 'Problem not found or access denied'; end if;

  select g.organization_id, m.status
    into org_id, machine_status
  from garage.machines m
  join garage.garages g on g.id=m.garage_id
  where m.id=f.machine_id;

  select role into current_role
  from garage.memberships
  where organization_id=org_id and user_id=auth.uid()
  limit 1;

  if current_role='viewer' then raise exception 'Your role cannot acknowledge problems'; end if;
  if f.status='resolved' then raise exception 'Problem is already resolved'; end if;

  update garage.machine_faults
  set status='acknowledged', updated_at=now()
  where id=p_fault_id
  returning * into f;

  -- Acknowledge must not perform a redundant machine status transition.
  -- If the machine is already in service, leave its operational status unchanged.
  -- Other states retain the existing behaviour of returning the machine to service.
  if machine_status <> 'in_service' then
    perform garage.transition_machine_status(
      f.machine_id,
      'in_service',
      coalesce(p_notes,'Problem acknowledged')
    );
  end if;

  return f;
end
$function$;
