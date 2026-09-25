-- RLS policies call these SECURITY DEFINER helpers in the private schema.
-- Authenticated users need EXECUTE on the wrapper functions; the functions
-- themselves remain SECURITY DEFINER with an empty search_path.
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, garage.member_role[]) to authenticated;
