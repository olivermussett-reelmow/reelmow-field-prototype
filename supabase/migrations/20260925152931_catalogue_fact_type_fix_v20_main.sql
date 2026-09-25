-- Migration-history reconciliation.
-- The live project contains this migration because the v20 correction was
-- applied once under a distinct migration name. v20 already performs the
-- idempotent data correction, so this file intentionally makes the repository
-- migration chain match the live history without applying a second mutation.
do $$
begin
  null;
end
$$;
