-- Payment flags written by the verified PayPal webhook (refunds, reversals, denied captures and
-- disputes). Runs after 20261023090000_indexes_and_cron_cleanup.sql and must be applied before the
-- code that reads these columns is deployed. Run in the Supabase SQL Editor; safe to run again.
-- Delivery states are unchanged: the webhook only moves a not yet provisioned 'paid' order to 'review'.
alter table public.esim_deliveries add column if not exists payment_status text;
alter table public.esim_deliveries add column if not exists refunded_amount numeric(12,2);
alter table public.esim_deliveries add column if not exists dispute_id text;
alter table public.esim_deliveries add column if not exists dispute_status text;
-- Set on every payment flag write; the webhook also uses it as the row version for concurrent events.
alter table public.esim_deliveries add column if not exists payment_updated_at timestamptz;
do $$ begin
  alter table public.esim_deliveries add constraint esim_deliveries_payment_status_check
    check (payment_status is null or payment_status in
      ('completed','pending','refunded','partially_refunded','reversed','denied','disputed'));
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table public.esim_deliveries add constraint esim_deliveries_refunded_amount_check
    check (refunded_amount is null or refunded_amount >= 0);
exception when duplicate_object then null;
end $$;

-- Events are matched by capture ID. No new index: paypal_capture_id is unique since
-- 20261017_esim_delivery.sql, and its unique index (esim_deliveries_paypal_capture_id_key) serves the lookup.
notify pgrst, 'reload schema';

-- No rollback: the columns hold payment records and are kept.
