# Verify FTOPS CRM feedback with Meta Test Events

This operator command sends one test event for a staff-confirmed synthetic website inquiry. It runs outside the Worker and needs no deployment or campaign changes. It only reads FTOPS.

1. Open the furniture inquiry page with `?fbclid=ftops-crm-qa-<unique-suffix>` and marketing tracking permitted. Use `ftops-crm-qa-<unique-suffix>@example.com` as the email, label the inquiry as a QA test, and leave optional email marketing unchecked.
2. In FTOPS, review the assessment for that website inquiry and confirm the correct classification is qualified. Use the website submission UUID, rather than the customer UUID, for the commands below.
3. Authenticate Wrangler for the target D1 database. Run `node scripts/meta-qualified-lead-test.mjs verify <submission-uuid> --remote` from the repository root. Use `--local` for a local fixture. The command checks that both intake copies retain the marker and that the latest assessment and staff review qualify the exact inquiry.
4. Set `META_DATASET_ID` to the intended dataset, `META_TEST_EVENT_CODE` to its Events Manager server test code, and `META_CAPI_ACCESS_TOKEN` through your usual secret handling. Run `node scripts/meta-qualified-lead-test.mjs send <submission-uuid> --remote`. Leave the dataset's Test events view open and verify the `QualifiedLead` event and its event ID. Graph acceptance alone does not verify that the UI displays the event.

The payload uses a stable ID and the recorded review timestamp. It sends a hash of the reserved synthetic email as the only matching field. The artificial click marker and the test operator's browser ID remain in FTOPS. There is no automatic sender, backfill, or production optimization change.
