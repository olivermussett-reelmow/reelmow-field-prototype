revoke execute on function garage.sync_record_machine_hours(uuid,uuid,numeric,numeric,text,text) from public;
grant execute on function garage.sync_record_machine_hours(uuid,uuid,numeric,numeric,text,text) to authenticated;
revoke execute on function garage.sync_record_machine_service(uuid,uuid,uuid,timestamptz,numeric,numeric,text,numeric,text,jsonb) from public;
grant execute on function garage.sync_record_machine_service(uuid,uuid,uuid,timestamptz,numeric,numeric,text,numeric,text,jsonb) to authenticated;
revoke execute on function garage.sync_report_machine_fault(uuid,uuid,text,text) from public;
grant execute on function garage.sync_report_machine_fault(uuid,uuid,text,text) to authenticated;
