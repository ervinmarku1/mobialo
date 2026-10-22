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

Read-only panel: filters, 50-row pagination, details. Financial and review cards are
explicitly page-scoped, not business-wide revenue. No refund, fulfillment retry,
email resend, or permission editing actions are exposed.

Checks: node --test scripts/admin-orders.test.mjs
