-- Run once in Supabase SQL Editor. Server credentials only; no browser access.
create table if not exists public.esim_deliveries (
  id uuid primary key default gen_random_uuid(),
  paypal_order_id text not null unique,
  paypal_capture_id text unique,
  product_id text not null,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'EUR' check (currency = 'EUR'),
  customer_email text not null,
  language text not null default 'en',
  state text not null default 'awaiting_payment' check (state in
    ('awaiting_payment','paid','reserving','reserved','completing','ready','sending','sent','review')),
  provider_order_id text unique,
  email_id text,
  created_at timestamptz not null default now()
);
alter table public.esim_deliveries enable row level security;
revoke all on public.esim_deliveries from anon, authenticated;
grant select, insert, update on public.esim_deliveries to service_role;
