-- ============================================================================
-- trck — 0016 · PostgREST API privileges
-- ============================================================================
-- RLS policies decide which rows authenticated users may access, but PostgreSQL
-- table privileges are checked before RLS. Objects created by the migration
-- role are not automatically exposed to PostgREST, so grant the authenticated
-- role the verbs the application may attempt and leave row/operation filtering
-- to the policies defined in 0011.

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Keep later migration-created objects usable without another blanket repair.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
