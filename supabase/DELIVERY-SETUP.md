# eSIM delivery preparation

Status: connected to controlled LOCAL live checkout. Public checkout remains disabled.

## Customer dashboard

Run `migrations/20261017_customer_ownership.sql` after the delivery table migration
before testing checkout while signed in. It adds nullable `user_id` and `product_title`.
`/account` provides the customer overview, order history, delivered eSIM orders,
profile updates, password reset and support. The `/api/account/orders` endpoint
verifies the Supabase session server-side and selects only that user's orders.
Existing guest orders remain unassigned; never backfill ownership by an unverified
checkout email. Public payment endpoints are still disabled. The dashboard does
not claim to show data balance or activation status; installation details remain
delivered by email. Test account access with `node --test scripts/customer-orders.test.mjs`.

1. Run migrations/20261017_esim_delivery.sql in the project's SQL Editor.
2. Keep SUPABASE_SERVICE_ROLE_KEY and RESEND_API_KEY server-only.
3. Local checkout records the server-priced product, buyer-entered email and language
   before creating a PayPal order. Email is not identity-verified: the buyer must check
   it before paying. Only realtime products are allowed; test and KYC plans are blocked.
4. Capture checks the stored order capability and rechecks the actual completed payment
   amount, then calls fulfillDelivery. The email and amount cannot be changed at capture.
   Live trials charge real money and deduct the supplier wallet when provisioning succeeds.
5. Implement authenticated order status and verified PayPal webhook reconciliation
   before opening public purchases. No webhook endpoint is installed yet.

States reserving/completing/sending are deliberately never auto-reclaimed: a timeout
may have occurred after the remote action succeeded. Reconcile in the provider's
portal using the internal order label or stored provider ID before changing state.
Do not reset to paid and risk purchasing twice. Resend acceptance (sent) is not proof
of inbox delivery. Email delivery/bounce webhooks are a further activation task.

Email currently supports SQ, EN, IT, with EN fallback. This is separate from the
36-language signup template. QR data stays server-side; the email embeds the provider
PNG via CID. No QR rendering service receives the activation credential.

No real order or email was created during automated tests. Run:
`node --test scripts/esim-delivery.test.mjs scripts/live-checkout.test.mjs`

Start a local server with `npm run dev` (or set PORT to a free port).
PAYPAL_ENV=live selects the durable live path; sandbox keeps the isolated test path.
The public deployment still returns checkoutEnabled:false. Before public launch, finish
the durable background retry queue, PayPal webhooks, refunds/support handling, account
ownership, and end-to-end real delivery validation. These are not implemented yet.

References:
- https://docs.mobimatter.com/docs/guides/placing-order
- https://resend.com/changelog/embed-images-using-cid
