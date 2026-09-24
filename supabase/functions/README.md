# REELMOW Edge Functions

## ingest-document

Server-side AI extraction for manufacturer documents.

Required production secrets:
- OPENAI_API_KEY
- SUPABASE_SERVICE_ROLE_KEY (Supabase provides this to hosted functions; never expose it to the browser)

The function deliberately writes only to ingestion.ai_runs and ingestion.extracted_facts. It does not publish canonical catalogue facts.

Use Supabase project secrets for production values; never commit a .env containing these values. See Supabase Edge Function secret guidance.

The production deployment should be wired to a CI/CD environment once the Supabase project reference and deployment token are configured.
