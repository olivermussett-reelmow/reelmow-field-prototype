# REELMOW database tests

The database test suite is intentionally separate from application/UI tests.

## Test groups

- database/001_backend_contract.sql — core schema and integrity contract
- database/002_security.sql — RLS, function privileges and security posture
- database/003_catalogue.sql — seeded catalogue and search contract
- database/004_service_integrity.sql — service, hours, document and photo integrity
- database/005_tenant_isolation.sql — tenant policy structure
- database/006_tenant_isolation_behavior.sql — behavioural tenant isolation
- database/007_service_workflow.sql — hours → due → service lifecycle

## Local execution

Use the Supabase CLI against an isolated local database:

    supabase start
    supabase db reset
    supabase test db

The tests must run against the complete migration chain. A migration that passes in the hosted project but fails supabase db reset is not considered complete.

## Important rule

Do not put real customer data, credentials, service-role keys or production storage objects into tests.

Tenant-isolation tests should use deterministic synthetic users and organisations only.

## CI

The intended CI gate is:

    supabase db reset
    supabase test db

Production deployment should not be considered green if the database test suite fails.
