-- Delivery worker without a separate server: pg_cron calls the Vercel sweep endpoint every
-- minute (https://www.mobialo.eu/api/worker/sweep). Runs after 20261022150000_app_settings.sql.
-- The secrets live in Supabase Vault and are created separately, never in this file:
--   mobialo_worker_secret   random value sent as the x-worker-secret header
--   mobialo_resend_api_key  Resend API key used by the sweep to email the eSIM QR codes
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- Only the server (service_role) may read the worker secrets through PostgREST.
create or replace function public.mobialo_worker_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'worker_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mobialo_worker_secret'),
    'resend_api_key', (select decrypted_secret from vault.decrypted_secrets where name = 'mobialo_resend_api_key')
  );
$$;
revoke all on function public.mobialo_worker_config() from public, anon, authenticated;
grant execute on function public.mobialo_worker_config() to service_role;

-- Scheduling under the same name replaces the previous definition.
select cron.schedule(
  'mobialo-delivery-sweep',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://www.mobialo.eu/api/worker/sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mobialo_worker_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);

notify pgrst, 'reload schema';
