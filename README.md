# MOBIALO

Bilingual English and Albanian eSIM storefront presentation, inspired by travel eSIM storefronts. This project currently runs locally only.

## Run locally

Install Node.js, then run from the project directory:

```sh
npm run dev
```

Open http://localhost:3000. No package installation is required. Set the `PORT` environment variable to use another port.

## Files

- `dist/index.html`: page structure.
- `dist/styles.css`: responsive styling.
- `dist/app.js`: translations, sample catalog, destination search, and plan preview.
- `scripts/serve.mjs`: local HTTP server.

## Current scope

All plans and prices are demonstration data. Checkout is disabled. GitHub stores the source only; there is no deployment workflow. Domain setup, Supabase, payments, and MobiMatter integration are deferred.

Never put partner API credentials in browser code or commit secrets. Future MobiMatter requests must go through a server-side integration.

Fonts, travel photos, and flags currently load from external services and need an internet connection.

## Check JavaScript syntax

```sh
npm run check
```
