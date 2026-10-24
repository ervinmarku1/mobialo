# Checkout, delivery and database

Status: live at https://www.mobialo.eu with real PayPal payments. The shop mode (closed /
admin / public), payment methods and pricing are managed in the admin panel (Cilësimet,
stored in `app_settings`). The delivery worker runs every minute through Supabase pg_cron
(see "Delivery worker (pg_cron)").

## Database migrations

Migrations are applied by hand in the Supabase SQL Editor, in filename order. For a fresh
database run all of them; for an existing one, run only the files that are missing:

1. `migrations/20261017_esim_delivery.sql`: orders and delivery queue (`esim_deliveries`).
2. `migrations/20261018_test_orders.sql`: sandbox-only `esim_test_orders`, independent of the rest.
3. `migrations/20261019_customer_ownership.sql`: `user_id`, `product_title` and the per-customer
   index on `esim_deliveries`; needs file 1.
4. `migrations/20261020_test_order_limit.sql`: `reserve_esim_test_order()` (sandbox creation limit);
   needs file 2.
5. `migrations/20261022074725_admin_access_requests.sql`: administrator approval requests, in one
   transaction.
6. `migrations/20261022150000_app_settings.sql`: `app_settings` (Cilësimet and worker heartbeat).
7. `migrations/20261022160000_worker_cron.sql`: pg_net, pg_cron, `mobialo_worker_config()` and the
   every-minute job `mobialo-delivery-sweep`. Create the Vault secrets first (see below). The job
   URL is hard-coded to `https://www.mobialo.eu`: on any other Supabase project, edit the URL
   before running it, or that project will call the production sweep.
8. `migrations/20261023090000_indexes_and_cron_cleanup.sql`: indexes for the admin order list and
   the sweep, and the daily job `mobialo-cron-cleanup` (keeps 7 days of `cron.job_run_details`).
9. `migrations/20261023100000_guest_checkout.sql`: guest checkout and the consent record
   (`client_ip_hash`, `terms_accepted_at`, `terms_version`) plus the indexes for the guest limits.
   Apply before deploying the code: without it every checkout creation fails with 503.
10. `migrations/20261023110000_payment_events.sql`: payment flags written by the webhook
   (`payment_status`, `refunded_amount`, `dispute_id`, `dispute_status`, `payment_updated_at`).
   Apply before deploying the code: without it the admin order list and the refund/dispute
   webhook events return 503.
11. `migrations/20261024090000_catalog_warm_cron.sql`: the every-minute job `mobialo-catalog-warm`, an
   anonymous GET of `https://www.mobialo.eu/api/store?page=warm` (204, no body, no-store). It refreshes the
   store function's in-memory catalog before its 5-minute lifetime ends, so no page of a warm instance
   waits for MobiMatter; pg_net logs only tiny responses. Needs file 7 (pg_net, pg_cron).
   The URL is hard-coded to production, like file 7. Optional: without it the pages still answer at once
   from the last good catalog (up to an hour while MobiMatter fails); only a cold instance waits for it.
   Running it again replaces the job (an earlier version also requested `/api/catalog` and `/esim`).
12. `migrations/20261024100000_order_confirmation.sql`: `confirmation_email_id`, the Resend ID of the order
   confirmation the worker sends after payment and before it buys the eSIM (see "Order confirmation" below).
   Apply before deploying the code: without it paid orders wait in `paid` and the admin order list returns 503.
13. `migrations/20261024110000_default_privileges.sql`: tables, sequences and functions created later in
   `public` are no longer granted to `anon`/`authenticated` by default (the browser's anon key is for Supabase
   Auth only). A new table still needs RLS and its own explicit grants, like the existing ones.
14. `migrations/20261024120000_account_order_limit.sql`: `reserve_account_order()`, which counts a signed-in
   customer's unpaid orders and inserts the new one under a lock per account (limits under "Hosted checkout").
   Apply before deploying the code: without it signed-in customers cannot create orders (503); guests are unaffected.
15. `migrations/20261024130000_expired_checkouts.sql`: the final state `expired` for checkouts left unpaid for a day
   (no capture, no payment flag), set by the hourly job `mobialo-expire-checkouts`, and for rows held for a check that
   never had a payment. Customers see "Payment not completed", the admin panel "Skaduar pa pagesë". Apply AFTER
   deploying the code that knows the state (the webhook delivers a late completed capture, checkout refuses to capture).

All files are safe to run again. A null column below means that migration is missing:

```sql
select to_regclass('public.esim_deliveries') as m1, to_regclass('public.esim_test_orders') as m2,
  to_regclass('public.esim_deliveries_user_created_idx') as m3,
  to_regprocedure('public.reserve_esim_test_order(uuid,text,text,numeric,text,text)') as m4,
  to_regclass('public.admin_access_requests') as m5, to_regclass('public.app_settings') as m6,
  to_regprocedure('public.mobialo_worker_config()') as m7,
  to_regclass('public.esim_deliveries_state_created_idx') as m8,
  to_regclass('public.esim_deliveries_ip_open_idx') as m9,
  (select 1 from information_schema.columns where table_schema='public'
    and table_name='esim_deliveries' and column_name='payment_updated_at') as m10,
  (select 1 from information_schema.columns where table_schema='public'
    and table_name='esim_deliveries' and column_name='confirmation_email_id') as m12,
  (select coalesce(bool_and(defaclacl::text not like '%anon=%'),true) from pg_default_acl
    where defaclnamespace='public'::regnamespace and defaclrole='postgres'::regrole) as m13,
  to_regprocedure('public.reserve_account_order(uuid,uuid,text,text,numeric,text,text,timestamptz,text,integer)') as m14,
  (select 1 from pg_constraint where conname='esim_deliveries_state_check' and pg_get_constraintdef(oid) like '%expired%') as m15;
select jobname, schedule, active from cron.job;
```

There are no down migrations. The tables hold live orders and are never dropped; a cron job
is undone with `select cron.unschedule('<jobname>');` and an index with `drop index`.
Because nothing runs through the Supabase CLI, `supabase_migrations` does not record these
files; compare with the query above instead. The ownership migration was renamed from
`20261017_customer_ownership.sql` to give it a unique version; renaming the file does not
change the database. If migrations were ever tracked through the CLI, reconcile the old
entry before pushing; never reset an existing database.

## Hosted checkout

Vercel provides `/api/paypal/config`, `/api/paypal/create` and `/api/paypal/capture`; they
require `PAYPAL_ENV=live`. The effective mode is the saved Cilësimet value; before the first
save (and, capped at admin, during a Supabase outage) it falls back to the Vercel
`CHECKOUT_MODE`. Admin mode allows only confirmed Supabase users listed in `ADMIN_USER_IDS`,
approved administrators and the superadmin; other visitors see the preview. Closed disables
the hosted flow, except that an existing order stays capturable, so closing the shop never
breaks a payment approved in PayPal: an owned order by its signed-in owner, a guest order by
whoever holds its capability (the random order state ID plus its PayPal order ID).
Config, creation and capture all verify the session server-side, and create/capture only
accept the origin `https://www.mobialo.eu`. Every creation needs the consent checkbox
(`consent:true`, else 400 `CONSENT_REQUIRED`); the order stores `terms_accepted_at` and
`terms_version` (`TERMS_VERSION` in `scripts/hosted-checkout.mjs`; change it whenever the
Terms or the Delivery & refund policy change). Prices come from the server's catalog; browser-supplied ownership and prices are
ignored. Set the MobiMatter catalog credentials on Vercel in addition to the live PayPal
and Supabase credentials. Hosted capture records the verified payment (`paid`) for the
delivery worker; provisioning is not performed inside the Vercel request. The webhook
independently reconciles captures if the browser loses its response. This is real money,
not sandbox. No automatic test makes a payment.

Admin mode requires an aal2 (2FA) session when the admin has a verified TOTP factor,
when `ADMIN_MFA_REQUIRED=true`, or whenever `SUPER_ADMIN_USER_IDS` is set. The checkout
asks for the Authenticator code in place; it can also be verified at
`https://www.mobialo.eu/admin`. `admin.mobialo.eu` redirects there, because sessions
are stored per origin.

Public mode opens checkout to every visitor (no admin list, no 2FA). Customers with a
confirmed email buy on their account (the eSIM goes to the account email unless they type
another). Signed-out and unconfirmed visitors buy as guests: they type the email, the order
has no `user_id` and does not appear in `/account`. Limits (`TOO_MANY_OPEN_ORDERS`, HTTP 429):
10 unpaid orders per hour per account; for guests 10 unpaid orders per hour per client
address (stored only as a labelled HMAC keyed with the service-role key, IPv6 by its /64,
cleared after 7 days by the job `mobialo-guest-ip-cleanup`) and 300 unpaid guest orders per
hour in total. Guest rows are inserted by `reserve_guest_order()` and rows of signed-in customers by
`reserve_account_order()` (a lock per account), which count and insert under one lock, so parallel
requests cannot pass the limits. A failing limit query refuses the order (503). An attacker with many IPv6 /64 networks can still fill the global cap and
pause guest sales for an hour (signed-in buyers are unaffected); a Vercel Firewall rate limit
on `/api/paypal/create` and `/api/paypal/capture` is the next layer. A Supabase
Auth outage is never treated as "signed out". Cilësimet only allows switching to public while
the worker heartbeat is fresh (under 10 minutes) and healthy, and checkout treats public
as admin whenever the heartbeat goes stale, so customers are never charged while nothing
provisions their eSIM. Customer emails use Supabase custom SMTP (Resend).

Card payments use PayPal's guest "Debit or Credit Card" button (Advanced Card Fields
are not available for the Albanian merchant account). PayPal → Account Settings →
Website payments → Website preferences → "PayPal account optional" must be On.
Kosovo-issued cards may not be offered guest checkout by PayPal.

Capture outcomes:
- COMPLETED: the order becomes `paid`; the worker provisions it.
- PENDING (PayPal holds the money, e.g. EUR not accepted automatically or account
  review): returns `status: "PENDING"`, stores `paypal_capture_id` while the row stays
  `awaiting_payment` (the admin panel shows "PayPal në pritje"). Accept the payment in
  PayPal; the verified webhook (`PAYMENT.CAPTURE.COMPLETED`, registered on the live app
  at https://www.mobialo.eu/api/paypal/webhook) or the worker then marks it `paid`.
  The worker keeps polling rows with a stored capture. Customers do not see PayPal's
  pending reason.
- 422 `INSTRUMENT_DECLINED` (also REDIRECT_PAYER_FOR_ALTERNATE_FUNDING): the browser
  reopens PayPal to choose another funding source.
- 422 `PAYMENT_REFUSED` (payer/funding refusals such as PAYMENT_DENIED, or a capture
  with status DECLINED/FAILED): no money taken; the next click creates a new order.
- 422 `MERCHANT_REFUSED` (PAYEE_* restrictions, TRANSACTION_BLOCKED_BY_PAYEE, receiving
  limits) and 422 `PAYPAL_COMPLIANCE_VIOLATION`: no money taken; fix the PayPal account.
- 400 `PAYMENT_APPROVAL_REQUIRED` (also PAYER_ACTION_REQUIRED/ORDER_NOT_APPROVED on
  capture): not captured; the buyer starts again.
- Never paid: a checkout without any capture or payment flag becomes `expired` a day after it was created
  (job `mobialo-expire-checkouts`, migration 15). It is no longer polled or captured (400 `INVALID_ORDER`); a completed
  capture that PayPal still reports through the webhook makes it `paid` and is delivered.
- 502 `PAYPAL_REQUEST_FAILED`: unknown outcome, "do not pay again; retry verification".
  The PayPal issue is logged as `PayPal API request failed {status,name,debugId,issues}`.
- 503 `CHECKOUT_UNAVAILABLE`: configuration/upstream failure, logged as
  `Hosted checkout unavailable {"action","reason"}`; `reason` is returned only to
  admins who passed every admin gate.

Refunds, reversals, denied captures and disputes are recorded automatically by the verified
webhook (see below): a `paid` order whose eSIM was not bought yet moves to `review`, so the
worker never provisions it, and support@mobialo.eu gets an alert. Refunding money and
cancelling an already delivered eSIM stay manual (PayPal and the MobiMatter portal). The
admin panel shows red payment badges and the "Problem me pagesën" filter; it has no refund action.
The worker also checks the flags before completing the eSIM and before the QR email, so a refund
recorded mid-delivery stops there. To release a stopped order after review, reset `payment_status`
as well as `state`; otherwise the worker moves it straight back to `review`.

## Customer dashboard

`/account` provides the customer overview, order history, delivered eSIM orders,
profile updates, password reset and support. The `/api/account/orders` endpoint
verifies the Supabase session server-side and selects only that user's orders (needs
migration 3). Existing guest orders remain unassigned; never backfill ownership by an
unverified checkout email. The dashboard does not claim to show data balance or
activation status; installation details are delivered by email.
Test account access with `node --test scripts/customer-orders.test.mjs`.

## Delivery pipeline

1. Keep `SUPABASE_SERVICE_ROLE_KEY` and `RESEND_API_KEY` server-only.
2. Creation records the server-priced product, the buyer-entered email and language
   before creating the PayPal order. The email is not identity-verified: the buyer must
   check it before paying. Only realtime products are allowed; test and KYC plans are blocked.
3. Capture checks the stored order and rechecks the actual completed payment amount.
   The email and amount cannot be changed at capture.
4. The worker first emails the order confirmation (see below), then reserves the eSIM at
   MobiMatter (deducting the supplier wallet), completes it and emails the QR code. Each
   irreversible step is claimed in the database before its request.

### Order confirmation

The confirmation on a durable medium (Consumer Rights Directive Art. 8(7); docs/LEGAL-REVIEW.md
point 1) goes out while the order is `paid`, before the worker buys the eSIM: seller, plan, its data,
validity and countries as sold (`product_details`, stored at checkout), order reference, date, total,
delivery email, the recorded consent with its time and terms version, the withdrawal right until
delivery, the statutory rights of Terms §7, and links to both legal pages. The accepted Terms and Delivery &
refund policy are attached as UTF-8 text files in the order's language, read from `dist/terms.js`
and `dist/delivery-refunds.js` (shipped with `api/worker/sweep.mjs` through `includeFiles`); they are
attached only while those pages carry the version stored with the order and their text still matches
that version's fingerprint in `scripts/legal-documents.mjs` (a text change needs a new version in
`scripts/terms-version.mjs`; the tests fail otherwise). If the files cannot be read or no longer match,
the confirmation still goes out without them, the error is logged and Cilësimet shows "Dokumentet
ligjore te konfirmimi: Mungojnë" (heartbeat `documents: false`).

- The Resend ID is stored in `confirmation_email_id` (migration 12) and shown on the admin order page.
- An order that already has a `provider_order_id` is never bought again from `paid`; it goes to `review`.
- A failed send leaves the order in `paid` and the next sweep tries again with the same Resend
  idempotency key (`confirmation/<id>/<digest of the message>`), so a send whose answer was lost is not
  delivered twice; a changed message (corrected address, new template) is a new send. A 409 is then
  a concurrent send of the same message: the sweep leaves the row for the next one, which records it.
  Other failures (quota, outage, keys) count as a failed paid order: the heartbeat is not ok, public
  checkout falls back to admin-only and Cilësimet shows the code, e.g. `DELIVERY_UPSTREAM_429:...`.
- If Resend refuses the message (400 or 422) while it carries the documents, it is sent again at once
  without them. Refused again, the address is the problem and the eSIM email would be refused too:
  the order moves to `review` without buying the eSIM, and support@mobialo.eu gets an alert with the
  code but no customer data. Fix the email or refund in PayPal. Only a `review` row with an empty
  `provider_order_id` may be moved back to `paid` (that sends the confirmation again).

States `reserving` and `sending` are deliberately never auto-reclaimed: a timeout
may have occurred after the remote action succeeded. Reconcile in the provider's
portal using the internal order label or stored provider ID before changing state.
Every such lock emails support@mobialo.eu at once (once per order and reason, with the code and
the admin link, no customer data). A definite supplier refusal of the purchase (HTTP 4xx other
than 408/409/425/429: balance, key, product withdrawn) created no supplier order, so the order
goes to `review` instead of `reserving`, with an alert; a 429 returns it to `paid` for the next
sweep. If refusals repeat (for example an empty MobiMatter balance), close checkout in Cilësimet
until it is fixed: each further paid order would stop the same way.
For `completing`, recovery reads the stored provider order and advances only after
its ID, product, completed state and QR have been validated; it never repeats PUT.
Do not reset to `paid` and risk purchasing twice. Resend acceptance (`sent`) is not proof
of inbox delivery. Email delivery/bounce webhooks are a further task.

Email currently supports SQ, EN, IT, with EN fallback. This is separate from the
36-language signup template. QR data stays server-side; the email embeds the provider
PNG via CID. No QR rendering service receives the activation credential.

No real order or email is created by the automated tests. Run:
`node --test scripts/esim-delivery.test.mjs scripts/order-confirmation.test.mjs scripts/live-checkout.test.mjs scripts/delivery-worker.test.mjs`

## Verified live PayPal webhook

`POST /api/paypal/webhook` needs `PAYPAL_ENV=live`, the live PayPal credentials,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `PAYPAL_WEBHOOK_ID`. It does not need
supplier or email-provider credentials.

The endpoint is registered on the SAME PayPal live REST app used for checkout and
subscribed to `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`,
`PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`,
`CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED` and `CUSTOMER.DISPUTE.RESOLVED`.
`PAYPAL_WEBHOOK_ID` is the webhook
registration ID, not the client ID. The route must stay reachable without deployment
protection/login; `vercel.json` sets each function's maximum duration.

The listener sends the original event JSON and signature headers to PayPal's
verification API, then independently reads the stored PayPal order and checks
its completed capture ID, amount and currency. It acknowledges only after the
payment is durably marked paid (or already processed). Duplicate events cannot
reset delivery state. Unavailable verification/storage returns 503 for retry.

Capture PENDING/DENIED/REFUNDED/REVERSED events find the order by capture ID (else by the
PayPal order ID), re-read the capture from PayPal and write nothing on a mismatch (409).
Dispute events use the dispute's seller transaction ID. Each write is conditional on the
row version (`payment_updated_at`); a weaker flag never replaces a stronger one and a
replayed event writes nothing and sends no alert. Orders already being provisioned or
sent only get the flags. Unknown orders get 200 and a log line (except COMPLETED, which
keeps its retry). Other verified event types and email bounces are acknowledged without
processing.

The endpoint does not provision eSIMs; the worker discovers paid rows. Test with an
actual event from the registered app: PayPal's mock simulator does not support this
postback verification method. The automated tests never register a webhook or pay.

## Delivery worker (pg_cron)

Production runs the worker without a separate server: Supabase `pg_cron` job
`mobialo-delivery-sweep` POSTs to `https://www.mobialo.eu/api/worker/sweep` every
minute (migration 7). The endpoint checks the `x-worker-secret` header against Supabase
Vault secret `mobialo_worker_secret`, reads `mobialo_resend_api_key` from Vault (a Vercel
`RESEND_API_KEY` wins if set), runs one bounded recovery sweep (45 s) and writes the
`worker` heartbeat to `app_settings`, which Cilësimet shows. Both secrets are read only
through `public.mobialo_worker_config()`, executable by `service_role` alone.
Vault secrets are created with `vault.create_secret` outside the repository; to
rotate, `vault.update_secret` the value; the cron job reads it on each run, but warm
Vercel instances cache it for up to 5 minutes, so expect 401s in `cron.job_run_details`
for up to 5 minutes (or redeploy).

Each sweep handles paid orders first (oldest first), counts rows locked for manual review
(`reserving`, `sending`, `review`) without touching them, and then polls unpaid checkouts:
for 6 hours after creation, or for as long as a recorded capture is PENDING. Completed
PayPal captures are checked again before provisioning; approved but uncaptured payments
are never captured by the worker. A failing item does not stop later items. The heartbeat
is not ok when a paid order failed or paid work was left for the next sweep.
The database is the durable queue: nothing is lost between runs, and concurrent sweeps,
workers and browser requests are arbitrated by the same conditional state updates. The order
confirmation is not claimed: two processes may send it at once, and Resend's idempotency key keeps
it to one email (the second request gets a 409 and is left for the next sweep). The sweep function
has `maxDuration` 120 s, so a provider step started just before the 45 s budget ends can finish.

Monitoring:
- Runs: `select * from cron.job_run_details order by start_time desc limit 20;`
- HTTP results: `select * from net._http_response order by created desc limit 20;`
- Vercel function logs for `/api/worker/sweep` (counts and internal order IDs only, never
  email addresses or activation credentials) and the heartbeat in Cilësimet.
- Email to support@mobialo.eu when public checkout closes by itself (scripts/checkout-alerts.mjs), at
  most once an hour per reason: the sweep reports a problem in two sweeps in a row (with the code), or
  the heartbeat is older than 10 minutes (sent by the checkout function, since the sweep is not running).
  Every paid order that stops for manual handling is emailed as well (see "Delivery pipeline").

Retention: job `mobialo-cron-cleanup` (migration 8) deletes `cron.job_run_details` rows
older than 7 days every day at 03:17 UTC; without it the sweep adds 1440 rows a day.
pg_net deletes `net._http_response` rows by itself (setting `pg_net.ttl`, 6 hours by
default), so no job is needed for them.

Pause with `select cron.unschedule('mobialo-delivery-sweep');` (the heartbeat then goes
stale and checkout falls back to admin-only). Resume by running migration 7 again. This stops
only the cron sweep: a standalone worker (below) keeps delivering and writing the heartbeat, so
stop it too. Cilësimet shows which process wrote the last heartbeat ("Burimi").

## Standalone worker (optional)

`npm run worker:delivery` runs the same recovery as a long-running process (60-second
pause between sweeps; `npm run worker:delivery -- --once` for one sweep). It reads
`.env.local` and needs the live configuration: `PAYPAL_ENV=live`, `PAYPAL_LIVE_CLIENT_ID`,
`PAYPAL_LIVE_CLIENT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`MOBIMATTER_MERCHANT_ID`, `MOBIMATTER_API_KEY` and `RESEND_API_KEY`. It can buy real
eSIMs and send real emails for already captured payments; start it only against the
intended production project. Running it next to the pg_cron sweep does not buy or send twice,
because every state change is a conditional transition (the order confirmation is deduplicated by
Resend, see above), but it is not recommended: it is one more place holding every live key, it
overwrites the cron heartbeat (source `standalone`, shown in Cilësimet), and pausing the cron no
longer pauses deliveries. Its heartbeat uses the same health rule as the cron sweep. `npm run dev`
does not start it.

`Dockerfile.worker` packages only the worker's source files and the two legal documents its order
confirmation attaches (a test checks the list against the worker's imports); credentials are injected at
runtime and `.env.local` is excluded from the build. It is a fallback, not used in
production: build it and confirm the container starts before relying on it. A copy of it found
running on Render, deploying automatically from `main`, was deleted with its environment variables on
23.10.2026; since then only the pg_cron sweep delivers orders and writes the heartbeat.

```sh
docker build -f Dockerfile.worker -t mobialo-worker .
docker run -d --name mobialo-worker --restart unless-stopped --env-file /secure/path/worker.env mobialo-worker
```

The Docker health check uses a private local heartbeat file updated as the worker
progresses; missing, stale (five minutes) or failed status makes the check fail.
Outside Docker, run `node scripts/worker-health.mjs` on the same host and user. The
optional `WORKER_HEALTH_FILE` path must be writable by the worker. Health indicates
worker progress, not inbox delivery or the absence of manual-review orders. Configure
host alerts for an unhealthy/stopped container, `manual_review`, `retry_or_review` and
nonzero failed counts; Docker's restart policy restarts an exited process, but an
unhealthy flag alone does not restart it or send alerts.

## End-to-end acceptance

Repeat after changes to checkout or delivery: create one explicitly selected live
order, complete payment, confirm the capture is stored (browser or webhook), confirm
one order confirmation with both .txt attachments in the order's language and version and
`confirmation_email_id` set before `provider_order_id`, then exactly one provider order and one
eSIM email. Replay the webhook event, let the next sweep run and confirm no second confirmation,
purchase or eSIM email, and Cilësimet shows "Dokumentet ligjore te konfirmimi: OK". Record
references without activation credentials.

## Local development

`npm run dev` (scripts/serve.mjs) reads `.env.local`. With `PAYPAL_ENV=live` there it refuses
`/api/paypal/create`, `/api/paypal/capture`, `/api/paypal/webhook` and every `/api/admin/*`
route with 403 `LOCAL_LIVE_BLOCKED`; pages, the catalog and the read-only account endpoint still
work. Only `ALLOW_LOCAL_LIVE=1` in the environment lifts that guard, and then the local server
creates real PayPal orders and production rows, a completed local capture buys the eSIM and
sends the email at once, and it skips the hosted checkout gates: no shop mode, admin list, 2FA
or worker heartbeat check, sign-in is optional on create and capture does not check ownership.
Use `PAYPAL_ENV=sandbox` locally, preferably with a separate Supabase project. Sandbox orders
use `esim_test_orders` and never buy an eSIM.

## Sandbox creation limit

Apply migration 4 before using sandbox checkout. Sandbox creation reserves a row through
a service-role-only database function before contacting PayPal. A table lock makes the
rolling limit of 100 sandbox creation attempts per hour atomic across requests and server
processes. Completed, failed and abandoned attempts all count; simulation rows do not.
Existing sandbox rows in the last hour also count. The limit is global to the test store,
not per customer. Rows expire from the count after one hour without being deleted.
Missing migration or database failure blocks creation before any PayPal call. Ambiguous
creation failures retain their reserved slot.

References:
- https://developer.paypal.com/api/rest/webhooks/rest/
- https://supabase.com/docs/guides/cron
- https://docs.docker.com/reference/dockerfile/#healthcheck
- https://vercel.com/docs/functions/configuring-functions/duration
- https://docs.mobimatter.com/docs/guides/placing-order
- https://resend.com/changelog/embed-images-using-cid
