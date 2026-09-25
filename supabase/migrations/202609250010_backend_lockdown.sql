-- REELMOW backend foundation hardening v1
begin;

-- Internal ingestion pipeline: explicit deny-by-default policies.
alter table ingestion.ai_runs enable row level security;
alter table ingestion.jobs enable row level security;
alter table ingestion.job_documents enable row level security;
alter table ingestion.extracted_facts enable row level security;
alter table ingestion.review_queue enable row level security;

drop policy if exists ingestion_ai_runs_deny_authenticated on ingestion.ai_runs;
drop policy if exists ingestion_jobs_deny_authenticated on ingestion.jobs;
drop policy if exists ingestion_job_documents_deny_authenticated on ingestion.job_documents;
drop policy if exists ingestion_extracted_facts_deny_authenticated on ingestion.extracted_facts;
drop policy if exists ingestion_review_queue_deny_authenticated on ingestion.review_queue;

create policy ingestion_ai_runs_deny_authenticated on ingestion.ai_runs for all to authenticated using (false) with check (false);
create policy ingestion_jobs_deny_authenticated on ingestion.jobs for all to authenticated using (false) with check (false);
create policy ingestion_job_documents_deny_authenticated on ingestion.job_documents for all to authenticated using (false) with check (false);
create policy ingestion_extracted_facts_deny_authenticated on ingestion.extracted_facts for all to authenticated using (false) with check (false);
create policy ingestion_review_queue_deny_authenticated on ingestion.review_queue for all to authenticated using (false) with check (false);

alter table ingestion.ai_runs force row level security;
alter table ingestion.jobs force row level security;
alter table ingestion.job_documents force row level security;
alter table ingestion.extracted_facts force row level security;
alter table ingestion.review_queue force row level security;

revoke all on table ingestion.ai_runs, ingestion.jobs, ingestion.job_documents,
  ingestion.extracted_facts, ingestion.review_queue from anon, authenticated;

grant select, insert, update, delete on table ingestion.ai_runs, ingestion.jobs,
  ingestion.job_documents, ingestion.extracted_facts, ingestion.review_queue to service_role;

-- PostgREST-facing functions are invoker-only.
revoke execute on function catalogue.search_machines(text,integer) from public,anon;
grant execute on function catalogue.search_machines(text,integer) to authenticated;

revoke execute on function garage.create_organization(text,text) from public,anon;
revoke execute on function garage.record_machine_hours(uuid,numeric,numeric,text,text) from public,anon;
revoke execute on function garage.record_machine_service(uuid,uuid,timestamptz,numeric,numeric,text,numeric,text,jsonb) from public,anon;
grant execute on function garage.create_organization(text,text) to authenticated;
grant execute on function garage.record_machine_hours(uuid,numeric,numeric,text,text) to authenticated;
grant execute on function garage.record_machine_service(uuid,uuid,timestamptz,numeric,numeric,text,numeric,text,jsonb) to authenticated;

-- Private helpers are implementation details.
revoke execute on function private.create_organization(text,text) from public,anon,authenticated;
revoke execute on function private.record_machine_hours(uuid,numeric,numeric,text,text) from public,anon,authenticated;
revoke execute on function private.record_machine_service(uuid,uuid,timestamptz,numeric,numeric,text,numeric,text,jsonb) from public,anon,authenticated;
revoke execute on function private.has_org_role(uuid,garage.member_role[]) from public,anon,authenticated;
revoke execute on function private.is_org_member(uuid) from public,anon,authenticated;
revoke execute on function private.write_garage_audit() from public,anon,authenticated;

commit;
