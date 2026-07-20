# Customer management and QuickBooks

Phase one makes ftops the system of record for customer relationships and operational data while QuickBooks Online remains the accounting system of record.

## Ownership

ftops owns customer status, lead source, multiple contacts, internal notes, operational addresses, projects, tasks, and activity history. QuickBooks owns the accounting customer identity, formal billing data, estimates, invoices, payment state, balances, tax, discount, and financial totals. QuickBooks financial records are read-only mirrors in the ftops UI.

Customer records do not require a QuickBooks link. Their lifecycle is `lead`, `prospect`, `active`, `past`, then `archived`; archiving preserves history.

## Linking and synchronization

Users explicitly search for and confirm a QuickBooks customer link. A fuzzy name result is never linked automatically, and a QuickBooks customer cannot be linked to multiple ftops customers in one workspace/integration. Users may instead create a QuickBooks customer from the ftops display name, company, primary email, and phone. Tokens are only decrypted in the API worker and are never returned to the UI.

Inbound flow:

1. The webhook worker verifies the Intuit signature and enqueues the existing normalized message.
2. The API stores the original request/event and extracts Customer, Estimate, and Invoice change IDs.
3. The API fetches each current entity from QuickBooks rather than treating the webhook payload as canonical.
4. It idempotently upserts the mirror, external mapping, sync token/timestamps, and activity.
5. Errors remain on the event and mapping for display and retry.

An estimate or invoice for an unlinked QuickBooks customer causes that customer to be imported as a staged `active` customer with `customer_type=quickbooks`. This preserves the financial record and makes it reviewable without guessing a relationship match. Delete/void-like remote state is represented as status and never hard-deletes a mirror.

Mappings use `linked`, `pending_push`, `pending_refresh`, `conflict`, and `error`; an absent mapping is reported as `not_linked`. Older entity timestamps are ignored. A stale-token/HTTP 409 response is exposed as a conflict and requires explicit refresh/retry; ftops does not silently overwrite QuickBooks.

## Configuration and local tests

QuickBooks integration secrets remain encrypted using `INTEGRATIONS_MASTER_KEY` and `INTEGRATIONS_KEY_ID`. In addition to `webhookVerifierToken`, API synchronization needs an OAuth `accessToken`. `apiBaseUrl` may be set to a mock server in tests; otherwise sandbox/production Intuit URLs are selected from the integration environment. `minorVersion` is optional.

Run migrations and verification with:

```sh
npm --workspace apps/api run db:migrate:local
npm run verify
```

Tests mock the QuickBooks HTTP API and do not require a live account. Shopify synchronization, email, uploads, automated messaging, forecasting, and editable invoices are intentionally out of scope for phase one.
