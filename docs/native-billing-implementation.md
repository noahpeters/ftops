# Native billing implementation and validation

## Implemented in this PR

FTOPS now has an administrator-only **Estimates & billing** area, native D1 records, private PDF storage, an account-free customer portal, electronic signatures and a Stripe payment adapter. QuickBooks does not participate in this workflow.

- Staff configure the business, publish immutable terms versions and author itemized estimates with customer/contact/project associations, scope, private unit costs, discounts and per-line tax rates.
- Deposits are business-defined fixed amounts or percentages. There are no jurisdiction-based deposit caps, contract-category caps or legal-approval flags. Amounts must be nonnegative and the deposit/milestone/final schedule must reconcile to the contract total; these are arithmetic invariants, not business-policy caps.
- A draft can be revised, issued or withdrawn. Issue freezes the public snapshot, exact terms and disclosure. A customer link is returned for the staff member to share; creating a link does not claim an email was sent.
- The customer follows the secure link, verifies a code sent to the designated email, reviews the proposal and exact terms, explicitly approves/consents and types their full name. No FTOPS account is created. The verification, intent, terms hash, proposal hash, signer identity, user agent and timestamps are recorded in immutable signature evidence.
- Signing creates certificate-signed PDFs for the approved estimate, accepted terms and deposit/milestone/final invoices. Terms publication and proposal issuance also produce signed PDFs. The exact accepted terms text and public estimate snapshot are attached to their respective PDFs and covered by the cryptographic signature.
- A signature recorded during a document failure remains in `signing`; the customer can retry document preparation without signing again. Scheduled recovery resumes it. Deposit checkout requires the signed document workflow to complete.
- Invoice amounts and tax allocations reconcile to the agreement. Invoice PDFs reference the contract itemization without billing the contract total repeatedly. Invoices are issuer-signed; paying one does not require a fresh customer signature.
- Stripe hosted Checkout explicitly enables `card` and `us_bank_account`. Card/bank credentials are collected by Stripe, never by FTOPS. Native invoices remain authoritative; Stripe Invoicing/QuickBooks are not used.
- Server-side attempts and provider idempotency prevent duplicate checkout creation; creating attempts can be recovered from Stripe after an uncertain response. Verified webhooks retrieve authoritative provider state. Pending ACH reserves its obligation and does not become paid merely because Checkout was submitted.
- Payment/refund/fee/dispute/payout records are reconciled from Stripe. Staff can submit refunds with stable request IDs. Duplicate events/transactions do not create duplicate financial rows. Pending fees remain unknown; provider fund availability and payout state are separate from customer payment success.
- The private project summary subtracts known payment fees and recognized refunds/lost disputes from estimated contract profit. It explicitly labels costs and future fees as estimates/incomplete. This is not a completed-project actual-cost accounting system.
- Signed PDFs can be downloaded without accepting future terms. Administrators can renew access for the original signing contact. Publication of new terms does not alter an existing agreement.

## Configuration for validation

No production credentials, signing keys, provider activation, database migration, merge or deployment were performed during implementation. Deployment remains GitHub Actions after an authorized human merge.

The application requires the existing `INTEGRATIONS_MASTER_KEY` for workspace-encrypted credentials and the existing Resend configuration for verification and document/payment notifications. The Actions deployment provisions `ftops-billing-documents`, a private bucket with no public hostname, before deploying its binding. Guest access and webhooks are limited to `api.from-trees.com/billing-public/*`; staff routes remain behind the existing UI service binding and administrator checks.

Configure these in **Estimates & billing → Settings**:

1. Actual issuer/business name, contact email and your electronic-record disclosure.
2. Stripe test or live secret key and that environment's webhook signing secret. The UI displays the corresponding endpoint, `/billing-public/stripe/<workspace>/<sandbox-or-production>`. Configure Checkout session, PaymentIntent, charge/refund/dispute and payout lifecycle events. Both card and ACH must be available on the intended merchant account.
3. An RSA signing private key in unencrypted PKCS#8 PEM transport format and its matching X.509 PEM certificate chain. The server validates key/certificate matching and certificate dates, then encrypts the key at rest using the workspace integration encryption. The browser clears entered secret fields after save; APIs never return the private key.
4. Optionally, an HTTPS RFC3161 timestamp service and its trusted root certificates. The implementation verifies the timestamp's nonce, message imprint, time, certificate chain and timestamping purpose before embedding it. When timestamping is configured, an unavailable/untrusted authority fails document generation rather than silently omitting the timestamp.
5. Your actual terms text, publication version and estimate/payment details. There is no software counsel-approval gate; Noah will arrange independent validation of the finished workflow and business documents.

Each proposal freezes its payment environment. Test proposals continue to use test credentials even if the workspace subsequently selects live mode. Historical credentials are retained per workspace/environment for reconciliation. Do not replace one merchant account with another in the same environment without a separate migration; rotating keys for the same account is supported.

The customer link contains an invitation secret in the URL fragment, so it is not sent in the initial HTTP URL. Only its hash is stored. Customer sessions are HttpOnly, SameSite cookies; HTTPS adds Secure. Invitations expire and are revocable through proposal withdrawal before signing. Verification codes expire after ten minutes, are limited to six attempts and have a resend cooldown. Signing and payment mutations require the configured customer origin. Customer PDFs and JSON are explicit public projections; internal costs, source credentials and payment credentials are excluded.

## Signature profile and custody

PDFs use a detached CMS RSA/SHA-256 signature covering the PDF byte ranges. A configured timestamp adds a verified RFC3161 signature timestamp. Each artifact records its SHA-256, issuer certificate fingerprint and actual signing profile. This implementation does not claim PAdES-LT/LTA or embedded revocation/archive-renewal support, and an independent PDF reader may report an untrusted issuer until its certificate is issued by a chain that reader trusts.

The first implementation signs inside the trusted Worker using encrypted workspace key material and WebCrypto; it does not claim HSM-backed custody. Payment operations have an application-level adapter boundary, and PDF signing/timestamp code is isolated for a later managed-signing implementation. Production certificate issuance, trust, custody and retention require the user's operational choice and validation. The synthetic public test certificates confer no production trust and must never be used for customers.

Object keys are unique and content-addressed at the leaf; application code does not overwrite historical documents. This is not a claim of WORM storage or legally sufficient retention by itself. Configure backups, retention and access procedures appropriate to the business. Keep source snapshots and exact signed bytes; never regenerate a historical document using current terms or rates.

## Validation performed

- Existing repository verification: formatting, lint, type checks, unit and local D1/Cloudflare integration suites.
- Native workflow tests: OTP verification/replay/throttling, explicit consent, public/private separation, repeated signing, terms evolution, immutable records, unauthorized workspace access, stale links and document-generation recovery.
- Stripe simulation tests: both payment methods enabled, stable checkout idempotency, processing ACH reservation, signed webhook rejection/deduplication, payment confirmation, actual fee capture and repeated partial-refund reconciliation.
- Actual Cloudflare runtime test: generation and internal verification of a certificate-signed PDF through workerd with the Worker-compatible libraries.
- Trusted timestamp tests: a proper synthetic root/leaf timestamp authority, embedding of a verified timestamp and rejection of an authority outside the configured trust chain.
- Independent OpenSSL verification of the exported synthetic PDFs and rejection after modifying covered bytes. Certificate trust is intentionally excluded for the synthetic test issuer; this proves integrity, not production issuer trust or legal enforceability.
- Actual staff/customer browser flow with synthetic data, including email-code review/signing and resulting PDFs/invoices. Mobile review at 390px had no horizontal overflow. PDFs were rendered for visual inspection and Unicode source text is preserved using an embedded licensed font.

## Remaining release work and explicit limits

This is a substantive implementation for validation, not proof of a released first-production workflow. No real Stripe charge, ACH debit, payout, customer email or production signing certificate was used. Real merchant method availability, settlement/holds, receipt delivery, return/dispute behavior and external-bank reconciliation still require authorized provider testing.

Tax rates are staff-supplied; line arithmetic is implemented, but automatic address sourcing, nexus/exemption determination and remittance are not. Costs are estimated line inputs; they do not claim to include all actual fabrication expenses. Existing customer addresses and opportunities are not yet captured as a full native tax/sales snapshot.

Cabinitron's live business-authorized snapshot importer remains a separate Artifacts integration task; it has not been fabricated using the legacy H2 reporting token. Native estimates currently use staff-entered items, and the model deliberately rejects arbitrary browser-supplied private design payloads. The inspected Cabinitron integration architecture remains documented in `native-estimating-contracting-invoicing.md`.

Signed agreements are preserved. Pre-signature revisions are implemented; a separate signed change-order workflow is still needed to automate amendments after signing. Native project association is created if missing, but production task materialization and automatic milestone-trigger notifications are not implemented. Stripe pending-attempt recovery and transaction pagination are implemented; long-term reconciliation cursors, merchant-account migration and bank-statement matching remain follow-up work. These limitations must be resolved/validated before describing the entire original first-release plan as complete.
