-- REELMOW machine fault / issue tracking.
-- This migration is already applied to the production Supabase project as
-- reelmow_machine_faults_v21. It is committed here to keep the repository
-- migration history reproducible.

create table if not exists garage.machine_faults (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references garage.machines(id) on delete cascade,
  severity text not null default 'medium'
    check (severity = any (array['low','medium','high','critical'])),
  status text not null default 'open'
    check (status = any (array['open','acknowledged','resolved'])),
  description text not null
    check (length(btrim(description)) >= 2 and length(btrim(description)) <= 4000),
  reported_by uuid references auth.users(id),
  reported_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_notes text,
  evidence_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists machine_faults_machine_status_idx
  on garage.machine_faults(machine_id, status);

create index if not exists machine_faults_reported_at_idx
  on garage.machine_faults(reported_at desc);

alter table garage.machine_faults enable row level security;

drop policy if exists fault_read on garage.machine_faults;
create policy fault_read on garage.machine_faults
for select to authenticated
using (
  exists (
    select 1 from garage.machines m
    join garage.garages g on g.id = m.garage_id
    where m.id = machine_faults.machine_id
      and private.is_org_member(g.organization_id)
  )
);

drop policy if exists fault_insert on garage.machine_faults;
create policy fault_insert on garage.machine_faults
for insert to authenticated
with check (
  exists (
    select 1 from garage.machines m
    join garage.garages g on g.id = m.garage_id
    where m.id = machine_faults.machine_id
      and private.has_org_role(g.organization_id, array['owner','admin','manager','operator']::garage.member_role[])
  )
  and (reported_by is null or reported_by = auth.uid())
);

drop policy if exists fault_update on garage.machine_faults;
create policy fault_update on garage.machine_faults
for update to authenticated
using (
  exists (
    select 1 from garage.machines m
    join garage.garages g on g.id = m.garage_id
    where m.id = machine_faults.machine_id
      and private.has_org_role(g.organization_id, array['owner','admin','manager','operator']::garage.member_role[])
  )
)
with check (
  exists (
    select 1 from garage.machines m
    join garage.garages g on g.id = m.garage_id
    where m.id = machine_faults.machine_id
      and private.has_org_role(g.organization_id, array['owner','admin','manager','operator']::garage.member_role[])
  )
);

drop policy if exists fault_delete on garage.machine_faults;
create policy fault_delete on garage.machine_faults
for delete to authenticated
using (
  exists (
    select 1 from garage.machines m
    join garage.garages g on g.id = m.garage_id
    where m.id = machine_faults.machine_id
      and private.has_org_role(g.organization_id, array['owner','admin']::garage.member_role[])
  )
);
