# MOBIALO

Bilingual English and Albanian eSIM storefront presentation, inspired by travel eSIM storefronts. This project currently runs locally only.

## Run locally

Install Node.js, then run from the project directory:

```sh
npm run dev
```

Open http://localhost:3000. Run `npm install` first to install the pinned dependencies. Set the `PORT` environment variable to use another port.

## Files

- `dist/index.html`: page structure.
- `dist/styles.css`: responsive styling.
- `dist/app.js`: translations, sample catalog, destination search, and plan preview.
- `scripts/serve.mjs`: local HTTP server.

## Current scope

Plans and prices are read from the live MobiMatter catalog through the local server. Checkout is disabled. GitHub stores the source only; there is no deployment workflow. Domain setup, Supabase, payments, and eSIM ordering are deferred.

Never put partner API credentials in browser code or commit secrets. MobiMatter requests go through the server-side integration.

## Local MobiMatter catalog connection

Requires Node.js 22 or newer. Enter the Merchant ID and API Key from the partner
portal in `.env.local`, using `.env.example` as a template. Never share or commit
this file. The local server reads it for catalog requests; no restart is needed
after changing the credentials.

`GET /api/catalog` reads the merchant product catalog through the server. It uses
a five-minute in-memory cache and returns only customer-facing fields. Prices
use the merchant's EUR selling-price rule: the numerical MobiMatter USD retail
price multiplied by 1.20, rounded to two decimals. For example, 20 USD becomes
24 EUR. This is not an exchange-rate conversion. Non-USD supplier input is rejected. Validity is
returned in hours. New eSIM products are included; top-ups and replacements are
excluded. Identity-verification products carry an explicit flag.

The storefront loads /api/catalog and groups all new-sale plans by country coverage.
Prices are displayed in EUR, with the markup applied once on the server. Credentials are required; request failures show a retry
state rather than fabricated demo prices.
There are no order or payment endpoints. Nothing is deployed.

Catalog error codes include `NOT_CONFIGURED`, `AUTH_FAILED`, `UPSTREAM_UNAVAILABLE`
and `INVALID_CATALOG`. A failed request is never returned as an empty catalog.

Run adapter checks with `node --test scripts/mobimatter.test.mjs`.

Documentation: https://docs.mobimatter.com/docs/guides/getting-products

Fonts, travel photos, and flags currently load from external services and need an internet connection.

## Check JavaScript syntax

```sh
npm run check
```

## Supabase authentication (local frontend)

Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env.local. Only the validated
publishable key is exposed by /api/auth-config; MobiMatter credentials stay private.
Supabase Email signups and email confirmation must be enabled. Site URL should be
http://localhost:3000 and the local redirect allowlist http://localhost:3000/**.

Routes: /join, /sign-in, /forgot-password, /update-password, /account.
The official browser SDK manages PKCE confirmation, sessions and token refresh.
Confirmation and recovery links should be opened in the same browser that requested
them, with the local server running. Passwords go directly to Supabase over HTTPS.
The browser stores session tokens, never application-saved passwords. Sign out is
local to the current session. No order data or protected application API exists yet.

Edit src/auth.js and src/auth-copy.js, then run npm run build:auth to regenerate
dist/auth.js. Do not edit the generated bundle directly.

For delivery to customer email addresses, configure custom SMTP in Supabase.
The default Supabase email service has restrictions and is intended for testing.


### Local PayPal Sandbox
Set PAYPAL_ENV=sandbox, PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env.local. Live mode is deliberately rejected. Open a plan, view details, and choose PayPal Sandbox. Use a Sandbox Personal buyer from PayPal Developer, not your real account. The server creates EUR orders from its catalog pricing and validates completed captures after the redirect. No MobiMatter order is placed. Test orders are in memory, expire after an hour and are lost on server restart. This is a guest test flow, not production checkout: persistent account-linked orders, verified webhooks, reconciliation, refunds and fulfillment are still required before going live.

Smart Buttons: plan details now load the PayPal JavaScript SDK on demand. Only the public Client ID is returned by /api/paypal/config. PayPal and card buttons render according to SDK eligibility; Sandbox eligibility does not establish Live eligibility. Orders and captures remain server-side and Sandbox-only.


### Vercel domain preview
vercel.json serves dist and the api functions on Node 24. The checked-in catalog-preview.json is an allowlisted catalog snapshot, with no merchant credentials or wholesale prices. Configure MOBIMATTER_MERCHANT_ID and MOBIMATTER_API_KEY in Vercel to use live catalog data. Configure SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY and authorize the production callback URLs in Supabase before enabling online accounts. Without them the hosted page displays an account-preview message. Hosted checkout is intentionally unavailable: local Sandbox uses in-memory orders and is not suitable for serverless payment reconciliation. No PayPal secret is deployed.


### Automatic language and emails
Vercel /api/locale maps x-vercel-ip-country: IT ? Italian, AL/XK ? Albanian, other/unknown ? English. Responses are private/no-store. Localhost defaults to English; LOCAL_COUNTRY=IT can simulate Italy for local QA. No IP is stored. Menu choices remain EN/SQ; detected Italian is displayed as IT ? Auto, not an extra selectable language. Explicit choices persist under mobialo-language-choice, separately from automatic detection. Old automatically stored mobialo-language values are not treated as explicit choices.

Signup writes the independently resolved email locale to user_metadata.language. Emails now support 36 languages: IP country first, browser preference for multilingual countries, manual EN/SQ always wins. Website translations remain EN/SQ/IT. Apply the files under supabase/email-templates in the Supabase dashboard to enable localized emails; repository deployment alone does not install email templates. Existing accounts without this metadata receive English. Recovery follows the registration language. Provider-supplied package descriptions and product names remain in the source language; storefront labels and country names are localized.
