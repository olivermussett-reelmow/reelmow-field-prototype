-- REELMOW Garage v0.4
-- Documents, photos, audit trail and stricter operational permissions.

begin;

-- ---------- richer Garage evidence ----------
alter table garage.machine_documents
  add column if not exists mime_type text,
  add column if not exists file_size_bytes bigint check(file_size_bytes is null or file_size_bytes >= 0),
  add column if not exists source text not null default 'upload',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table garage.machine_photos
  add column if not exists mime_type text,
  add column if not exists file_size_bytes bigint check(file_size_bytes is null or file_size_bytes >= 0),
  add column if not exists captured_at timestamptz,
  add column if not exists photo_type text not null default 'machine',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- ---------- operational audit ----------
create table if not exists garage.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references garage.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_org_idx on garage.audit_events(organization_id, created_at desc);
create index if not exists audit_events_entity_idx on garage.audit_events(entity_type, entity_id, created_at desc);

alter table garage.audit_events enable row level security;

create policy audit_read on garage.audit_events
for select to authenticated
using(private.has_org_role(organization_id,array['owner','admin','manager']::garage.member_role[]));

-- Audit events should be written by trusted database functions, not directly by browsers.
revoke all on garage.audit_events from authenticated;

-- ---------- stricter operational history ----------
drop policy if exists hours_write on garage.machine_hours_log;
drop policy if exists service_write on garage.machine_service_records;

-- Hours and service records are created through trusted RPCs.
-- There is deliberately no direct INSERT/UPDATE/DELETE policy for authenticated users.
-- This prevents the browser from bypassing monotonic-hour and service-task validation.

-- ---------- safer document/photo permissions ----------
drop policy if exists docs_write on garage.machine_documents;
create policy docs_insert on garage.machine_documents
for insert to authenticated
with check (
  exists(
    select 1
    from garage.machines m
    join garage.garages g on g.id=m.garage_id
    where m.id=machine_id
      and private.has_org_role(g.organization_id,array['owner','admin','manager','operator']::garage.member_role[])
  )
);
create policy docs_update on garage.machine_documents
for update to authenticated
using (
  exists(
    select 1
    from garage.machines m
    join garage.garages g on g.id=m.garage_id
    where m.id=machine_id
      and private.has_org_role(g.organization_id,array['owner','admin','manager']::garage.member_role[])
  )
)
with check (
  exists(
    select 1
    from garage.machines m
    join garage.garages g on g.id=m.garage_id
    where m.id=machine_id
      and private.has_org_role(g.organization_id,array['owner','admin','manager']::garage.member_role[])
  )
);
create policy docs_delete on garage.machine_documents
for delete to authenticated
using (
  exists(
    select 1
    from garage.machines m
    join garage.garages g on g.id=m.garage_id
    where m.id=machine_id
      and private.has_org_role(g.organization_id,array['owner','admin','manager']::garage.member_role[])
  )
);

drop policy if exists photos_write on garage.machine_photos;
create policy photos_insert on garage.machine_photos
for insert to authenticated
with check (
  exists(
    select 1
    from garage.machines m
    join garage.garages g on g.id=m.garage_id
    where m.id=machine_id
      and private.has_org_role(g.organization_id,array['owner','admin','manager','operator']::garage.member_role[])
  )
);
create policy photos_update on garage.machine_photos
for update to authenticated
using (
  exists(
    select 1
    from garage.machines m
    join garage.garages g on g.id=m.garage_id
    where m.id=machine_id
      and private.has_org_role(g.organization_id,array['owner','admin','manager']::garage.member_role[])
  )
)
with check (
  exists(
    select 1
    from garage.machines m
    join garage.garages g on g.id=m.garage_id
    where m.id=machine_id
      and private.has_org_role(g.organization_id,array['owner','admin','manager']::garage.member_role[])
  )
);
create policy photos_delete on garage.machine_photos
for delete to authenticated
using (
  exists(
    select 1
    from garage.machines m
    join garage.garages g on g.id=m.garage_id
    where m.id=machine_id
      and private.has_org_role(g.organization_id,array['owner','admin','manager']::garage.member_role[])
  )
);

commit;
