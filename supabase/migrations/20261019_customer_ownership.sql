-- Runs after 20261017_esim_delivery.sql; existing guest purchases remain unassigned.
alter table public.esim_deliveries
  add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.esim_deliveries add column if not exists product_title text;
create index if not exists esim_deliveries_user_created_idx
  on public.esim_deliveries(user_id, created_at desc);
-- Browser roles remain denied; the authenticated server endpoint enforces ownership.
