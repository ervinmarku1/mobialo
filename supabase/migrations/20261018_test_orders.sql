-- Isolated test records: never consumed by real eSIM fulfillment.
create table if not exists public.esim_test_orders (
 id uuid primary key,
 environment text not null default 'sandbox' check (environment in ('sandbox','simulation')),
 paypal_order_id text unique,
 capture_request_id uuid not null default gen_random_uuid(),
 product_id text not null,
 product_title text not null,
 amount numeric(12,2) not null check (amount > 0),
 currency text not null default 'EUR' check (currency = 'EUR'),
 customer_email text not null,
 language text not null default 'sq',
 state text not null default 'created' check (state in ('created','approved','completed','failed','simulated')),
 error_code text,
 email_id text,
 created_at timestamptz not null default now()
);
alter table public.esim_test_orders enable row level security;
revoke all on public.esim_test_orders from anon, authenticated;
grant select, insert, update on public.esim_test_orders to service_role;
