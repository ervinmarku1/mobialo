-- New tables, sequences and functions in the public schema are no longer granted to the browser roles (anon,
-- authenticated) by default. The shop reads and writes its data only from the server (service_role); the anon key
-- in the browser is used for Supabase Auth alone. Existing objects keep the explicit grants of the earlier
-- migrations, which already revoke the browser roles. Run in the Supabase SQL Editor; safe to run again.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated, public;

-- Objects created by supabase_admin (platform tooling) follow the same rule where the running role may change them.
do $$ begin
  alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated;
  alter default privileges for role supabase_admin in schema public revoke all on sequences from anon, authenticated;
  alter default privileges for role supabase_admin in schema public revoke execute on functions from anon, authenticated, public;
exception when insufficient_privilege then
  raise notice 'Default privileges of supabase_admin unchanged: not permitted for this role';
end $$;

-- Rollback (restores the Supabase defaults):
-- alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;
-- alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated;
-- alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, public;
