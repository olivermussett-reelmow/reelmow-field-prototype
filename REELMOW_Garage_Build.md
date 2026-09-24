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

## Test Build 02 — Service

The Garage now includes:
- machine hour readings with atomic server-side updates;
- service records attached to physical machines;
- service-due calculations driven by published catalogue schedules;
- source page references displayed alongside maintenance rules;
- a service history timeline;
- a service recording workflow for operators/managers.

Operational writes use database functions rather than trusting client-side calculations. Current machine hours cannot be reduced by a normal hours reading, and service records update the machine's current meter values without overwriting higher existing readings.

### Service data principle

A service task is not the same thing as a service record.

- Catalogue service task: what the manufacturer says should be inspected, lubricated, adjusted or replaced.
- Schedule rule: when that task is triggered.
- Machine service record: what actually happened to this customer's physical machine.

This separation is deliberate and must remain.

## AI Knowledge Engine

REELMOW will use AI as an extraction and reasoning layer, not as the source of truth.

Pipeline:

1. Discover — find manufacturer manuals, parts books, service manuals, specifications and official support pages.
2. Acquire — download and fingerprint the source document.
3. Parse — extract text, tables, images and page boundaries.
4. Identify — resolve manufacturer → family → model → variant → year/serial applicability.
5. Extract — AI proposes structured specifications, parts, service tasks and service rules.
6. Evidence — every proposed fact carries document/page evidence and an extraction confidence.
7. Validate — deterministic checks plus human review resolve conflicts and impossible values.
8. Publish — only validated facts become canonical REELMOW catalogue data.

AI output must never directly overwrite canonical catalogue records.

The database now includes ingestion.ai_runs for model/task/status/output/usage auditability. ingestion.extracted_facts remains the staging layer for proposed facts.

For AI extraction, prefer structured JSON Schema outputs so the model is constrained to the fields REELMOW expects. Keep the model/API key server-side in the ingestion worker or Edge Function; never put an OpenAI API key in the browser.

## Data quality rules

Before a machine record is published, REELMOW should aim to establish:

- manufacturer
- product family
- model
- exact variant/generation where applicable
- serial-number applicability where documented
- machine type
- dimensions and operating specifications
- engine/powertrain
- cutting system
- consumables and fluids where documented
- maintenance tasks
- service intervals and trigger conditions
- parts and fitments
- manuals and source documents
- page-level provenance
- confidence/status for every canonical fact
- conflicts between sources

A single source should not be assumed to describe every variant of a machine family. Variant-specific facts must be scoped to the correct variant whenever the source provides that distinction.

## Current verified LF3800 service seed

The Jacobsen LF3800 service seed is intentionally conservative. It uses the official Jacobsen Parts & Maintenance Manual as its source and publishes only maintenance items whose interval is sufficiently clear from the source. The manual identifies 50/100/250-hour lubrication groups and specific maintenance instructions including engine oil, fuel lines/clamps, battery electrolyte and annual wheel-bearing repacking.

Do not expand the seed with guessed intervals where the manual's table extraction is ambiguous. Those items should go through the ingestion/review pipeline instead.

## Production target

The next Garage builds are:

03 — Documents
- official/manual source viewer
- customer-uploaded documents
- page-level source references
- private storage

04 — Machine photos
- camera upload
- machine plate photos
- image metadata
- AI-assisted identification

05 — Scan/Add Machine
- photograph model/serial plate
- OCR
- catalogue candidate matching
- confidence + confirmation before creating the physical machine

06 — Catalogue ingestion
- manufacturer discovery
- PDF acquisition
- AI extraction
- deterministic validation
- review queue
- publish workflow

07 — Permissions and audit
- owner/admin/manager/operator separation
- append-only operational history where appropriate
- correction workflow
- audit trail

08 — Offline/PWA
- installable production app
- offline Garage access
- queued field updates
- sync/conflict handling

Pattern Studio / MOW remains deliberately outside this phase.
