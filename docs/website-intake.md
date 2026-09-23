# Website intake

Website intake is an independent ftops integration surface. A caller submits an event,
not a customer upsert. ftops authenticates the integration, resolves its workspace,
retains the source record, and decides how to reconcile it.

## Provisioning and authentication

A workspace administrator creates a `website` integration through Integrations in the
UI or the existing authenticated `POST /integrations` API (with its required trusted
`Origin` header for administrator mutations):

```json
{
  "workspaceId": "workspace-owned-by-the-administrator",
  "provider": "website",
  "environment": "production",
  "externalAccountId": "unique-site-identifier",
  "displayName": "Main website",
  "secrets": { "intakeToken": "GENERATE_A_RANDOM_32_BYTE_BASE64URL_SECRET" }
}
```

Generate at least 32 random bytes and encode as base64url. The API accepts 32–256
URL-safe characters. Credentials use the existing encrypted integration secret store
(`INTEGRATIONS_MASTER_KEY` / `INTEGRATIONS_KEY_ID`) and are never returned by the API.
Replace `secrets.intakeToken` through `PATCH /integrations/:id` to rotate immediately;
set `is_active: 0` to revoke access. Never put this credential in browser code.

The workspace ID belongs only to administrator provisioning. Submission callers send:

```http
POST /website-intake/INTEGRATION_ID
Authorization: Bearer INTAKE_TOKEN
Content-Type: application/json
```

There are no workspace/customer/contact parameters, cookies, or user identity headers
in the intake contract. The integration ID is a selector, not a credential. Its active
provider and credential must match. Any edge Access protection must separately admit
the server caller to this exact route; integration authentication still runs inside
ftops. Deployment/Access configuration and credential provisioning are separate from
this code change. Do not give website callers access to staff CRUD endpoints.

## Submission contract

```json
{
  "externalEventId": "submission-550e8400-e29b-41d4-a716-446655440000",
  "email": "person@example.com",
  "firstName": "Alex",
  "lastName": "Rivera",
  "name": "Alex Rivera",
  "phone": "+1 555 010 1234",
  "companyName": "Rivera Studio",
  "projectType": "custom furniture",
  "location": "Riverside",
  "timeline": "This winter",
  "budget": "Still deciding",
  "message": "Interested in a dining table.",
  "sourcePath": "/contact",
  "marketingConsent": {
    "state": "granted",
    "disclosureVersion": "website-marketing-v1",
    "capturedAt": "2026-09-01T18:30:00Z"
  }
}
```

`externalEventId` and a valid email are required. Identity and project fields are
optional strings. Unknown fields (including workspace or CRM IDs) are rejected.
Maximum UTF-8 request size: 64 KiB; message: 16,000 characters; other strings: 2,000;
event ID: 200; email: 254. Email matching trims and lowercases; it does not remove
plus addressing or dots. Preserve the same event ID and JSON values when retrying.

Marketing consent:

- `granted`: requires a nonempty disclosure version and captured timestamp; sets Allowed.
- `revoked`: requires captured timestamp; sets Not allowed. Disclosure version is optional.
- `not_provided` (also the default when omitted): leaves the existing permission unchanged.

Captured timestamps must include a timezone, parse as dates, and not be in the future.
ftops stores UTC timestamps and a separate receipt time. Older consent events remain
in history but do not overwrite newer state. Revocation wins equal timestamps. A new
contact starts Unknown. Marketing permission is contact-scoped, not customer-scoped.
A manual edit uses server time and retains the staff actor. No mailing enrollment,
automation, acknowledgement, or outbound email is triggered by this feature.

## Durability and reconciliation

An atomic D1 batch claims `(integration_id, external_event_id)`, stores the original JSON
text plus structured fields, reconciles, and appends activity/consent history. A failed
batch rolls back completely so it is safe to retry. Concurrent submissions perform
matching inside the transaction. Database triggers reject updates and deletes to
submission and consent evidence; future retention work needs an explicit migration.

ftops matches normalized email only inside the integration's workspace. A single
active contact on a nonarchived customer is linked; otherwise a new customer/contact
is created when no email matches exist. Missing display/first/last names, phone, and company
are filled. Existing conflicting values, primary-contact choices, lifecycle state,
and established display names are retained. Submitted conflicting values remain in
the source record and each linked submission's separate customer activity.

Multiple matches, inactive/archived contacts, archived customers, and orphaned matches
are retained as `needs_review` without mutating a contact or choosing a customer.
Staff can inspect the latest 100 submissions at
`GET /website-submissions?workspaceId=...` and raw/structured evidence at
`GET /website-submissions/:id?workspaceId=...` using existing workspace authorization.
An ambiguous submission cannot safely be placed in a particular customer's activity
until reviewed. A review/reconciliation UI is follow-up work; there is no mutation API
for the immutable source record.

### Opportunities

Free-text `budget` never creates a numeric budget. Default intake creates no opportunity.
When a caller has an actual integer amount in cents and an explicit project, it can add:

```json
{
  "opportunity": {
    "description": "Dining table",
    "type": "furniture",
    "budgetCents": 500000
  }
}
```

This optional object is part of the submission, alongside required event ID and email.
Types are `furniture`, `cabinets`, or `other`; cents must be a nonnegative safe integer.
For a safely linked customer, one open (`scoping`/`quoted`) opportunity with the same
exact description and type is linked without overwriting its budget. If none exists,
ftops creates a scoping opportunity. Multiple matching open opportunities remain
unlinked. `website_submission_opportunities` retains the submission association.

## Responses and retry behavior

- `201`: accepted, with `{ submissionId, status: "linked" | "needs_review", duplicate: false }`.
- `200`: identical JSON values for an existing event; same receipt, `duplicate: true`.
  JSON whitespace/key order may differ. No activity, CRM, opportunity, or consent writes repeat.
- `409 event_id_payload_conflict`: reused ID with changed values. Preserve the original;
  use a new event ID only for a genuinely new submission.
- `400`: invalid schema/query parameters; `401`: missing, wrong, inactive, or wrong-provider
  integration credential; `413`: oversized; `415`: non-JSON.
- Retry network failures and `5xx` with bounded exponential backoff and the same event ID.

## Staff contact API and UI

The existing customer contact editor shows **Marketing email: Allowed / Not allowed /
Unknown** and saves `marketingEmailPermission` through the existing contact create/PATCH
API. Omitting that field preserves the state, including when saving unrelated fields.
`GET /customers/:customerId/contacts/:contactId` includes current state, effective time,
and `marketing_email_history` with source, capture/receipt time, disclosure, submission,
and staff actor. Customer detail contacts include the current state. All access is
scoped to the customer's workspace and the specific contact.

## Rollout

Apply migration `0038_website_intake.sql` before deploying the API/UI; generate the migration
manifest with the normal build workflow. Existing contacts default to Unknown. Provision
one credential per site/workspace and verify the edge route before enabling a caller.
Future work: staff review UI for ambiguous matches, paginated submission search, retention
policy, and downstream notifications. No caller-specific integration is implemented here.
