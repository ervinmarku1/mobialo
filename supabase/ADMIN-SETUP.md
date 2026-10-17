# MOBIALO admin

Separate page: `/admin`. Landing page files are unchanged.

Server environment variables (Production in Vercel):
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY (secret; never expose through public prefixes)
- ADMIN_USER_IDS (comma-separated Supabase user UUIDs, not email addresses)

The authorized owner's verified UUID is already saved as ADMIN_USER_IDS in local
.env.local. Copy that value to Vercel; do not add it to source control.
The existing public authentication configuration also needs SUPABASE_PUBLISHABLE_KEY.

In Vercel add admin.mobialo.eu to this project. At the DNS provider add the CNAME
named admin using the exact target Vercel shows. The host-specific root rewrite
serves admin.html; the normal website root remains index.html. Redeploy after env edits.

Log in separately on the admin subdomain with the existing verified owner account.
Authentication is checked with the auth server on every API request. Authorization
uses server-configured immutable user IDs, never editable user_metadata or email input.
RLS on the orders table stays enabled; customers have no direct table access.

Read-only panel: filters, 50-row pagination, details. Financial and review cards are
explicitly page-scoped, not business-wide revenue. No refund, fulfillment retry,
email resend, or permission editing actions are exposed.

Checks: node --test scripts/admin-orders.test.mjs
