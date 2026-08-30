# Customer email ingestion

FTOPS receives forwarded customer mail through a dedicated Cloudflare Email Routing subdomain. Cloudflare accepts SMTP; FTOPS does not run an SMTP server.

## Flow

1. Route the dedicated `ops.fromtrees.studio` subdomain through Cloudflare Email Routing.
2. Route `notes@ops.fromtrees.studio` to the `ftops-email` Worker for normal customer email notes.
3. Route `doodle@ops.fromtrees.studio` to the same Worker for automated Doodle booking ingestion.
4. The Email Worker streams normal raw MIME through the `API` service binding with a timestamped HMAC signature, declared byte length, and the SMTP envelope addresses. The API writes that stream to bounded multipart R2 uploads while computing its SHA-256 digest.
5. The API resolves the envelope recipient to one workspace, then authorizes the envelope sender inside that workspace. Normal customer email ingestion never trusts a header `From` value for authorization.
6. FTOPS archives the raw `.eml` in the private `ftops-customer-emails` R2 bucket, parses MIME as a stream, and writes decoded attachments through bounded multipart R2 uploads rather than buffering them in Worker memory.
7. Recognized Doodle booking notifications are handled deterministically before the generic email summarizer. Other messages continue through Contact matching and AI extraction as normal.
8. Generic candidate notes remain pending until a user applies or dismisses them. Applying a candidate creates a normal customer note with source provenance and copies every email attachment into the existing protected customer-note file store.

No cross-workspace fallback is allowed. If a recipient mailbox is unknown, a forwarding user is not authorized for that workspace, or Contact matching is ambiguous, FTOPS rejects or holds the ingestion for review rather than searching another workspace.

If processing is interrupted, records older than ten minutes remain visible in the **Needs attention** filter. The hourly maintenance job automatically requeues up to twenty stale records per run.

## Doodle bookings

`doodle@ops.fromtrees.studio` is a dedicated automation mailbox. The Email Worker grants the Doodle ingestion identity only when all of the following are true:

- the recipient is exactly `doodle@ops.fromtrees.studio`;
- the message is a Doodle booking notification (`SE_PARTICIPATION_NOTIF_BOOKING_O` / `New time booked for ...`);
- the original message identifies `mailer@doodle.com`;
- the preserved message contains Doodle DKIM plus a successful Doodle DKIM or DMARC authentication result.

This dedicated path exists so automatic forwarding services such as iCloud can rewrite the SMTP envelope without opening the normal `notes@...` mailbox to arbitrary senders.

For a recognized booking, FTOPS:

- extracts the invitee name, phone, physical/project address, meeting details, Doodle invite link, and custom invitee fields;
- matches an existing Contact conservatively by normalized phone first, then by a unique exact name;
- sends ambiguous matches to `needs_match` instead of creating a duplicate;
- creates a new `lead` Customer and primary Contact when no match exists;
- adds the supplied physical address as the primary `project_site` address;
- adds an immutable Doodle activity/note containing the booking and project details;
- creates a `scoping` Opportunity for substantive project bookings and classifies it as furniture, cabinets, or other;
- preserves the exact Doodle budget answer in the note. Because the current Opportunity schema stores one numeric budget, a numeric Doodle range uses its midpoint as the working `budget_cents`; unknown or omitted budgets use zero until the Opportunity budget model supports nullable/range values;
- treats explicit reschedule-only text as administrative activity and does not create another Opportunity;
- deduplicates repeated deliveries by raw message hash and Doodle `Message-Id`;
- enqueues the existing Quo Contact sync after creating or enriching a Contact.

### iCloud forwarding rule

After the Doodle mailbox has been deployed, create an iCloud Mail rule that forwards Doodle booking notifications to `doodle@ops.fromtrees.studio`. Limit the rule as tightly as iCloud allows, ideally to messages from `mailer@doodle.com` whose subject begins with `New time booked for`.

Do not forward general mail to the Doodle address. Normal customer correspondence should continue to use `notes@ops.fromtrees.studio`.

## Required Cloudflare setup

Before enabling a route in production:

- The private R2 bucket `ftops-customer-emails` must exist before the first deployment. It was created as a private WNAM bucket on August 18, 2026.
- GitHub Actions must have `EMAIL_INGESTION_SECRET`. The workflow applies the same masked value to `ftops` and `ftops-email` with Wrangler's supported bulk-secret command.
- On a push to `main`, Actions verifies the monorepo, applies the API migration, deploys the API and its secret, and only then deploys the Email Worker and its copy of the secret.
- Enable Email Routing for the dedicated inbound subdomain. Do not change the MX records for the company’s normal mail domain.
- Deployment idempotently binds both `notes@ops.fromtrees.studio` and `doodle@ops.fromtrees.studio` to `ftops-email` and registers both workspace mailbox records.
- Register employee envelope addresses as normal forwarders for the workspace. The synthetic Doodle authorization identity is provisioned only for the dedicated Doodle mailbox path.

The application endpoints are:

- `GET|POST /customer-emails/mailboxes?workspaceId=...` for workspace-admin mailbox configuration.
- `GET|POST /customer-emails/forwarders?workspaceId=...` for workspace-admin forwarding authorization.
- `GET /customer-emails?workspaceId=...&status=needs_match` for the review queue.
- `POST /customer-emails/ingestions/:id/match` to assign an unmatched message to a Customer and optional Contact in the same workspace.
- `POST /customer-emails/candidates/:id/apply|dismiss` for note review.

## Local testing

The Email Worker can receive a local RFC 822 message through Wrangler’s email-event endpoint. The API integration suite covers workspace isolation, Contact matching, AI candidates, provenance, and attachment application, while Doodle unit coverage exercises booking field extraction, budget handling, classification, reschedule behavior, and sender recognition.

GitHub Actions configures the workspace mailboxes and authorized workspace users after deploying `ftops-email`, then idempotently enables routing only for `ops.fromtrees.studio` and upserts both Worker address rules. The apex `fromtrees.studio` iCloud MX records are never changed.
