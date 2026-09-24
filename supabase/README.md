# REELMOW Supabase

The production database schema is managed through versioned migrations in `supabase/migrations`.

## Deployment

- Production branch: `main`
- Supabase GitHub integration: enabled
- Working directory: repository root (`.`)
- Production deployment: enabled
- Do not make production schema changes manually in the Table Editor.

## Foundation

`202609240001_reelmow_foundation_v02.sql` establishes the REELMOW catalogue, provenance, ingestion, Garage, service-history, RLS, search views/functions, storage buckets/policies, and the Jacobsen LF3800 golden-machine seed.

## Architecture

Catalogue data is canonical and shared. Customer Garage data is tenant-owned. AI/ingestion proposes facts; canonical catalogue facts retain source provenance.

## Deployment trigger

Changes merged to `main` are configured to deploy to the production Supabase database. This file is also used as a harmless deployment trigger when the GitHub connection is first enabled.
