# REELMOW Garage

First production-oriented vertical slice for the REELMOW digital machinery platform.

## Flow

Sign in -> Organisation -> Garage -> Add Machine -> Catalogue Search -> Physical Machine -> Machine Profile.

## Live Supabase

The prototype uses the Supabase browser client with the public anon key. Never use a service-role key in the browser.

Because the data model deliberately uses custom schemas, the Supabase Data API must expose `catalogue` and `garage`. Keep `private` and `ingestion` unexposed. The frontend uses explicit `.schema('catalogue')` and `.schema('garage')` calls.

For this static prototype, connection settings are stored locally in the browser. For a production build, inject `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` at build/deploy time.

## Demo mode

The Preview Garage option uses a seeded Jacobsen LF3800 and does not write to Supabase.

## Current backend contract

- `garage.create_organization()` bootstraps the authenticated organisation and owner membership.
- `catalogue.search_machines()` performs shared catalogue search.
- `garage.machines` stores the customer's physical machine.
- Catalogue records remain separate from customer-owned machine records.
- RLS is enforced by Supabase; the client does not bypass it.

## Next slice

Service history, service-due calculations, document viewing, machine photos/storage and manager/operator permissions.
