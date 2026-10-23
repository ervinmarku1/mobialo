-- Keeps the storefront pages from waiting for MobiMatter: every minute pg_cron requests the warm-up of the
-- store function (https://www.mobialo.eu/api/store?page=warm). It refreshes that function's in-memory
-- catalog once it is older than about 3 minutes, before its 5-minute lifetime ends, and answers 204 with
-- no body and Cache-Control no-store, so it always reaches the function and pg_net's response log (pruned
-- by pg_net after 6 hours) keeps only tiny rows. Pages meanwhile answer from the last good catalog.
-- Anonymous GET of a public URL: no secret, no database write besides that log and cron.job_run_details
-- (pruned daily by mobialo-cron-cleanup, migration 20261023090000).
-- Runs after 20261022160000_worker_cron.sql (pg_net and pg_cron). Safe to run again: scheduling under
-- the same name replaces the previous definition (an earlier version of this file also requested
-- /api/catalog and /esim under this name). The URL is hard-coded to production; on any other Supabase
-- project edit it before running, or that project will call the production site.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'mobialo-catalog-warm',
  '* * * * *',
  $job$select net.http_get(url := 'https://www.mobialo.eu/api/store?page=warm', timeout_milliseconds := 30000);$job$
);

-- Rollback: select cron.unschedule('mobialo-catalog-warm');
