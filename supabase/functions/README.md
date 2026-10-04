# REELMOW Edge Functions

## ingest-document

Server-side AI extraction for manufacturer documents.

Required production secrets:
- OPENAI_API_KEY
- SUPABASE_SERVICE_ROLE_KEY (Supabase provides this to hosted functions; never expose it to the browser)

The function deliberately writes only to ingestion.ai_runs and ingestion.extracted_facts. It does not publish canonical catalogue facts.

Use Supabase project secrets for production values; never commit a .env containing these values. See Supabase Edge Function secret guidance.

The production deployment should be wired to a CI/CD environment once the Supabase project reference and deployment token are configured.

## discover-grounds-machines

Authenticated, on-demand UK grounds-equipment discovery for the Add Machine flow. It uses OpenAI Responses web search, returns structured equipment leads with links only to pages cited by the web-search response, and labels usage evidence as prevalence, named club use, supplier claim, or category guidance. It does not create or update canonical catalogue records. `OPENAI_API_KEY` must be configured as a Supabase Edge Function secret. The function validates the supplied user's session itself; the gateway JWT check is disabled for this function in `supabase/config.toml` so that current Supabase Auth token formats are handled by Auth's `getUser()` verification.
