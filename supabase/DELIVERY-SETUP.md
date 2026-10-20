# eSIM delivery preparation

Status: connected to controlled LOCAL live checkout. Public checkout remains disabled.

## Customer dashboard

Run `migrations/20261019_customer_ownership.sql` after the delivery table migration
before testing checkout while signed in. It adds nullable `user_id` and `product_title`.
`/account` provides the customer overview, order history, delivered eSIM orders,
profile updates, password reset and support. The `/api/account/orders` endpoint
verifies the Supabase session server-side and selects only that user's orders.
Existing guest orders remain unassigned; never backfill ownership by an unverified
checkout email. Public payment endpoints are still disabled. The dashboard does
not claim to show data balance or activation status; installation details remain
delivered by email. Test account access with `node --test scripts/customer-orders.test.mjs`.

1. For a fresh database, run the migrations in filename order:
   - `migrations/20261017_esim_delivery.sql`
   - `migrations/20261018_test_orders.sql`
   - `migrations/20261019_customer_ownership.sql`
   - `migrations/20261020_test_order_limit.sql`
   The test-order table is independent; customer ownership requires the delivery table.
   The ownership migration was renamed from `20261017_customer_ownership.sql` to
   give it a unique version after table creation. If it was already run manually
   in SQL Editor, its columns and index remain in place; renaming the local file
   does not change the database. If migrations were tracked through the Supabase
   CLI, inspect the remote migration history and reconcile the old ownership
   entry before pushing these files; do not reset an existing database.
2. Keep SUPABASE_SERVICE_ROLE_KEY and RESEND_API_KEY server-only.
3. Local checkout records the server-priced product, buyer-entered email and language
   before creating a PayPal order. Email is not identity-verified: the buyer must check
   it before paying. Only realtime products are allowed; test and KYC plans are blocked.
4. Capture checks the stored order capability and rechecks the actual completed payment
   amount, then calls fulfillDelivery. The email and amount cannot be changed at capture.
   Live trials charge real money and deduct the supplier wallet when provisioning succeeds.
5. Deploy and register the verified PayPal webhook described below, and run the
   worker continuously before opening public purchases.

States reserving/sending are deliberately never auto-reclaimed: a timeout
may have occurred after the remote action succeeded. Reconcile in the provider's
portal using the internal order label or stored provider ID before changing state.
For completing, recovery reads the stored provider order and advances only after
its ID, product, completed state and QR have been validated; it never repeats PUT.
Do not reset to paid and risk purchasing twice. Resend acceptance (sent) is not proof
of inbox delivery. Email delivery/bounce webhooks are a further activation task.

Email currently supports SQ, EN, IT, with EN fallback. This is separate from the
36-language signup template. QR data stays server-side; the email embeds the provider
PNG via CID. No QR rendering service receives the activation credential.

No real order or email was created during automated tests. Run:
`node --test scripts/esim-delivery.test.mjs scripts/live-checkout.test.mjs scripts/delivery-worker.test.mjs`

## Background recovery for controlled live checkout

Run `npm run worker:delivery` in a separate long-running process alongside the
local checkout server, with the same live service configuration. This command
can provision real eSIMs and send real emails for already captured payments.
For one sweep, use `npm run worker:delivery -- --once`.

The worker scans unfinished delivery rows using ID pagination and starts again
from the beginning after each sweep, with a 60-second pause. The database is the
durable queue, so process restarts do not lose pending work. Completed PayPal
captures are checked again before provisioning; approved but uncaptured payments
are never captured by the worker. A failing item does not stop later items.
Concurrent workers and browser requests use the same conditional state updates.
No additional database migration is required.

The worker reports internal order IDs requiring manual review, including pending
PayPal links and ambiguous reservation/email outcomes. It never resets these
orders to paid. Logs exclude email addresses and activation credentials.
Use a process supervisor to restart the worker after a crash and monitor its
logs. Stopping it pauses recovery until it runs again. This is a local worker,
not a Vercel background deployment; `npm run dev` does not launch it automatically.

Start a local server with `npm run dev` (or set PORT to a free port).
PAYPAL_ENV=live selects the durable live path; sandbox keeps the isolated test path.
The public deployment still returns checkoutEnabled:false. Before public launch, finish
hosting and alerting for the recovery worker, PayPal webhook registration,
refunds/support handling, and end-to-end real delivery validation.
These deployment and real-payment validation steps remain required.

## Verified live PayPal webhook

The local server and Vercel function expose `POST /api/paypal/webhook`. Set
`PAYPAL_ENV=live`, live PayPal credentials, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and `PAYPAL_WEBHOOK_ID` on the webhook host.
The webhook does not need supplier or email-provider credentials.

After deployment, register the public HTTPS endpoint on the SAME PayPal live
REST app used for checkout and subscribe to `PAYMENT.CAPTURE.COMPLETED`. Copy the
resulting webhook registration ID into `PAYPAL_WEBHOOK_ID`; it is not the client
ID. Ensure the route is reachable without deployment protection/login. Allow
enough function execution time for signature verification, PayPal reads and
database persistence. `vercel.json` sets 180 seconds for this endpoint; enable
Fluid compute or verify that the selected plan permits this duration.

The listener sends the original event JSON and signature headers to PayPal's
verification API, then independently reads the stored PayPal order and checks
its completed capture ID, amount and currency. It acknowledges only after the
payment is durably marked paid (or already processed). Duplicate events cannot
reset delivery state. Unavailable verification/storage returns 503 for retry.
Other verified event types are acknowledged without processing; refunds,
disputes and email bounces still need separate operational handling.

The endpoint does not provision eSIMs. The running worker discovers paid rows.
The public checkout remains disabled. Test with an actual event from a registered
app: PayPal's mock simulator does not support this postback verification method.
No webhook has been registered or real payment made by the automated tests.

## Worker hosting and monitoring

`Dockerfile.worker` packages only the worker's four required source files.
Credentials are injected at runtime; `.env.local` is excluded from the build.
On a Docker-capable host:

```sh
docker build -f Dockerfile.worker -t mobialo-worker .
docker run -d --name mobialo-worker --restart unless-stopped --env-file /secure/path/worker.env mobialo-worker
```

The runtime environment needs `PAYPAL_ENV=live`, `PAYPAL_LIVE_CLIENT_ID`,
`PAYPAL_LIVE_CLIENT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`MOBIMATTER_MERCHANT_ID`, `MOBIMATTER_API_KEY`, and `RESEND_API_KEY`.
Use the host's secret manager where available. This process can buy real eSIMs
for verified payments; start it only on the intended production project.

The Docker health check uses a private local heartbeat updated as the worker
progresses. Missing/stale (five minutes) or failed status makes the check fail.
Outside Docker, run `node scripts/worker-health.mjs` on the same host/user.
The optional `WORKER_HEALTH_FILE` path must be writable by the worker.
Health indicates worker progress, not successful inbox delivery or absence of
manual-review orders. Logs contain counts and internal order IDs, not secrets.

Configure host alerts for an unhealthy/stopped container, `manual_review`,
`retry_or_review`, and nonzero failed counts. Docker's restart policy restarts
an exited process; an unhealthy flag alone does not restart it or send alerts.
Provider monitoring must be configured after selecting hosting. Test a restart
and an upstream outage before enabling public checkout.

Real end-to-end acceptance remains pending: create one explicitly selected live
order, complete payment, confirm the webhook stores the capture, confirm exactly
one provider order and email, replay the event, restart the worker and confirm
no duplicate purchase/email. Record references without activation credentials.

## Sandbox creation limit

Apply `migrations/20261020_test_order_limit.sql` before using sandbox checkout
with this code. Existing databases created through SQL Editor can run this file
directly after the test-order table exists.

Sandbox creation reserves a row through a service-role-only database function
before contacting PayPal. A table lock makes the rolling limit of 100 sandbox
creation attempts per hour atomic across requests and server processes.
Completed, failed and abandoned attempts all count; simulation rows do not.
Existing sandbox rows in the last hour also count. The limit is global to the
test store, not per customer. Rows expire from the count after one hour without
being deleted. Missing migration or database failure blocks creation before
any PayPal call. Ambiguous creation failures retain their reserved slot.

References:
- https://developer.paypal.com/api/rest/webhooks/rest/
- https://docs.docker.com/reference/dockerfile/#healthcheck
- https://vercel.com/docs/functions/configuring-functions/duration
- https://docs.mobimatter.com/docs/guides/placing-order
- https://resend.com/changelog/embed-images-using-cid
