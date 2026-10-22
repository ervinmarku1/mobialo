-- Indexes for the admin order list and the delivery sweep, and daily pruning of pg_cron history.
-- Runs after 20261022160000_worker_cron.sql. Run in the Supabase SQL Editor; safe to run again.
-- CREATE INDEX briefly blocks writes to the table; it is small today. On a large table, run each
-- index on its own as CREATE INDEX CONCURRENTLY (outside a transaction) instead.

-- Admin list (/api/admin/orders): order by created_at desc, id desc, optionally within a date range.
create index if not exists esim_deliveries_created_idx
  on public.esim_deliveries(created_at desc, id desc);
-- Admin list filtered by state, and the every-minute sweep, which reads only unfinished states.
create index if not exists esim_deliveries_state_created_idx
  on public.esim_deliveries(state, created_at desc, id desc);

-- pg_cron records every run of mobialo-delivery-sweep (1440 rows a day) in cron.job_run_details and
-- never prunes it; keep 7 days. Scheduling under the same name replaces the previous definition.
-- net._http_response needs no job: pg_net deletes responses itself (pg_net.ttl, 6 hours by default).
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule(
  'mobialo-cron-cleanup',
  '17 3 * * *',
  $job$delete from cron.job_run_details where end_time < now() - interval '7 days'$job$
);

-- Rollback: drop index if exists public.esim_deliveries_created_idx;
--   drop index if exists public.esim_deliveries_state_created_idx;
--   select cron.unschedule('mobialo-cron-cleanup');
