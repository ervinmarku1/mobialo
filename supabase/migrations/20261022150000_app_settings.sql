-- Runtime settings for the admin panel ("Cilësimet"): checkout mode, payment methods, pricing
-- and the delivery worker heartbeat. Run once in the Supabase SQL Editor; safe to run again.
-- Only the server (service_role) reads or writes it; browsers never access the table.
begin;
create table if not exists public.app_settings (
 key text primary key,
 value jsonb not null,
 updated_at timestamptz not null default now(),
 updated_by uuid null references auth.users(id) on delete set null
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from public, anon, authenticated;
grant select, insert, update on public.app_settings to service_role;
commit;
notify pgrst, 'reload schema';
