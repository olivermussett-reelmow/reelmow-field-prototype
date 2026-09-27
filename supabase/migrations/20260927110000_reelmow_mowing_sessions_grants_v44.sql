-- V44: expose mowing session tables to authenticated clients while retaining RLS as the security boundary.
grant select, insert, update, delete on table garage.mowing_sessions to authenticated;
grant select, insert, delete on table garage.mowing_track_points to authenticated;
