# ftops UI

Minimal internal UI for testing ftops endpoints (plan preview + events).

## Local development

```bash
npm install
npm run dev
```

## Configure API base URL

Set `VITE_FTOPS_API_BASE_URL` before running `npm run dev` or `npm run build`.
In production, the UI defaults to the internal `/api` proxy on `ops.from-trees.com`.

```bash
# Local API (default)
VITE_FTOPS_API_BASE_URL=http://localhost:8787 npm run dev

# Production API (optional override)
VITE_FTOPS_API_BASE_URL=/api npm run dev
```

## Dev identity (local auth bypass)

When running against a local API with debug auth enabled, set a default identity:

```bash
VITE_DEBUG_EMAIL=you@example.com npm run dev
```

You can also edit the "Dev identity" field in the UI header (dev only).

## SSR + RSC

This app uses React Router framework mode with SSR on Cloudflare and includes a server component
banner to verify RSC is enabled.

## Build

```bash
npm run build
```

The build output includes both client and server bundles for Cloudflare SSR.

## Deploy

```bash
npm run deploy
```

Requires a Cloudflare API token in the environment for Wrangler (`CLOUDFLARE_API_TOKEN`).
