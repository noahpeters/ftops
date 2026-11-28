# Responding to a website inquiry

A workspace administrator opens **Templates → Inquiry email settings**, enters the shared team inbox, and saves it. This address receives staff alerts and replies from customers. Select an entry point such as Cabinetry or Cabinet pricing, enter its subject and message, and choose its standard attachments. Upload a file once to reuse it across templates. The default template covers entry points without a saved override.

Use `{{first_name}}`, `{{last_name}}`, `{{name}}`, `{{project_type}}`, or `{{project_description}}` in either field. Review names in the draft, especially when the storefront collected one full-name field. Attachments can total up to 5 MB per template.

Open the customer link in the staff email. Under **Website inquiries**, review the original description, edit the subject and message, select attachments, and click **Send response**. Each inquiry keeps its own recipient and reply record. A queued reply has been saved. A sent reply has an email-provider receipt. Expand the status to see the message and attachment names. If delivery needs review, check the provider history before sending another message.

Deploy the database migration and FTOPS before enabling the H2 notification handoff. The API uses its existing verified sender and Resend credential. Each incoming handoff must confirm its notification was queued. An unmatched submission links to its review notice in the customer directory.


## Inquiry delivery

The storefront saves submissions in H2 and signals the private FTOPS webhook. FTOPS also polls the H2 queue once a minute. FTOPS writes a separate CRM job and customer acknowledgement job before acknowledging the transfer to H2. CRM processing resolves the configured active website integration, stores the customer inquiry and enqueues its staff notification atomically.

FTOPS owns retry timing. Failed CRM deliveries and rate-limited customer acknowledgements retry with increasing delays capped at one hour. Ambiguous customer acknowledgement sends go to review to avoid duplicate customer emails. The H2 receipt means FTOPS has taken responsibility. The FTOPS job receipt records delivery to each destination.
