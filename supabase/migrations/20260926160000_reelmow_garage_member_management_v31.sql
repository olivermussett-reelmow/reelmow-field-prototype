create or replace function garage.list_members()
returns table(user_id uuid,email text,role garage.member_role,created_at timestamptz)
language plpgsql security definer set search_path to ''
as $$
declare org_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select m.organization_id into org_id from garage.memberships m where m.user_id=auth.uid() order by m.created_at limit 1;
 if org_id is null then raise exception 'Organisation membership not found'; end if;
 if not private.is_org_member(org_id) then raise exception 'Access denied'; end if;
 return query select m.user_id,u.email::text,m.role,m.created_at
 from garage.memberships m join auth.users u on u.id=m.user_id
 where m.organization_id=org_id
 order by case m.role when 'owner' then 1 when 'admin' then 2 when 'manager' then 3 when 'operator' then 4 else 5 end,m.created_at;
end $$;

create or replace function garage.change_member_role(p_user_id uuid,p_role garage.member_role)
returns garage.memberships
language plpgsql security definer set search_path to ''
as $$
declare org_id uuid; actor_role garage.member_role; target garage.memberships%rowtype; old_role garage.member_role; owners integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select m.organization_id into org_id from garage.memberships m where m.user_id=auth.uid() order by m.created_at limit 1;
 select role into actor_role from garage.memberships where organization_id=org_id and user_id=auth.uid();
 if actor_role not in ('owner','admin') then raise exception 'Only an owner or admin can change member roles'; end if;
 if actor_role='admin' and p_role='owner' then raise exception 'Only an owner can assign the owner role'; end if;
 select * into target from garage.memberships where organization_id=org_id and user_id=p_user_id for update;
 if not found then raise exception 'Member not found'; end if;
 old_role=target.role;
 if old_role='owner' and p_role<>'owner' then
   select count(*) into owners from garage.memberships where organization_id=org_id and role='owner';
   if owners<=1 then raise exception 'The organisation must retain at least one owner'; end if;
   if actor_role<>'owner' then raise exception 'Only an owner can change an owner role'; end if;
 end if;
 update garage.memberships set role=p_role where id=target.id returning * into target;
 insert into garage.audit_events(organization_id,user_id,entity_type,entity_id,action,before_data,after_data,metadata)
 values(org_id,auth.uid(),'membership',target.id,'member_role_changed',
        jsonb_build_object('role',old_role::text,'member_user_id',p_user_id),
        jsonb_build_object('role',p_role::text,'member_user_id',p_user_id),'{}'::jsonb);
 return target;
end $$;

revoke all on function garage.list_members() from public;
grant execute on function garage.list_members() to authenticated;
revoke all on function garage.change_member_role(uuid,garage.member_role) from public;
grant execute on function garage.change_member_role(uuid,garage.member_role) to authenticated;
