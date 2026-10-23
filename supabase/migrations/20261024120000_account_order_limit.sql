-- Orders of signed-in customers are counted and inserted under one lock per account, like guest orders, so a burst
-- of parallel requests from one account cannot pass its limit of unpaid orders (the limit comes from
-- scripts/checkout-limits.mjs; only unpaid orders of the last hour count). Runs after
-- 20261023100000_guest_checkout.sql (consent columns) and must be applied before the code that calls it is
-- deployed: without it signed-in customers cannot create orders (503). Run in the Supabase SQL Editor; safe to run again.
create or replace function public.reserve_account_order(
  p_id uuid, p_user_id uuid, p_product_id text, p_product_title text, p_amount numeric, p_customer_email text,
  p_language text, p_terms_accepted_at timestamptz, p_terms_version text, p_max_open integer
) returns public.esim_deliveries
language plpgsql
security invoker
set search_path = ''
as $$
declare
  reserved public.esim_deliveries;
  since timestamptz := clock_timestamp() - interval '1 hour';
begin
  -- An order without an account would escape both this limit and the guest limits.
  if p_user_id is null or p_max_open is null then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;
  -- Serializes reservations of the same account only; other customers, guests and worker updates are not blocked.
  perform pg_advisory_xact_lock(hashtextextended('mobialo-account-orders:' || p_user_id::text, 0));
  if (select count(*) from public.esim_deliveries
      where user_id = p_user_id and state = 'awaiting_payment' and created_at > since) >= p_max_open then
    raise exception 'TOO_MANY_OPEN_ORDERS' using errcode = 'P0001';
  end if;
  insert into public.esim_deliveries
    (id, paypal_order_id, product_id, product_title, amount, currency, customer_email, language,
     state, user_id, terms_accepted_at, terms_version)
  values
    (p_id, 'pending-' || p_id, p_product_id, p_product_title, p_amount, 'EUR', p_customer_email, p_language,
     'awaiting_payment', p_user_id, p_terms_accepted_at, p_terms_version)
  returning * into reserved;
  return reserved;
end;
$$;

revoke all on function public.reserve_account_order(uuid,uuid,text,text,numeric,text,text,timestamptz,text,integer)
  from public, anon, authenticated;
grant execute on function public.reserve_account_order(uuid,uuid,text,text,numeric,text,text,timestamptz,text,integer)
  to service_role;

notify pgrst, 'reload schema';

-- Rollback (deploy the previous code first, or signed-in customers cannot order):
--   drop function if exists public.reserve_account_order(uuid,uuid,text,text,numeric,text,text,timestamptz,text,integer);
