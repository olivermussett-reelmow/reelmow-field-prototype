-- REELMOW Garage machine profile enrichment
-- Adds warranty and ownership metadata to the physical machine record.
alter table garage.machines
  add column if not exists warranty_start_date date,
  add column if not exists warranty_end_date date,
  add column if not exists warranty_provider text,
  add column if not exists ownership_type text,
  add column if not exists ownership_name text;

alter table garage.machines
  drop constraint if exists machines_ownership_type_check;

alter table garage.machines
  add constraint machines_ownership_type_check
  check (ownership_type is null or ownership_type in ('owned','leased','hired','loaned','other'));
