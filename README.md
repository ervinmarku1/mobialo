# MOBIALO

Live eSIM shop at https://www.mobialo.eu, in English, Albanian and Italian (pages under `/sq` and
`/it`; the language is suggested from the visitor's country and can be changed). It sells MobiMatter eSIMs for real money through PayPal (live).
Vercel deploys every push to `main` straight to production.

## Architecture

- **Vercel** serves `dist/` as static files and `api/**/*.mjs` as Node 24 functions.
  `vercel.json` sets the build command (`npm run build:auth`), function durations, security
  headers, the rewrites for `/admin`, `/join`, `/sign-in`, `/forgot-password`,
  `/update-password`, `/account` (and `/account/orders/:id`, `/admin/orders/:id`), `/devices` (with
  `/sq/devices` and `/it/devices`, pre-rendered as `devices-sq.html` and `devices-it.html`), the
  storefront pages and `/sitemap.xml`, the redirect of old `/?plan={id}` links and the redirect of
  `admin.mobialo.eu` to https://www.mobialo.eu/admin.
- **Storefront pages** (no popups): `/esim` (every destination, with search), `/esim/{country}`,
  `/esim/region/{region}` (`global` included) and the plan pages `/esim/{destination}/{productId}` with
  the checkout in the page; Albanian and Italian under `/sq` and `/it`. `api/store.mjs` renders them
  on the server (`scripts/storefront-pages.mjs`) with the browser's own `dist/storefront-core.js`
  (grouping, slugs, links, cards), loaded through `node:vm`, from the same catalog and prices as
  `/api/catalog`. The homepage links to them; old `/?plan={id}` links are redirected by the server to
  the plan page (`/api/store?page=legacy`). Plan pages send the price they showed with the order, and
  checkout refuses to charge a different one (409 `PRICE_CHANGED` with the current price).
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
- **Admin**: https://www.mobialo.eu/admin. Overview (money kept and paid orders for 24 hours, 7 and 30
  days, unpaid checkouts, orders to check, revenue per day for 14 days; `/api/admin/orders?summary=1`), orders
  with their progress from payment to the eSIM email, and Cilësimet (superadmin only): shop mode
  (Mbyllur / Vetëm admin / Publik), payment methods, pricing, administrators and system
  status. See [supabase/ADMIN-SETUP.md](supabase/ADMIN-SETUP.md).

Checkout, delivery, the webhook, the worker, monitoring and the database migration order
are documented in [supabase/DELIVERY-SETUP.md](supabase/DELIVERY-SETUP.md).

The Vercel Hobby plan deploys at most 12 functions (files under `api/`); a 13th makes the deployment fail.
There are 12, so new endpoints go into an existing function behind a rewrite (as `/api/catalog` does).

| Endpoint | Purpose |
| --- | --- |
| `GET /api/catalog` | New-eSIM catalog with server-side EUR prices (CDN 60 s, then 10 min stale while it refreshes); rewritten to `api/store.mjs?page=catalog` |
| `GET /api/store` | Storefront pages and `/sitemap.xml` through the `/esim` rewrites (CDN 5 min, then 10 min stale; 404 1 min); `?page=warm` is the pg_cron warm-up (204, no-store) |
| `GET /api/auth-config` | Supabase URL and publishable key for browser sign-in |
| `GET /api/locale` | Site and email language from the Vercel IP country |
| `/api/paypal/config`, `create`, `capture` | Hosted checkout (mode, 2FA, consent, guest limits, order capability) |
| `POST /api/paypal/webhook` | Verified capture reconciliation; records refunds, reversals, denials and disputes |
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
over detection. Locale detection stores no IP address (guest orders keep only a keyed
hash of it for the abuse limits). Signup saves the resolved email language (36
languages) in `user_metadata.language`; delivery emails support SQ, EN and IT.

## Development

Requires Node.js 24 (`engines`). Install with `npm ci`.

```sh
npm test              # node --test "scripts/*.test.mjs" (offline, no real payments or emails)
npm run check         # syntax of every script, JSON files, .env.example and migration docs, then the tests
npm run build:auth    # rebuild dist/auth.js, dist/customer-session.js and dist/admin.js from src/
npm run dev           # local server on http://localhost:3000 (PORT to change it)
npm run smoke         # read-only check of the live shop in headless Chrome (BASE_URL to change the site)
```

GitHub Actions (`.github/workflows/ci.yml`) runs `npm ci`, `node scripts/check-build.mjs`,
the tests and a bundle drift check on every push and pull request to `main`. Vercel deploys
`main` whether or not CI passes; to make CI a gate, merge through pull requests with the
check required (and use Vercel preview deployments to try changes).

`.github/workflows/smoke.yml` runs `scripts/smoke-test.mjs` against https://www.mobialo.eu after
Vercel has deployed each push to `main`, every day at 06:17 UTC and on demand: the main pages answer,
the catalog and checkout configuration load, the home page shows destinations, a plan page mounts
the PayPal buttons (when checkout is open), and no page throws, logs an error, loads Google Fonts or
shows broken characters. It never creates an order or signs in. GitHub emails a failure to whoever
pushed (for the daily run, to whoever last changed the workflow file).

### Local development uses whatever `.env.local` points at

With the production Supabase keys in `.env.local`, `npm run dev` works on the LIVE data:
local sign-ins change the live accounts. With `PAYPAL_ENV=live` as well, the local server
refuses PayPal create, capture and webhook and every admin route (403 `LOCAL_LIVE_BLOCKED`),
so it cannot take money, buy an eSIM or change Cilësimet. `ALLOW_LOCAL_LIVE=1` in the shell
lifts that guard: then it creates real PayPal orders, a completed local capture immediately
buys a real eSIM and sends the email, and it skips the hosted checkout gates (shop mode,
admin list, 2FA, worker heartbeat, ownership check on capture). It listens on 127.0.0.1 only. Use `PAYPAL_ENV=sandbox` with sandbox credentials locally,
preferably with a separate Supabase project: sandbox orders go to `esim_test_orders`, are
limited to 100 an hour and never buy an eSIM. Set `LOCAL_COUNTRY=IT` in the shell to
simulate an Italian visitor.

Fonts, travel photos, flags and provider logos load from external services and need an
internet connection.
