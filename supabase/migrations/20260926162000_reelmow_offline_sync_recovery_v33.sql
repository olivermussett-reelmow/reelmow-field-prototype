alter table garage.sync_operations drop constraint if exists sync_operations_status_check;
alter table garage.sync_operations add constraint sync_operations_status_check check (status = any (array['processing'::text,'completed'::text,'failed'::text]));
create or replace function private.begin_sync_operation(
  p_operation_id uuid,p_operation_type text,p_machine_id uuid)
returns uuid language plpgsql security definer set search_path to ''
as $$
declare existing_user uuid; existing_type text; existing_status text; existing_result uuid; existing_created timestamptz;
begin
 if auth.uid() is null then raise exception 'authentication required'; end if;
 select user_id,operation_type,status,result_id,created_at into existing_user,existing_type,existing_status,existing_result,existing_created
 from garage.sync_operations where operation_id=p_operation_id for update;
 if existing_user is not null then
   if existing_user<>auth.uid() or existing_type<>p_operation_type then raise exception 'operation id cannot be reused'; end if;
   if existing_status='completed' then return existing_result; end if;
   if existing_status='processing' and existing_created > now()-interval '15 minutes' then raise exception 'operation is already processing'; end if;
   update garage.sync_operations set status='processing',created_at=now(),completed_at=null,result_id=null where operation_id=p_operation_id;
   return null;
 end if;
 insert into garage.sync_operations(operation_id,user_id,operation_type,machine_id,status) values(p_operation_id,auth.uid(),p_operation_type,p_machine_id,'processing');
 return null;
end $$;
