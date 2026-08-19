# Customer email ingestion

FTOPS receives forwarded customer mail through a dedicated Cloudflare Email Routing subdomain. Cloudflare accepts SMTP; FTOPS does not run an SMTP server.

## Flow

1. Route a dedicated subdomain such as `in.fromtrees.studio` through Cloudflare Email Routing.
2. Create one or more workspace mailbox addresses, such as `notes@in.fromtrees.studio`, and route them to the `ftops-email` Worker.
3. The Email Worker buffers the raw MIME once and sends it through the `API` service binding with a timestamped HMAC signature and the SMTP envelope addresses.
4. The API resolves the envelope recipient to one workspace, then authorizes the envelope sender inside that workspace. Header `From` values are never used for authorization.
5. FTOPS archives the raw `.eml` and attachments in the private `ftops-customer-emails` R2 bucket, matches the original sender to a Contact in the same workspace, and queues AI extraction.
6. Candidate notes remain pending until a user applies or dismisses them. Applying a candidate creates a normal customer note with source provenance and copies every email attachment into the existing protected customer-note file store.

No cross-workspace fallback is allowed. If a recipient mailbox is unknown, a forwarding user is not authorized for that workspace, or Contact matching is ambiguous, FTOPS rejects or holds the ingestion for review rather than searching another workspace.

## Required Cloudflare setup

Before enabling a route in production:

- Create the private R2 bucket `ftops-customer-emails`.
- Set the same `EMAIL_INGESTION_SECRET` Worker secret on `ftops` and `ftops-email`.
- Deploy the API migration and both Workers through the approved GitHub Actions release path.
- Enable Email Routing for the dedicated inbound subdomain. Do not change the MX records for the company’s normal mail domain.
- Create the desired address rule and bind it to `ftops-email`.
- Register that exact recipient address as a workspace mailbox and register each employee envelope address as a forwarder for that workspace.

The application endpoints are:

- `GET|POST /customer-emails/mailboxes?workspaceId=...` for workspace-admin mailbox configuration.
- `GET|POST /customer-emails/forwarders?workspaceId=...` for workspace-admin forwarding authorization.
- `GET /customer-emails?workspaceId=...&status=needs_match` for the review queue.
- `POST /customer-emails/ingestions/:id/match` to assign an unmatched message to a Customer and optional Contact in the same workspace.
- `POST /customer-emails/candidates/:id/apply|dismiss` for note review.

## Local testing

The Email Worker can receive a local RFC 822 message through Wrangler’s email-event endpoint. The API integration suite covers workspace isolation, Contact matching, AI candidates, provenance, and attachment application.

Production deployment, automatic deployment wiring, and Email Routing activation are intentionally not included in this feature branch.
