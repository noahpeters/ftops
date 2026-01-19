# Webhooks

Webhook ingress is split into a dedicated Cloudflare Worker (`ftops-webhooks`) that validates
provider signatures and enqueues normalized envelopes to the `events-qb-ingest` queue.
Downstream processing (D1 writes to `raw_events`) happens in the API worker queue consumer.

## Endpoints

- QuickBooks: `POST /ingest/qbo/webhook?env=production|sandbox`
- Shopify: `POST /ingest/shopify/webhook?env=production|sandbox`

`/ingest/requests` and `/ingest/requests/:id` remain on the API worker for browsing stored events.

## Routing

Route the webhook paths to the new worker so external URLs remain unchanged:

- `api.from-trees.com/ingest/qbo/webhook*` → `ftops-webhooks`
- `api.from-trees.com/ingest/shopify/webhook*` → `ftops-webhooks`

Keep `/ingest/requests*` routed to the API worker.

## Envelope format

Each webhook request is normalized and enqueued with:

- `id` (provider event id if present, else sha256 of stable inputs)
- `source` (`quickbooks` or `shopify`)
- `workspaceId`, `realmId`/`externalAccountId`, `integrationId`
- `receivedAt`, `path`, `method`
- `headers` (minimal subset)
- `body` (raw string) and `contentType`
- `signature`, `signatureVerified`, `verifyError`

## Local dev

```sh
npm run dev:api
npm run dev:webhooks
```

Use the webhooks worker port when testing ingress locally (default `wrangler dev` port unless
overridden).
