# MOBIALO admin

Separate page: `/admin`. Landing page files are unchanged.

Server environment variables (Production in Vercel):
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY (secret; never expose through public prefixes)
- ADMIN_USER_IDS (comma-separated Supabase user UUIDs, not email addresses)
- SUPER_ADMIN_USER_IDS (the owner's UUID only; enables the approval workflow and
  always requires 2FA for that account)

The owner (ervinmarku1989@hotmail.com) is the superadmin. The UUID values are saved
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

Orders: filters, 50-row pagination, details. Financial and review cards are
explicitly page-scoped, not business-wide revenue. No refund, fulfillment retry or
email resend actions are exposed.

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
already applied). A saved row wins over the Vercel `CHECKOUT_MODE`, which remains the
fallback before the first save and is capped at admin-only during a Supabase outage.
Keep `CHECKOUT_MODE=admin` (or closed) in Vercel.

Checks: node --test scripts/admin-orders.test.mjs scripts/admin-settings-api.test.mjs scripts/app-settings.test.mjs
