-- REELMOW Garage v0.7
-- Security hardening: isolate ingestion/AI audit tables and move pg_trgm out of public.
begin;

-- These tables are internal ingestion/AI pipeline state. They must not be
-- directly readable or writable through the customer-facing API roles.
alter table ingestion.ai_runs enable row level security;
alter table ingestion.jobs enable row level security;
alter table ingestion.job_documents enable row level security;
alter table ingestion.extracted_facts enable row level security;
alter table ingestion.review_queue enable row level security;

revoke all on table ingestion.ai_runs,
  ingestion.jobs,
  ingestion.job_documents,
  ingestion.extracted_facts,
  ingestion.review_queue
from anon, authenticated;

-- Edge Functions using the service role can operate on the ingestion pipeline.
grant select, insert, update, delete on table ingestion.ai_runs,
  ingestion.jobs,
  ingestion.job_documents,
  ingestion.extracted_facts,
  ingestion.review_queue
to service_role;

-- Keep pg_trgm available for catalogue search, but do not install it in public.
create schema if not exists extensions;
alter extension pg_trgm set schema extensions;
grant usage on schema extensions to authenticated;

commit;
