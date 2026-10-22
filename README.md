# MOBIALO

Live eSIM shop at https://www.mobialo.eu, in Albanian and English (visitors from Italy get
Italian automatically). It sells MobiMatter eSIMs for real money through PayPal (live).
Vercel deploys every push to `main` straight to production.

## Architecture

- **Vercel** serves `dist/` as static files and `api/**/*.mjs` as Node 24 functions.
  `vercel.json` sets the build command (`npm run build:auth`), function durations, security
  headers, the rewrites for `/admin`, `/join`, `/sign-in`, `/forgot-password`,
  `/update-password` and `/account`, and the redirect of `admin.mobialo.eu` to
  https://www.mobialo.eu/admin.
- **Frontend**: hand-written HTML, CSS and classic scripts in `dist/`. `dist/auth.js`,
  `dist/customer-session.js` and `dist/admin.js` are esbuild bundles of `src/` (they embed
  `@supabase/supabase-js`): edit `src/`, run `npm run build:auth` and commit both. Never edit
  the bundles by hand; CI fails when they differ from a fresh build.
- **API**: `api/*.mjs` are thin adapters. The logic lives in `scripts/*.mjs`, shared with the
  local server and the tests.
- **Supabase**: authentication (email and password, Authenticator 2FA for admins), the tables
  `esim_deliveries` (orders and delivery queue), `esim_test_orders` (sandbox only),
  `admin_access_requests` and `app_settings` (Cilësimet and the worker heartbeat), and Vault
  secrets for the worker. Browsers never access the tables; only the server's service-role
  key does.
- **PayPal (live)**: hosted checkout through `/api/paypal/config`, `/api/paypal/create` and
  `/api/paypal/capture`, plus the verified webhook `/api/paypal/webhook`. A capture only
  marks the order `paid`.
- **Delivery worker**: Supabase pg_cron job `mobialo-delivery-sweep` POSTs to
  `/api/worker/sweep` every minute. The sweep buys the eSIM from MobiMatter, emails the QR
  code through Resend and writes the heartbeat shown in Cilësimet.
- **Admin**: https://www.mobialo.eu/admin. Orders, and Cilësimet (superadmin only): shop mode
  (Mbyllur / Vetëm admin / Publik), payment methods, pricing, administrators and system
  status. See [supabase/ADMIN-SETUP.md](supabase/ADMIN-SETUP.md).

Checkout, delivery, the webhook, the worker, monitoring and the database migration order
are documented in [supabase/DELIVERY-SETUP.md](supabase/DELIVERY-SETUP.md).

| Endpoint | Purpose |
| --- | --- |
| `GET /api/catalog` | New-eSIM catalog with server-side EUR prices |
| `GET /api/auth-config` | Supabase URL and publishable key for browser sign-in |
| `GET /api/locale` | Site and email language from the Vercel IP country |
| `/api/paypal/config`, `create`, `capture` | Hosted checkout (session, mode and 2FA checks) |
| `POST /api/paypal/webhook` | Verified `PAYMENT.CAPTURE.COMPLETED` reconciliation |
| `POST /api/worker/sweep` | Delivery sweep, called by pg_cron with `x-worker-secret` |
| `GET /api/account/orders` | The signed-in customer's orders |
| `/api/admin/orders`, `access`, `settings` | Admin panel: orders, access requests and approvals, Cilësimet |

## Configuration

`.env.example` lists every variable the code reads, with comments. Vercel reads them from
Project Settings > Environment Variables (Production); locally they go in `.env.local`,
which is ignored by Git. Redeploy after changing Vercel variables. Never put credentials in
browser code or commit them; MobiMatter, PayPal secrets, the service-role key and Resend
stay on the server.

Supabase Auth: Email signups and email confirmation enabled, custom SMTP (Resend) for
customer emails, Site URL https://www.mobialo.eu and the redirect allowlist
https://www.mobialo.eu/** (add http://localhost:3000/** for local sign-in). The email
templates in `supabase/email-templates` are pasted into the dashboard by hand; see
[supabase/email-templates/README.md](supabase/email-templates/README.md).

## Pricing

Prices are computed on the server from the MobiMatter USD retail price, which is treated
numerically as EUR (a selling-price rule, not an exchange-rate conversion; non-USD supplier
prices are rejected). Base price: `retail × (1 + markup)`, rounded to cents. Displayed and
charged price: `ceil_to_cent((base + fixed fee) / (1 − fee %))`, the same for every payment
method, with no surcharge at checkout. Markup and fees are set in Cilësimet (defaults in
`DEFAULT_PRICING`, scripts/app-settings.mjs: 20% markup, 2.5% + EUR 0.20) and apply to the
catalog and to new orders within about 30 seconds. Existing orders keep their stored price.

The public catalog contains new eSIM products only; top-ups and replacements are excluded.
Identity-verification (delayed) products carry an explicit flag; checkout accepts realtime
products only. Without MobiMatter credentials, `/api/catalog` serves the checked-in snapshot
`dist/catalog-preview.json` (allowlisted fields, no credentials or wholesale prices).
Catalog errors (`NOT_CONFIGURED`, `AUTH_FAILED`, `UPSTREAM_UNAVAILABLE`, `INVALID_CATALOG`)
are never returned as an empty catalog.

## Languages and emails

`/api/locale` maps `x-vercel-ip-country`: IT → Italian, AL/XK → Albanian, anything else →
English. A language chosen in the menu is stored under `mobialo-language-choice` and wins
over detection. No IP address is stored. Signup saves the resolved email language (36
languages) in `user_metadata.language`; delivery emails support SQ, EN and IT.

## Development

Requires Node.js 24 (`engines`). Install with `npm ci`.

```sh
npm test              # node --test "scripts/*.test.mjs" (offline, no real payments or emails)
npm run check         # syntax of every script, JSON files, .env.example and migration docs, then the tests
npm run build:auth    # rebuild dist/auth.js, dist/customer-session.js and dist/admin.js from src/
npm run dev           # local server on http://localhost:3000 (PORT to change it)
```

GitHub Actions (`.github/workflows/ci.yml`) runs `npm ci`, `node scripts/check-build.mjs`,
the tests and a bundle drift check on every push and pull request to `main`. Vercel deploys
`main` whether or not CI passes; to make CI a gate, merge through pull requests with the
check required (and use Vercel preview deployments to try changes).

### Local development uses whatever `.env.local` points at

With the production Supabase keys in `.env.local`, `npm run dev` works on the LIVE data:
local sign-ins, orders and admin actions (Cilësimet, approvals) change the live shop. With
`PAYPAL_ENV=live` as well, it creates real PayPal orders, and a completed local capture
immediately buys a real eSIM and sends the email. The local server skips the hosted
checkout gates (shop mode, admin list, 2FA, worker heartbeat, ownership check on capture);
it listens on 127.0.0.1 only. Use `PAYPAL_ENV=sandbox` with sandbox credentials locally,
preferably with a separate Supabase project: sandbox orders go to `esim_test_orders`, are
limited to 100 an hour and never buy an eSIM. Set `LOCAL_COUNTRY=IT` in the shell to
simulate an Italian visitor.

Fonts, travel photos, flags and provider logos load from external services and need an
internet connection.
