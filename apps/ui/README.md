# ftops UI

Minimal internal UI for testing ftops endpoints (plan preview + events).

## Local development

```bash
npm install
npm run dev
```

## Configure API base URL

Set `VITE_FTOPS_API_BASE_URL` before running `npm run dev` or `npm run build`.

```bash
# Local API (default)
VITE_FTOPS_API_BASE_URL=http://localhost:8787 npm run dev

# Production API
VITE_FTOPS_API_BASE_URL=https://api.from-trees.com npm run dev
```

## Build

```bash
npm run build
```

The build output is a static site suitable for Cloudflare Pages.
