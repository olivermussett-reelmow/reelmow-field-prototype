-- REELMOW test infrastructure
-- pgTAP is installed in the extensions schema so database contract tests can
-- run against a clean local Supabase instance and never depend on public.
create extension if not exists pgtap with schema extensions;

revoke all on schema extensions from anon, authenticated;
grant usage on schema extensions to postgres, service_role;
