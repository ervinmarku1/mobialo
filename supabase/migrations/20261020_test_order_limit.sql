-- Reserve a slot before contacting PayPal. Failed attempts also count for one
-- hour, so retries and process restarts cannot bypass the sandbox creation limit.
create index if not exists esim_test_orders_sandbox_created_idx
  on public.esim_test_orders(created_at)
  where environment = 'sandbox';

create or replace function public.reserve_esim_test_order(
  p_id uuid, p_product_id text, p_product_title text,
  p_amount numeric, p_customer_email text, p_language text
) returns public.esim_test_orders
language plpgsql
security invoker
set search_path = ''
as $$
declare
  reserved public.esim_test_orders;
begin
  -- Serializes reservations across processes. The count and insert are atomic.
  lock table public.esim_test_orders in share row exclusive mode;
  if (select count(*) from public.esim_test_orders
      where environment = 'sandbox'
        and created_at > clock_timestamp() - interval '1 hour') >= 100 then
    raise exception 'TOO_MANY_TEST_ORDERS' using errcode = 'P0001';
  end if;
  insert into public.esim_test_orders
    (id, product_id, product_title, amount, customer_email, language,
     environment, state, created_at)
  values
    (p_id, p_product_id, p_product_title, p_amount, p_customer_email,
     p_language, 'sandbox', 'created', clock_timestamp())
  returning * into reserved;
  return reserved;
end;
$$;

revoke all on function public.reserve_esim_test_order(uuid,text,text,numeric,text,text)
  from public, anon, authenticated;
grant execute on function public.reserve_esim_test_order(uuid,text,text,numeric,text,text)
  to service_role;
