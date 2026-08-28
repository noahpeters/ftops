# Webhooks

Webhook ingress is split into a dedicated Cloudflare Worker (`ftops-webhooks`) that validates
provider signatures and enqueues normalized envelopes to provider-specific queues.
Downstream processing (D1 writes to `raw_events`) happens in the API worker queue consumer.

## Endpoints

- QuickBooks: `POST /ingest/qbo/webhook?env=production|sandbox`
- Shopify: `POST /ingest/shopify/webhook?env=production|sandbox`
- Quo: `POST /ingest/quo/:integrationId/webhook`

`/ingest/requests` and `/ingest/requests/:id` remain on the API worker for browsing stored events.

## Routing

Route the webhook paths to the new worker so external URLs remain unchanged:

- `api.from-trees.com/ingest/qbo/webhook*` → `ftops-webhooks`
- `api.from-trees.com/ingest/shopify/webhook*` → `ftops-webhooks`
- `api.from-trees.com/ingest/quo/*` → `ftops-webhooks`

Keep `/ingest/requests*` routed to the API worker.

## Envelope format

Each webhook request is normalized and enqueued with:

- `id` (provider event id if present, else sha256 of stable inputs)
- `source` (`quickbooks`, `shopify`, or `quo`)
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

## Quo setup

Create or update the workspace's Quo integration with these encrypted secret fields:

- `apiKey`: the Quo API key used by the existing FTOPS → Quo Contact sync
- `webhookSigningSecret`: required for call ingestion; the base64 signing secret revealed in the
  Quo webhook details

Copy the integration-specific URL shown in FTOPS Integrations into Quo, and subscribe it to
`call.completed`. The worker verifies the `openphone-signature` HMAC and rejects signatures more
than five minutes old. Never put either secret in the webhook URL or source configuration.

Matched callers are resolved against normalized Contact phone numbers and receive an idempotent
Customer note. An unmatched incoming call creates a person Customer in `lead` status plus its human
Contact only when the call was answered for at least 15 seconds or includes a voicemail of at least
3 seconds. Spam-labeled, short, empty, invalid-number, and unmatched outgoing calls are recorded as
ignored ingestion outcomes and do not create Customers.
