-- Guest checkout (orders without an account) and the checkout consent record.
-- Runs after 20261023090000_indexes_and_cron_cleanup.sql and must be applied before the code that
-- writes these columns is deployed. Run in the Supabase SQL Editor; safe to run again.

-- HMAC-SHA256 (hex) of the guest's client IP (an IPv6 address by its /64), keyed with the server's
-- service-role key and a fixed label; the raw address is never stored. Used only for the per-address
-- limit on unpaid guest orders and cleared after 7 days (job below); rotating the key starts new buckets.
alter table public.esim_deliveries add column if not exists client_ip_hash text;
-- When and which version of the Terms and the Delivery & refund policy the buyer accepted, together
-- with the request for immediate delivery and the acknowledgement of losing the withdrawal right.
alter table public.esim_deliveries add column if not exists terms_accepted_at timestamptz;
alter table public.esim_deliveries add column if not exists terms_version text;
do $$ begin
  alter table public.esim_deliveries add constraint esim_deliveries_client_ip_hash_check
    check (client_ip_hash is null or client_ip_hash ~ '^[0-9a-f]{64}$');
exception when duplicate_object then null;
end $$;

-- Unpaid guest orders per address in the last hour (scripts/checkout-limits.mjs).
create index if not exists esim_deliveries_ip_open_idx
  on public.esim_deliveries(client_ip_hash, created_at) where state = 'awaiting_payment';
-- Guest orders in the last hour (global cap).
create index if not exists esim_deliveries_guest_created_idx
  on public.esim_deliveries(created_at) where user_id is null;

-- Guest orders are counted and inserted under one lock, so parallel requests cannot pass the limits
-- (the limits come from scripts/checkout-limits.mjs; only unpaid orders count). Server credentials only.
create or replace function public.reserve_guest_order(
  p_id uuid, p_product_id text, p_product_title text, p_amount numeric, p_customer_email text,
  p_language text, p_client_ip_hash text, p_terms_accepted_at timestamptz, p_terms_version text,
  p_max_per_address integer, p_max_total integer
) returns public.esim_deliveries
language plpgsql
security invoker
set search_path = ''
as $$
declare
  reserved public.esim_deliveries;
  since timestamptz := clock_timestamp() - interval '1 hour';
begin
  -- Serializes guest reservations only; other orders and worker updates are not blocked.
  perform pg_advisory_xact_lock(hashtextextended('mobialo-guest-orders', 0));
  if (select count(*) from public.esim_deliveries
      where client_ip_hash = p_client_ip_hash and state = 'awaiting_payment' and created_at > since) >= p_max_per_address
    or (select count(*) from public.esim_deliveries
      where user_id is null and state = 'awaiting_payment' and created_at > since) >= p_max_total then
    raise exception 'TOO_MANY_OPEN_ORDERS' using errcode = 'P0001';
  end if;
  insert into public.esim_deliveries
    (id, paypal_order_id, product_id, product_title, amount, currency, customer_email, language,
     state, client_ip_hash, terms_accepted_at, terms_version)
  values
    (p_id, 'pending-' || p_id, p_product_id, p_product_title, p_amount, 'EUR', p_customer_email, p_language,
     'awaiting_payment', p_client_ip_hash, p_terms_accepted_at, p_terms_version)
  returning * into reserved;
  return reserved;
end;
$$;

revoke all on function public.reserve_guest_order(uuid,text,text,numeric,text,text,text,timestamptz,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.reserve_guest_order(uuid,text,text,numeric,text,text,text,timestamptz,text,integer,integer)
  to service_role;

-- The limits only look at the last hour; the hash is deleted after 7 days. Scheduling under the same
-- name replaces the previous definition.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule(
  'mobialo-guest-ip-cleanup',
  '29 3 * * *',
  $job$update public.esim_deliveries set client_ip_hash = null
    where client_ip_hash is not null and created_at < now() - interval '7 days'$job$
);

notify pgrst, 'reload schema';

-- Rollback (the columns hold order records and are kept): drop index if exists public.esim_deliveries_ip_open_idx;
--   drop index if exists public.esim_deliveries_guest_created_idx;
--   drop function if exists public.reserve_guest_order(uuid,text,text,numeric,text,text,text,timestamptz,text,integer,integer);
--   select cron.unschedule('mobialo-guest-ip-cleanup');
