-- REELMOW FOUNDATION v0.2
-- Fresh-install baseline for Supabase/Postgres.
-- Principle: catalogue knowledge is shared/canonical; Garage is tenant-owned; ingestion proposes facts.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create schema if not exists private;
create schema if not exists catalogue;
create schema if not exists ingestion;
create schema if not exists garage;

-- ---------- enums ----------
do $$ begin create type catalogue.record_status as enum ('draft','active','legacy','archived'); exception when duplicate_object then null; end $$;
do $$ begin create type catalogue.confidence_level as enum ('verified','high','provisional','conflict','unknown'); exception when duplicate_object then null; end $$;
do $$ begin create type catalogue.source_kind as enum ('manufacturer_page','operator_manual','service_manual','parts_manual','parts_diagram','technical_spec','brochure','safety','warranty','dealer_document','other'); exception when duplicate_object then null; end $$;
do $$ begin create type catalogue.document_type as enum ('operator_manual','service_manual','parts_manual','parts_diagram','technical_spec','brochure','safety','warranty','other'); exception when duplicate_object then null; end $$;
do $$ begin create type catalogue.value_type as enum ('text','number','boolean','json'); exception when duplicate_object then null; end $$;
do $$ begin create type ingestion.job_status as enum ('queued','running','blocked','review','completed','failed','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type ingestion.fact_status as enum ('pending','accepted','rejected','superseded'); exception when duplicate_object then null; end $$;
do $$ begin create type garage.member_role as enum ('owner','admin','manager','operator','viewer'); exception when duplicate_object then null; end $$;
do $$ begin create type garage.machine_status as enum ('ready','service_due','in_service','out_of_service','retired'); exception when duplicate_object then null; end $$;

-- ---------- catalogue identity ----------
create table if not exists catalogue.manufacturers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  website_url text,
  country_code text,
  logo_url text,
  status catalogue.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists catalogue.product_families (
  id uuid primary key default gen_random_uuid(),
  manufacturer_id uuid not null references catalogue.manufacturers(id) on delete cascade,
  name text not null,
  slug text not null,
  machine_type text not null,
  description text,
  status catalogue.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(manufacturer_id, slug)
);

create table if not exists catalogue.machine_models (
  id uuid primary key default gen_random_uuid(),
  manufacturer_id uuid not null references catalogue.manufacturers(id) on delete cascade,
  product_family_id uuid not null references catalogue.product_families(id) on delete cascade,
  model_name text not null,
  model_code text,
  slug text not null,
  description text,
  production_start_year smallint check (production_start_year between 1800 and 2200),
  production_end_year smallint check (production_end_year between 1800 and 2200),
  status catalogue.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(manufacturer_id, slug)
);

create table if not exists catalogue.machine_variants (
  id uuid primary key default gen_random_uuid(),
  machine_model_id uuid not null references catalogue.machine_models(id) on delete cascade,
  variant_name text not null,
  variant_code text,
  serial_prefix text,
  serial_range text,
  year_start smallint check (year_start between 1800 and 2200),
  year_end smallint check (year_end between 1800 and 2200),
  notes text,
  confidence catalogue.confidence_level not null default 'unknown',
  status catalogue.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(machine_model_id, variant_name)
);

create index if not exists machine_models_name_trgm on catalogue.machine_models using gin(model_name gin_trgm_ops);
create index if not exists machine_variants_name_trgm on catalogue.machine_variants using gin(variant_name gin_trgm_ops);

-- ---------- provenance ----------
create table if not exists catalogue.sources (
  id uuid primary key default gen_random_uuid(),
  manufacturer_id uuid references catalogue.manufacturers(id) on delete set null,
  source_kind catalogue.source_kind not null,
  title text not null,
  canonical_url text,
  publisher text,
  publication_date date,
  retrieved_at timestamptz not null default now(),
  checksum_sha256 text,
  is_primary boolean not null default false,
  status catalogue.record_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists sources_canonical_url_unique on catalogue.sources(canonical_url) where canonical_url is not null;

create table if not exists catalogue.documents (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references catalogue.sources(id) on delete cascade,
  machine_model_id uuid references catalogue.machine_models(id) on delete set null,
  machine_variant_id uuid references catalogue.machine_variants(id) on delete set null,
  document_type catalogue.document_type not null,
  title text not null,
  storage_bucket text not null default 'reelmow-catalogue-source',
  storage_path text not null,
  mime_type text,
  file_size_bytes bigint,
  checksum_sha256 text not null,
  page_count integer check(page_count is null or page_count > 0),
  extraction_status text not null default 'pending' check(extraction_status in ('pending','processing','complete','failed','needs_ocr')),
  ocr_required boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(checksum_sha256)
);

create table if not exists catalogue.document_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references catalogue.documents(id) on delete cascade,
  page_number integer not null check(page_number > 0),
  extracted_text text,
  text_search tsvector generated always as(to_tsvector('simple', coalesce(extracted_text,''))) stored,
  image_storage_path text,
  extraction_method text,
  created_at timestamptz not null default now(),
  unique(document_id,page_number)
);
create index if not exists document_pages_search_idx on catalogue.document_pages using gin(text_search);

-- ---------- typed canonical facts ----------
create table if not exists catalogue.spec_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  value_type catalogue.value_type not null,
  default_unit text,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists catalogue.facts (
  id uuid primary key default gen_random_uuid(),
  machine_model_id uuid references catalogue.machine_models(id) on delete cascade,
  machine_variant_id uuid references catalogue.machine_variants(id) on delete cascade,
  spec_definition_id uuid not null references catalogue.spec_definitions(id) on delete restrict,
  value_text text,
  value_number numeric,
  value_boolean boolean,
  value_json jsonb,
  unit text,
  normalized_number numeric,
  normalized_unit text,
  confidence catalogue.confidence_level not null default 'unknown',
  status catalogue.record_status not null default 'draft',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(num_nonnulls(value_text,value_number,value_boolean,value_json)=1),
  check(machine_model_id is not null or machine_variant_id is not null)
);

create unique index if not exists facts_model_key_unique on catalogue.facts(machine_model_id,spec_definition_id) where machine_model_id is not null and machine_variant_id is null and status <> 'archived';
create unique index if not exists facts_variant_key_unique on catalogue.facts(machine_variant_id,spec_definition_id) where machine_variant_id is not null and status <> 'archived';

create table if not exists catalogue.fact_sources (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid not null references catalogue.facts(id) on delete cascade,
  source_id uuid not null references catalogue.sources(id) on delete cascade,
  document_id uuid references catalogue.documents(id) on delete set null,
  document_page_id uuid references catalogue.document_pages(id) on delete set null,
  source_locator text,
  excerpt text,
  evidence_hash text,
  created_at timestamptz not null default now(),
  unique(fact_id,source_id,document_page_id,source_locator)
);

-- ---------- parts/service knowledge ----------
create table if not exists catalogue.parts (
  id uuid primary key default gen_random_uuid(),
  manufacturer_id uuid references catalogue.manufacturers(id) on delete set null,
  part_number text not null,
  name text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  status catalogue.record_status not null default 'active',
  created_at timestamptz not null default now(),
  unique(manufacturer_id,part_number)
);

create table if not exists catalogue.part_fitments (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references catalogue.parts(id) on delete cascade,
  machine_variant_id uuid not null references catalogue.machine_variants(id) on delete cascade,
  fitment_notes text,
  confidence catalogue.confidence_level not null default 'unknown',
  source_id uuid references catalogue.sources(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(part_id,machine_variant_id)
);

create table if not exists catalogue.service_tasks (
  id uuid primary key default gen_random_uuid(),
  machine_variant_id uuid not null references catalogue.machine_variants(id) on delete cascade,
  task_key text not null,
  task_name text not null,
  instructions text,
  safety_notes text,
  confidence catalogue.confidence_level not null default 'unknown',
  source_id uuid references catalogue.sources(id) on delete set null,
  source_page integer,
  status catalogue.record_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(machine_variant_id,task_key)
);

create table if not exists catalogue.service_schedule_rules (
  id uuid primary key default gen_random_uuid(),
  service_task_id uuid not null references catalogue.service_tasks(id) on delete cascade,
  interval_engine_hours numeric,
  interval_reel_hours numeric,
  interval_calendar_days integer,
  trigger_description text,
  source_id uuid references catalogue.sources(id) on delete set null,
  confidence catalogue.confidence_level not null default 'unknown',
  status catalogue.record_status not null default 'draft',
  created_at timestamptz not null default now(),
  check(interval_engine_hours is not null or interval_reel_hours is not null or interval_calendar_days is not null or trigger_description is not null),
  check(interval_engine_hours is null or interval_engine_hours >= 0),
  check(interval_reel_hours is null or interval_reel_hours >= 0),
  check(interval_calendar_days is null or interval_calendar_days >= 0)
);

-- ---------- ingestion ----------
create table if not exists ingestion.jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  requested_url text,
  manufacturer_id uuid references catalogue.manufacturers(id) on delete set null,
  status ingestion.job_status not null default 'queued',
  attempt_count integer not null default 0 check(attempt_count >= 0),
  error_code text,
  error_message text,
  idempotency_key text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists ingestion.job_documents (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ingestion.jobs(id) on delete cascade,
  document_id uuid references catalogue.documents(id) on delete set null,
  source_url text,
  http_status integer,
  content_type text,
  content_length bigint,
  content_sha256 text,
  fetch_status text not null default 'pending' check(fetch_status in ('pending','fetched','duplicate','failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(job_id,source_url)
);

create table if not exists ingestion.extracted_facts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ingestion.jobs(id) on delete cascade,
  document_id uuid references catalogue.documents(id) on delete set null,
  document_page_id uuid references catalogue.document_pages(id) on delete set null,
  entity_type text not null check(entity_type in ('manufacturer','family','model','variant','specification','part','service_task','service_rule')),
  entity_id uuid,
  field_key text not null,
  raw_value text not null,
  normalized_value jsonb,
  unit text,
  confidence_score numeric(5,4) check(confidence_score between 0 and 1),
  extraction_method text not null default 'unknown',
  status ingestion.fact_status not null default 'pending',
  reviewer_notes text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);

create table if not exists ingestion.review_queue (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid not null references ingestion.extracted_facts(id) on delete cascade,
  priority integer not null default 100,
  reason text not null,
  assigned_to uuid references auth.users(id) on delete set null,
  status text not null default 'open' check(status in ('open','in_review','resolved','dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- ---------- garage / tenant ----------
create table if not exists garage.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists garage.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references garage.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role garage.member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  unique(organization_id,user_id)
);

create table if not exists garage.garages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references garage.organizations(id) on delete cascade,
  name text not null,
  location_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,name)
);

create table if not exists garage.machines (
  id uuid primary key default gen_random_uuid(),
  garage_id uuid not null references garage.garages(id) on delete cascade,
  machine_variant_id uuid references catalogue.machine_variants(id) on delete set null,
  serial_number text,
  asset_number text,
  nickname text,
  purchase_date date,
  purchase_price numeric(12,2) check(purchase_price is null or purchase_price >= 0),
  current_engine_hours numeric(12,2) check(current_engine_hours is null or current_engine_hours >= 0),
  current_reel_hours numeric(12,2) check(current_reel_hours is null or current_reel_hours >= 0),
  status garage.machine_status not null default 'ready',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists machines_serial_trgm on garage.machines using gin(serial_number gin_trgm_ops);
create index if not exists machines_asset_idx on garage.machines(asset_number);

create table if not exists garage.machine_hours_log (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references garage.machines(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  engine_hours numeric(12,2),
  reel_hours numeric(12,2),
  source text not null default 'manual',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  check(engine_hours is not null or reel_hours is not null),
  check(engine_hours is null or engine_hours >= 0),
  check(reel_hours is null or reel_hours >= 0)
);

create table if not exists garage.machine_service_records (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references garage.machines(id) on delete cascade,
  service_task_id uuid references catalogue.service_tasks(id) on delete set null,
  serviced_at timestamptz not null default now(),
  engine_hours numeric(12,2),
  reel_hours numeric(12,2),
  performed_by text,
  cost numeric(12,2) check(cost is null or cost >= 0),
  notes text,
  invoice_storage_path text,
  evidence jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check(engine_hours is null or engine_hours >= 0),
  check(reel_hours is null or reel_hours >= 0)
);

create table if not exists garage.machine_documents (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references garage.machines(id) on delete cascade,
  title text not null,
  document_type text not null,
  storage_bucket text not null default 'reelmow-garage-private',
  storage_path text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists garage.machine_photos (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references garage.machines(id) on delete cascade,
  storage_bucket text not null default 'reelmow-garage-private',
  storage_path text not null,
  caption text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists memberships_user_idx on garage.memberships(user_id);
create index if not exists machines_garage_idx on garage.machines(garage_id);
create index if not exists machines_variant_idx on garage.machines(machine_variant_id);
create index if not exists machine_hours_machine_idx on garage.machine_hours_log(machine_id, recorded_at desc);
create index if not exists service_records_machine_idx on garage.machine_service_records(machine_id, serviced_at desc, created_at desc);
create index if not exists service_records_task_idx on garage.machine_service_records(service_task_id);
create index if not exists machine_documents_machine_idx on garage.machine_documents(machine_id);
create index if not exists machine_photos_machine_idx on garage.machine_photos(machine_id);

-- ---------- security helpers ----------
create or replace function private.is_org_member(target_org uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists(select 1 from garage.memberships m where m.organization_id=target_org and m.user_id=(select auth.uid()));
$$;

create or replace function private.has_org_role(target_org uuid, allowed_roles garage.member_role[])
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists(select 1 from garage.memberships m where m.organization_id=target_org and m.user_id=(select auth.uid()) and m.role = any(allowed_roles));
$$;

revoke all on function private.is_org_member(uuid) from public;
revoke all on function private.has_org_role(uuid,garage.member_role[]) from public;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid,garage.member_role[]) to authenticated;

-- ---------- organisation bootstrap ----------
create or replace function garage.create_organization(org_name text, org_slug text)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  new_org uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;
  insert into garage.organizations(name,slug,created_by)
  values(org_name,org_slug,(select auth.uid()))
  returning id into new_org;
  insert into garage.memberships(organization_id,user_id,role)
  values(new_org,(select auth.uid()),'owner');
  return new_org;
end;
$$;
revoke all on function garage.create_organization(text,text) from public;
grant execute on function garage.create_organization(text,text) to authenticated;

-- ---------- timestamps ----------
create or replace function private.touch_updated_at() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=now(); return new; end; $$;
revoke all on function private.touch_updated_at() from public;

do $$ declare r record; begin
  for r in select table_schema,table_name from information_schema.columns where column_name='updated_at' and table_schema in ('catalogue','ingestion','garage') loop
    execute format('drop trigger if exists touch_updated_at on %I.%I',r.table_schema,r.table_name);
    execute format('create trigger touch_updated_at before update on %I.%I for each row execute function private.touch_updated_at()',r.table_schema,r.table_name);
  end loop;
end $$;

-- ---------- catalogue RLS: authenticated read only ----------
do $$ declare r record; begin
  for r in select table_schema,table_name from information_schema.tables where table_schema='catalogue' and table_type='BASE TABLE' loop
    execute format('alter table %I.%I enable row level security',r.table_schema,r.table_name);
    execute format('revoke all on table %I.%I from anon,authenticated',r.table_schema,r.table_name);
    execute format('grant select on table %I.%I to authenticated',r.table_schema,r.table_name);
    execute format('drop policy if exists catalogue_read on %I.%I',r.table_schema,r.table_name);
    execute format('create policy catalogue_read on %I.%I for select to authenticated using (true)',r.table_schema,r.table_name);
  end loop;
end $$;

-- ---------- ingestion: trusted backend only ----------
do $$ declare r record; begin
  for r in select table_schema,table_name from information_schema.tables where table_schema='ingestion' and table_type='BASE TABLE' loop
    execute format('alter table %I.%I enable row level security',r.table_schema,r.table_name);
    execute format('revoke all on table %I.%I from anon,authenticated',r.table_schema,r.table_name);
  end loop;
end $$;

-- ---------- garage RLS ----------
do $$ declare r record; begin
  for r in select table_schema,table_name from information_schema.tables where table_schema='garage' and table_type='BASE TABLE' loop
    execute format('alter table %I.%I enable row level security',r.table_schema,r.table_name);
    execute format('revoke all on table %I.%I from anon,authenticated',r.table_schema,r.table_name);
    execute format('grant select,insert,update,delete on table %I.%I to authenticated',r.table_schema,r.table_name);
  end loop;
end $$;

-- Organizations
create policy org_read on garage.organizations for select to authenticated using (private.is_org_member(id));
create policy org_insert on garage.organizations for insert to authenticated with check (created_by=(select auth.uid()));
create policy org_update on garage.organizations for update to authenticated using(private.has_org_role(id,array['owner','admin']::garage.member_role[])) with check(private.has_org_role(id,array['owner','admin']::garage.member_role[]));
create policy org_delete on garage.organizations for delete to authenticated using(private.has_org_role(id,array['owner']::garage.member_role[]));

-- Memberships: users can see their own membership; managers/admins can manage memberships.
create policy membership_read on garage.memberships for select to authenticated using(user_id=(select auth.uid()) or private.has_org_role(organization_id,array['owner','admin','manager']::garage.member_role[]));
create policy membership_insert on garage.memberships for insert to authenticated with check(private.has_org_role(organization_id,array['owner','admin']::garage.member_role[]));
create policy membership_update on garage.memberships for update to authenticated using(private.has_org_role(organization_id,array['owner','admin']::garage.member_role[])) with check(private.has_org_role(organization_id,array['owner','admin']::garage.member_role[]));
create policy membership_delete on garage.memberships for delete to authenticated using(private.has_org_role(organization_id,array['owner','admin']::garage.member_role[]));

-- Garages
create policy garage_read on garage.garages for select to authenticated using(private.is_org_member(organization_id));
create policy garage_insert on garage.garages for insert to authenticated with check(private.has_org_role(organization_id,array['owner','admin','manager']::garage.member_role[]));
create policy garage_update on garage.garages for update to authenticated using(private.has_org_role(organization_id,array['owner','admin','manager']::garage.member_role[])) with check(private.has_org_role(organization_id,array['owner','admin','manager']::garage.member_role[]));
create policy garage_delete on garage.garages for delete to authenticated using(private.has_org_role(organization_id,array['owner','admin']::garage.member_role[]));

-- Machines and child records resolve tenant through garage_id/machine_id.
create policy machine_read on garage.machines for select to authenticated using(exists(select 1 from garage.garages g where g.id=garage_id and private.is_org_member(g.organization_id)));
create policy machine_insert on garage.machines for insert to authenticated with check(exists(select 1 from garage.garages g where g.id=garage_id and private.has_org_role(g.organization_id,array['owner','admin','manager','operator']::garage.member_role[])));
create policy machine_update on garage.machines for update to authenticated using(exists(select 1 from garage.garages g where g.id=garage_id and private.has_org_role(g.organization_id,array['owner','admin','manager','operator']::garage.member_role[]))) with check(exists(select 1 from garage.garages g where g.id=garage_id and private.has_org_role(g.organization_id,array['owner','admin','manager','operator']::garage.member_role[])));
create policy machine_delete on garage.machines for delete to authenticated using(exists(select 1 from garage.garages g where g.id=garage_id and private.has_org_role(g.organization_id,array['owner','admin','manager']::garage.member_role[])));

create policy hours_read on garage.machine_hours_log for select to authenticated using(exists(select 1 from garage.machines m join garage.garages g on g.id=m.garage_id where m.id=machine_id and private.is_org_member(g.organization_id)));
create policy hours_write on garage.machine_hours_log for all to authenticated using(exists(select 1 from garage.machines m join garage.garages g on g.id=m.garage_id where m.id=machine_id and private.has_org_role(g.organization_id,array['owner','admin','manager','operator']::garage.member_role[]))) with check(exists(select 1 from garage.machines m join garage.garages g on g.id=m.garage_id where m.id=machine_id and private.has_org_role(g.organization_id,array['owner','admin','manager','operator']::garage.member_role[])));

create policy service_read on garage.machine_service_records for select to authenticated using(exists(select 1 from garage.machines m join garage.garages g on g.id=m.garage_id where m.id=machine_id and private.is_org_member(g.organization_id)));
create policy service_write on garage.machine_service_records for all to authenticated using(exists(select 1 from garage.machines m join garage.garages g on g.id=m.garage_id where m.id=machine_id and private.has_org_role(g.organization_id,array['owner','admin','manager','operator']::garage.member_role[]))) with check(exists(select 1 from garage.machines m join garage.garages g on g.id=m.garage_id where m.id=machine_id and private.has_org_role(g.organization_id,array['owner','admin','manager','operator']::garage.member_role[])));

create policy docs_read on garage.machine_documents for select to authenticated using(exists(select 1 from garage.machines m join garage.garages g on g.id=m.garage_id where m.id=machine_id and private.is_org_member(g.organization_id)));
create policy docs_write on garage.machine_documents for all to authenticated using(exists(select 1 from garage.machines m join garage.garages g on g.id=m.garage_id where m.id=machine_id and private.has_org_role(g.organization_id,array['owner','admin','manager','operator']::garage.member_role[]))) with check(exists(select 1 from garage.machines m join garage.garages g on g.id=m.garage_id where m.id=machine_id and private.has_org_role(g.organization_id,array['owner','admin','manager','operator']::garage.member_role[])));

create policy photos_read on garage.machine_photos for select to authenticated using(exists(select 1 from garage.machines m join garage.garages g on g.id=m.garage_id where m.id=machine_id and private.is_org_member(g.organization_id)));
create policy photos_write on garage.machine_photos for all to authenticated using(exists(select 1 from garage.machines m join garage.garages g on g.id=m.garage_id where m.id=machine_id and private.has_org_role(g.organization_id,array['owner','admin','manager','operator']::garage.member_role[]))) with check(exists(select 1 from garage.machines m join garage.garages g on g.id=m.garage_id where m.id=machine_id and private.has_org_role(g.organization_id,array['owner','admin','manager','operator']::garage.member_role[])));

-- ---------- search / operational views ----------
create or replace view catalogue.machine_search with (security_invoker = true) as
select mm.id model_id, mm.model_name, mm.model_code, mm.slug model_slug,
       m.id manufacturer_id, m.name manufacturer_name, m.slug manufacturer_slug,
       pf.id family_id, pf.name family_name, pf.machine_type,
       mv.id variant_id, mv.variant_name, mv.variant_code, mv.confidence variant_confidence
from catalogue.machine_models mm
join catalogue.manufacturers m on m.id=mm.manufacturer_id
join catalogue.product_families pf on pf.id=mm.product_family_id
left join catalogue.machine_variants mv on mv.machine_model_id=mm.id and mv.status='active'
where mm.status in ('draft','active','legacy') and m.status in ('draft','active','legacy');

create or replace function catalogue.search_machines(search_text text, result_limit integer default 20)
returns table(model_id uuid, manufacturer_name text, model_name text, variant_id uuid, variant_name text, machine_type text, rank real)
language sql stable security invoker set search_path=''
as $$
  select s.model_id,s.manufacturer_name,s.model_name,s.variant_id,s.variant_name,s.machine_type,
         greatest(public.similarity(s.model_name,search_text),public.similarity(coalesce(s.variant_name,''),search_text),public.similarity(s.manufacturer_name,search_text)) as rank
  from catalogue.machine_search s
  where s.model_name ilike '%'||search_text||'%' or s.variant_name ilike '%'||search_text||'%' or s.manufacturer_name ilike '%'||search_text||'%'
  order by rank desc, s.manufacturer_name, s.model_name
  limit greatest(1,least(result_limit,100));
$$;

create or replace view garage.machine_service_summary with (security_invoker = true) as
select m.id machine_id, m.garage_id, m.machine_variant_id, m.current_engine_hours, m.current_reel_hours,
       ls.serviced_at last_service_at, ls.engine_hours last_service_engine_hours, ls.reel_hours last_service_reel_hours,
       count(msr.id) service_count
from garage.machines m
left join lateral (
  select x.serviced_at, x.engine_hours, x.reel_hours
  from garage.machine_service_records x
  where x.machine_id=m.id
  order by x.serviced_at desc, x.created_at desc
  limit 1
) ls on true
left join garage.machine_service_records msr on msr.machine_id=m.id
group by m.id,m.garage_id,m.machine_variant_id,m.current_engine_hours,m.current_reel_hours,
         ls.serviced_at,ls.engine_hours,ls.reel_hours;

-- ---------- machine profile / service due ----------
create or replace view garage.machine_catalogue_profile with (security_invoker = true) as
select m.id machine_id, m.garage_id, m.serial_number, m.asset_number, m.nickname, m.status,
       mv.id variant_id, mv.variant_name, mm.id model_id, mm.model_name, mm.model_code,
       mf.id manufacturer_id, mf.name manufacturer_name, pf.name family_name, pf.machine_type,
       m.current_engine_hours, m.current_reel_hours
from garage.machines m
left join catalogue.machine_variants mv on mv.id=m.machine_variant_id
left join catalogue.machine_models mm on mm.id=mv.machine_model_id
left join catalogue.manufacturers mf on mf.id=mm.manufacturer_id
left join catalogue.product_families pf on pf.id=mm.product_family_id;

create or replace view garage.machine_service_due with (security_invoker = true) as
select m.id machine_id, st.id service_task_id, st.task_name,
       m.current_engine_hours, m.current_reel_hours,
       ssr.interval_engine_hours, ssr.interval_reel_hours, ssr.interval_calendar_days,
       ls.serviced_at last_serviced_at, ls.engine_hours last_service_engine_hours, ls.reel_hours last_service_reel_hours,
       case
         when ssr.interval_engine_hours is not null and m.current_engine_hours is not null
           then coalesce(ls.engine_hours,0) + ssr.interval_engine_hours - m.current_engine_hours
         else null
       end as engine_hours_remaining,
       case
         when ssr.interval_reel_hours is not null and m.current_reel_hours is not null
           then coalesce(ls.reel_hours,0) + ssr.interval_reel_hours - m.current_reel_hours
         else null
       end as reel_hours_remaining,
       case
         when ssr.interval_calendar_days is not null
           then (coalesce(ls.serviced_at, m.created_at) + make_interval(days => ssr.interval_calendar_days))::date
         else null
       end as calendar_due_date
from garage.machines m
join catalogue.machine_variants mv on mv.id=m.machine_variant_id
join catalogue.service_tasks st on st.machine_variant_id=mv.id and st.status='active'
join lateral (select r.* from catalogue.service_schedule_rules r where r.service_task_id=st.id and r.status='active' order by r.created_at desc limit 1) ssr on true
left join lateral (select x.* from garage.machine_service_records x where x.machine_id=m.id and x.service_task_id=st.id order by x.serviced_at desc limit 1) ls on true;

-- ---------- grants ----------
grant usage on schema catalogue,garage to authenticated;
grant select on catalogue.machine_search to authenticated;
grant execute on function catalogue.search_machines(text,integer) to authenticated;
grant select on garage.machine_service_summary to authenticated;
grant select on garage.machine_catalogue_profile to authenticated;
grant select on garage.machine_service_due to authenticated;

-- Do not grant ingestion schema to client roles.
revoke all on schema ingestion from anon,authenticated;
-- REELMOW Golden Machine seed: Jacobsen LF3800.
-- Conservative seed: source identity is established; facts are linked to the source.
-- Exact physical variant/serial configuration must be confirmed against the customer's machine plate.

insert into catalogue.manufacturers(name,slug,website_url)
values('Jacobsen','jacobsen','https://www.jacobsen.com')
on conflict(slug) do update set website_url=excluded.website_url;

insert into catalogue.product_families(manufacturer_id,name,slug,machine_type)
select id,'LF Series','lf-series','Cylinder Mower' from catalogue.manufacturers where slug='jacobsen'
on conflict(manufacturer_id,slug) do nothing;

insert into catalogue.machine_models(manufacturer_id,product_family_id,model_name,model_code,slug,description)
select m.id,pf.id,'LF3800','LF3800','lf3800','Five-gang cylinder mower used as the REELMOW golden vertical slice.'
from catalogue.manufacturers m join catalogue.product_families pf on pf.manufacturer_id=m.id and pf.slug='lf-series'
where m.slug='jacobsen'
on conflict(manufacturer_id,slug) do nothing;

insert into catalogue.machine_variants(machine_model_id,variant_name,confidence)
select id,'LF3800 5-Gang','provisional' from catalogue.machine_models where slug='lf3800'
on conflict(machine_model_id,variant_name) do nothing;

insert into catalogue.spec_definitions(key,label,value_type,default_unit) values
('cutting_width','Cutting width','number','m'),
('reel_count','Number of reels','number','count'),
('reel_diameter','Reel diameter','number','mm'),
('reel_width','Reel width','number','mm'),
('reel_blades','Reel blades','text',null),
('height_of_cut_min','Minimum height of cut','number','mm'),
('height_of_cut_max','Maximum height of cut','number','mm'),
('fuel','Fuel','text',null),
('engine','Engine','text',null)
on conflict(key) do nothing;

insert into catalogue.sources(manufacturer_id,source_kind,title,canonical_url,publisher,is_primary)
select id,'operator_manual','Jacobsen LF3800 Operator Manual','https://www.jacobsen.com/manuals/4129587_205_a.pdf','Jacobsen',true
from catalogue.manufacturers where slug='jacobsen'
on conflict do nothing;

-- Facts are inserted as VERIFIED only after the source document has been reviewed.
-- These values are the current golden-machine reference values used by the REELMOW prototype.
with refs as (
  select mm.id model_id,mv.id variant_id,s.id source_id
  from catalogue.machine_models mm
  join catalogue.machine_variants mv on mv.machine_model_id=mm.id and mv.variant_name='LF3800 5-Gang'
  join catalogue.sources s on s.canonical_url='https://www.jacobsen.com/manuals/4129587_205_a.pdf'
  where mm.slug='lf3800'
), vals(key,value_number,unit,normalized_number,normalized_unit) as (
  values ('cutting_width',2.54,'m',2.54,'m'),('reel_count',5,'count',5,'count'),('reel_diameter',178,'mm',178,'mm'),('reel_width',559,'mm',559,'mm'),('height_of_cut_min',9.5,'mm',9.5,'mm'),('height_of_cut_max',29,'mm',29,'mm')
)
insert into catalogue.facts(machine_model_id,spec_definition_id,value_number,unit,normalized_number,normalized_unit,confidence,status)
select refs.model_id,sd.id,vals.value_number,vals.unit,vals.normalized_number,vals.normalized_unit,'high','active'
from refs join vals on true join catalogue.spec_definitions sd on sd.key=vals.key
on conflict do nothing;

insert into catalogue.facts(machine_model_id,spec_definition_id,value_text,confidence,status)
select mm.id,sd.id,'9 or 11','high','active'
from catalogue.machine_models mm join catalogue.spec_definitions sd on sd.key='reel_blades'
where mm.slug='lf3800'
on conflict do nothing;

insert into catalogue.facts(machine_model_id,spec_definition_id,value_text,confidence,status)
select mm.id,sd.id,'Diesel','high','active'
from catalogue.machine_models mm join catalogue.spec_definitions sd on sd.key='fuel'
where mm.slug='lf3800'
on conflict do nothing;

insert into catalogue.facts(machine_model_id,spec_definition_id,value_text,confidence,status)
select mm.id,sd.id,'Kubota','high','active'
from catalogue.machine_models mm join catalogue.spec_definitions sd on sd.key='engine'
where mm.slug='lf3800'
on conflict do nothing;

-- Source references establish provenance; page locators are intentionally left null until document ingestion records page numbering.
insert into catalogue.fact_sources(fact_id,source_id,source_locator)
select f.id,s.id,'seed:golden-machine-reference'
from catalogue.facts f
join catalogue.sources s on s.canonical_url='https://www.jacobsen.com/manuals/4129587_205_a.pdf'
join catalogue.machine_models mm on mm.id=f.machine_model_id and mm.slug='lf3800'
where not exists(select 1 from catalogue.fact_sources fs where fs.fact_id=f.id and fs.source_id=s.id);
-- Storage policies for the v0.2 model.
-- Run after the buckets have been created in Supabase Storage.
-- Catalogue documents: authenticated users may read; backend/service role writes.

insert into storage.buckets (id,name,public)
values ('reelmow-catalogue-source','reelmow-catalogue-source',false)
on conflict (id) do nothing;

insert into storage.buckets (id,name,public)
values ('reelmow-garage-private','reelmow-garage-private',false)
on conflict (id) do nothing;

create policy "catalogue source read"
on storage.objects for select to authenticated
using (bucket_id='reelmow-catalogue-source');

-- Garage object paths must be:
-- org/<organization_uuid>/machine/<machine_uuid>/...
create policy "garage object read"
on storage.objects for select to authenticated
using (
  bucket_id='reelmow-garage-private'
  and (storage.foldername(name))[1]='org'
  and private.is_org_member(((storage.foldername(name))[2])::uuid)
);

create policy "garage object insert"
on storage.objects for insert to authenticated
with check (
  bucket_id='reelmow-garage-private'
  and (storage.foldername(name))[1]='org'
  and private.has_org_role(((storage.foldername(name))[2])::uuid,array['owner','admin','manager','operator']::garage.member_role[])
);

create policy "garage object update"
on storage.objects for update to authenticated
using (
  bucket_id='reelmow-garage-private'
  and (storage.foldername(name))[1]='org'
  and private.has_org_role(((storage.foldername(name))[2])::uuid,array['owner','admin','manager','operator']::garage.member_role[])
)
with check (
  bucket_id='reelmow-garage-private'
  and (storage.foldername(name))[1]='org'
  and private.has_org_role(((storage.foldername(name))[2])::uuid,array['owner','admin','manager','operator']::garage.member_role[])
);

create policy "garage object delete"
on storage.objects for delete to authenticated
using (
  bucket_id='reelmow-garage-private'
  and (storage.foldername(name))[1]='org'
  and private.has_org_role(((storage.foldername(name))[2])::uuid,array['owner','admin','manager']::garage.member_role[])
);