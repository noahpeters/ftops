# Customer management and QuickBooks

Phase one makes ftops the system of record for customer relationships and operational data while QuickBooks Online remains the accounting system of record.

## Ownership

ftops owns customer status, lead source, multiple contacts, internal notes, operational addresses, projects, tasks, and activity history. QuickBooks owns the accounting customer identity, formal billing data, estimates, invoices, payment state, balances, tax, discount, and financial totals. QuickBooks financial records are read-only mirrors in the ftops UI.

Mirrored QuickBooks fields are stored so ftops can show accounting context beside operational work, associate estimates and invoices with customers and projects, remain useful during short QuickBooks outages, process webhook changes idempotently, and audit the last successfully fetched canonical state. Document numbers, dates, status, currency, subtotal, tax, discount, total, invoice balance, `SyncToken`, external update time, and the raw canonical payload are retained for those purposes. They are never treated as ftops-owned editable values; QuickBooks remains authoritative and a refresh replaces the mirror.

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

QuickBooks integration secrets remain encrypted using `INTEGRATIONS_MASTER_KEY` and `INTEGRATIONS_KEY_ID`. Company access and refresh tokens are stored only in each encrypted integration record; they are not static Worker secrets and are never returned to the UI or logs. `apiBaseUrl` may be set to a mock server in tests; otherwise sandbox/production Intuit URLs are selected from the integration environment. `minorVersion` is optional.

The QuickBooks realm ID is also stored inside the AES-GCM-encrypted integration secret. D1 stores a SHA-256 realm hash for webhook routing and a non-reversible abbreviated label for display. Legacy integrations retain plaintext realm IDs until their next successful OAuth reconnection, which migrates them to encrypted/hash storage.

### Intuit and Cloudflare setup

Configure the Intuit Developer Portal application with this exact redirect URI:

```text
https://ops.from-trees.com/api/integrations/qbo/callback
```

The only requested OAuth scope is `com.intuit.quickbooks.accounting`. Configure the QuickBooks webhook endpoint as:

```text
https://api.from-trees.com/ingest/qbo/webhook?env=production
```

Set these API Worker secrets with `wrangler secret put`; do not commit them or add them to `wrangler.toml`:

- `QBO_CLIENT_ID`
- `QBO_CLIENT_SECRET`
- `QBO_OAUTH_STATE_SECRET` (a long, random signing secret)
- `INTEGRATIONS_MASTER_KEY` (32-byte key used for integration-secret encryption)

`INTEGRATIONS_KEY_ID` and the production `QBO_REDIRECT_URI` are non-secret bindings. Sandbox and production use separate Intuit application credentials in their respective Worker environments. Ensure the encrypted integration also retains the Intuit webhook verifier token so the ingress worker can verify signatures.

### Connecting and importing

1. A workspace administrator opens **Integrations**, selects sandbox or production, and chooses **Connect or reconnect QuickBooks**.
2. ftops creates a signed, one-time, ten-minute state bound to that workspace, administrator, and environment, then redirects to Intuit.
3. The callback consumes the state and authorization code once and stores the realm ID plus encrypted rotating tokens.
4. The administrator chooses **Start or resume bootstrap**. The existing event queue imports Customers, then Estimates, then Invoices in 100-record pages. Progress and sanitized errors are visible on the Integrations page.
5. Once complete, the existing verified webhook flow supplies incremental changes.

Bootstrap jobs persist their current entity type, `STARTPOSITION`, imported count, timestamps, and errors. Repeating a completed import is safe because external mappings are unique and entity upserts are idempotent. Restarting a failed job resumes its saved page.

### Token refresh and reconnects

Before a QuickBooks request, ftops refreshes an access token when it is expired or within five minutes of expiration. A 401 forces one refresh and one retry. Intuit refresh-token rotation is always persisted. A D1 token-version compare prevents a slower concurrent refresh from overwriting a newer token. Revoked or expired authorization marks the integration `reconnect_required`; an administrator must reconnect through OAuth.

Troubleshooting information is limited to sanitized state such as `quickbooks_authorization_revoked`, token health, and bootstrap position. Never paste authorization codes, tokens, client secrets, decrypted integration JSON, or raw Authorization headers into logs or support messages.

Authenticated and OAuth responses use `Cache-Control: no-store` and related cache-prevention headers. Integration-changing requests require a trusted `Origin` in addition to workspace-administrator authorization; OAuth callback state supplies one-time CSRF protection for the authorization response. Redirect targets are checked against fixed Intuit and ftops URL allowlists.

ftops does not create an application session cookie. Production authentication is performed by Cloudflare Access, which owns the `CF_Authorization` cookie and must be configured with `Secure`, `HttpOnly`, and an appropriate `SameSite` attribute in Zero Trust. Tests assert that ftops API and OAuth responses do not emit `Set-Cookie`. Cookie attributes must also be confirmed against the deployed Access application because they are outside this repository's runtime control.

Run migrations and verification with:

```sh
npm --workspace apps/api run db:migrate:local
npm run verify
```

Tests mock the QuickBooks HTTP API and do not require a live account. Shopify synchronization, email, uploads, automated messaging, forecasting, and editable invoices are intentionally out of scope for phase one.
