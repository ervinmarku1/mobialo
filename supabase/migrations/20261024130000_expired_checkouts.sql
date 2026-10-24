-- Unpaid checkouts get a final state instead of waiting forever: 'expired', a day after creation without any PayPal
-- capture or payment flag. The worker stops polling unpaid checkouts after 6 hours and PayPal captures only when the
-- server asks (at once after the buyer approves), so a day later nothing can still be paid; should PayPal report a
-- completed capture anyway, the webhook delivers it (scripts/paypal-webhook.mjs). The capture endpoint refuses an
-- expired order. Runs after 20261023090000_indexes_and_cron_cleanup.sql (pg_cron). Apply AFTER the code that knows the
-- state is deployed: the earlier webhook and capture code only turn 'awaiting_payment' rows into 'paid'. Safe to run again.
alter table public.esim_deliveries drop constraint if exists esim_deliveries_state_check;
alter table public.esim_deliveries add constraint esim_deliveries_state_check check (state = any (array[
  'awaiting_payment','paid','reserving','reserved','completing','ready','sending','sent','review','expired']));

-- Rows held for a manual check that never had a payment (no capture, no eSIM bought, no payment flag): nothing is left to check.
update public.esim_deliveries set state = 'expired'
  where state = 'review' and paypal_capture_id is null and provider_order_id is null and payment_status is null;

-- Hourly; scheduling under the same name replaces the previous definition.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule(
  'mobialo-expire-checkouts',
  '41 * * * *',
  $job$update public.esim_deliveries set state = 'expired'
    where state = 'awaiting_payment' and paypal_capture_id is null and payment_status is null
      and created_at < now() - interval '24 hours'$job$
);

-- Rollback: select cron.unschedule('mobialo-expire-checkouts');
--   update public.esim_deliveries set state = 'awaiting_payment' where state = 'expired';
--   then restore the check without 'expired' (deploy the previous code first).
