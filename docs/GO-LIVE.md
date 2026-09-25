# REELMOW Go-Live Checklist

## Production architecture

- Frontend: GitHub Pages
- Database/Auth/Storage: Supabase
- Browser credential: Supabase publishable key only
- Authorization boundary: PostgreSQL RLS + authenticated user session
- Private evidence: Supabase Storage private bucket with signed URLs
- AI plate identification: authenticated Supabase Edge Function

## GitHub Pages runtime configuration

The Pages workflow generates `reelmow.config.js` at deploy time from repository variables.

Create these **repository variables** in GitHub:

1. `SUPABASE_URL`
   - Value: the REELMOW Supabase project URL.
2. `SUPABASE_PUBLISHABLE_KEY`
   - Value: the active Supabase publishable browser key.

Do not put a Supabase secret/service-role key in either variable.

The publishable key is intentionally browser-visible. Supabase's security model requires RLS and least-privilege grants to protect data.

## First production smoke test

After a Pages deployment:

1. Open the deployed REELMOW URL.
2. Confirm the header reports **Connected**.
3. Create/sign in to a test user.
4. Create an organisation and Garage.
5. Search the catalogue for **LF3800**.
6. Confirm **Jacobsen LF3800 5-Gang** is returned.
7. Add a test machine.
8. Confirm machine hours can be recorded.
9. Confirm a service record can be created.
10. Upload one private document and one private photo.
11. Confirm both can be opened through signed URLs.
12. Sign out and confirm protected Garage data is no longer accessible.

## Security acceptance

Before inviting real users:

- Never expose `service_role` or `sb_secret_*` keys in the browser.
- Keep RLS enabled on all exposed application tables.
- Keep catalogue ingestion/review operations private.
- Review Supabase Security Advisor findings; the three deliberate public Garage SECURITY DEFINER wrappers are documented as intentional authorization boundaries.
- Do not make private storage public merely to simplify the UI.
- Keep signed URLs short-lived.
- Treat AI plate recognition as evidence extraction, not authoritative machine identity; require user confirmation before adding an asset.

## Current acceptance snapshot

Validated against production Supabase on 25 September 2026:

- PostgreSQL 17.6
- 27 migrations applied
- 14/14 catalogue tables have RLS
- 9/9 Garage tables have RLS
- 5/5 ingestion tables have RLS
- LF3800 catalogue search returns Jacobsen LF3800 5-Gang at rank 1
- LF3800 has 9 active catalogue facts
- LF3800 currently has no catalogue document attached

The catalogue document gap is a data-enrichment item, not a UI or security blocker.

## Release principle

REELMOW should not move from prototype to general availability because the UI looks finished. Release only when the end-to-end workflow is verified with real authentication, real Garage data, private evidence, service scheduling and the production runtime configuration.
