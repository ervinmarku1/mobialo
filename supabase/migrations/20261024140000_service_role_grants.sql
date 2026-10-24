-- The server's service_role key reads, inserts and updates the shop's tables but never deletes from them: orders are a
-- money ledger, and a leaked key must not be able to wipe it. Supabase grants every privilege on new public tables to
-- service_role by default; this takes back DELETE, TRUNCATE, REFERENCES and TRIGGER (nothing in the code uses them).
-- Scheduled jobs and the SQL Editor run as the table owner and keep every privilege. Safe to run again.
revoke delete, truncate, references, trigger
  on public.esim_deliveries, public.esim_test_orders, public.admin_access_requests, public.app_settings
  from service_role;

-- Rollback: grant delete, truncate, references, trigger on public.esim_deliveries, public.esim_test_orders,
--   public.admin_access_requests, public.app_settings to service_role;
