revoke execute on function garage.sync_record_machine_hours(uuid,uuid,numeric,numeric,text,text) from anon;
revoke execute on function garage.sync_record_machine_service(uuid,uuid,uuid,timestamptz,numeric,numeric,text,numeric,text,jsonb) from anon;
revoke execute on function garage.sync_report_machine_fault(uuid,uuid,text,text) from anon;
