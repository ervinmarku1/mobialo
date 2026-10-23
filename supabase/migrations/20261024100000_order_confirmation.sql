-- Order confirmation (Consumer Rights Directive Art. 8(7)) that the worker sends after payment and before it buys
-- the eSIM. Runs after 20261023110000_payment_events.sql and must be applied before the code that reads it is
-- deployed: without it checkout creation, the worker's confirmation step and the admin order list fail.
-- Run in the Supabase SQL Editor; safe to run again.
-- Resend ID of the confirmation; null until it is sent.
alter table public.esim_deliveries add column if not exists confirmation_email_id text;
-- The plan's main characteristics as sold, for the confirmation: {"dataAmount","dataUnit","validityHours","countries"}.
alter table public.esim_deliveries add column if not exists product_details jsonb;
notify pgrst, 'reload schema';

-- No rollback: the columns record what each customer bought and which confirmation they received.
