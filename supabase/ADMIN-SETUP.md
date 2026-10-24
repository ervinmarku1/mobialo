# MOBIALO admin

Separate page: `/admin` (dist/admin.html; src/admin*.js bundled into dist/admin.js by
`npm run build:auth`).

Server environment variables (Production in Vercel):
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY (secret; never expose through public prefixes)
- ADMIN_USER_IDS (comma-separated Supabase user UUIDs, not email addresses)
- SUPER_ADMIN_USER_IDS (the owner's UUID only; enables the approval workflow and
  always requires 2FA for that account)

The owner's account is the superadmin. The UUID values are saved
in local .env.local; copy them to Vercel and never add them to source control.
The existing public authentication configuration also needs SUPABASE_PUBLISHABLE_KEY.

The admin panel lives at https://www.mobialo.eu/admin. admin.mobialo.eu stays attached
to the project but redirects every path there (vercel.json), because sessions are
stored per origin and checkout only accepts https://www.mobialo.eu. Signing in at
www.mobialo.eu/admin therefore also signs in the shop. Redeploy after env edits.

Sign in with the existing verified owner account and enter the Authenticator code.
Authentication is checked with the auth server on every API request. Authorization
uses server-configured immutable user IDs, never editable user_metadata or email input.
RLS on the orders table stays enabled; customers have no direct table access.

Supabase Auth settings (Authentication → Sign In / Providers → Email; set on 23.10.2026 through
the Management API and checked there): minimum password length 8, the same as the sign-up form;
secure password change on (a password change needs a sign-in from the last 24 hours, which the
reset link always provides); secure email change on. Sessions have no time limit (a paid-plan
setting).

CAPTCHA (Cloudflare Turnstile, chosen by the owner on 23.10.2026) protects sign-up, sign-in, the
password reset email (also from /account) and the admin sign-in (src/captcha.js). The widget stays
invisible unless Cloudflare needs the visitor to interact. Turn it on in this order, or sign-in breaks:
1. Cloudflare dashboard → Turnstile → Add widget: hostnames www.mobialo.eu and mobialo.eu, mode
   Managed. It gives a site key (public) and a secret key.
2. Put the site key in `TURNSTILE_SITE_KEY` in scripts/supabase-config.mjs (or the Vercel variable of
   the same name) and deploy; /api/auth-config then serves it and the forms send a token, which
   Supabase ignores while CAPTCHA is off. Check that sign-in still works. The privacy policy must name
   Cloudflare Turnstile from the same deploy on (dist/information.js and dist/privacy.html); without a
   site key the code loads nothing from Cloudflare.
3. Supabase → Authentication → Attack Protection → Enable CAPTCHA protection → Turnstile → paste
   the secret key → Save. Sign in to /admin to confirm. To undo, switch CAPTCHA off there first.

Overview (`GET /api/admin/orders?summary=1`, same gates as the orders): money kept (refunds subtracted)
and paid orders for the last 24 hours, 7 and 30 days, revenue per UTC day for 14 days, checkouts of the
last 7 days left unpaid (open or expired), how many of the 30 days' checkouts were paid, refunds and
disputes, and the orders locked for a manual check. Every admin sees it. Orders: filters, 50-row
pagination, the order page with its steps from payment to the eSIM email. No refund, fulfillment retry
or email resend actions are exposed.

Cilësimet (superadmin only, always with 2FA; `GET/POST /api/admin/settings`):
- Shop status: Mbyllur / Vetëm admin / Publik. Publik can only be switched on while
  the delivery worker heartbeat is fresh (under 10 minutes), and checkout falls back
  to admin-only by itself if the worker stops reporting.
- Payment methods: PayPal and guest card ("Debit or Credit Card"), not both off.
- Pricing: markup (0–200%), processing fee (0–10%) and fixed fee (0–2 EUR); applied
  to the catalog and to new orders within about 30 seconds.
- Administrators: approve or reject requests and revoke approved access. Superadmins
  and `ADMIN_USER_IDS` entries are read-only here (change them in Vercel).
- System status: PayPal credentials, webhook, Supabase, MobiMatter catalog, email
  (Resend), and the worker's last report.

Settings are stored in `public.app_settings` (migration 20261022150000_app_settings.sql,
already applied) and access requests in `public.admin_access_requests` (migration
20261022074725_admin_access_requests.sql). The full migration order and a query that shows
which ones are applied are in DELIVERY-SETUP.md. A saved row wins over the Vercel
`CHECKOUT_MODE`, which remains the fallback before the first save and is capped at
admin-only during a Supabase outage.
Keep `CHECKOUT_MODE=admin` (or closed) in Vercel.

Checks: node --test scripts/admin-orders.test.mjs scripts/admin-access.test.mjs scripts/admin-settings-api.test.mjs scripts/app-settings.test.mjs
