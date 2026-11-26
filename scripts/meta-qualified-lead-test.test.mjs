import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTestEvent } from "./meta-qualified-lead-test.mjs";

const submissionId = "11111111-1111-4111-8111-111111111111";
const now = Date.parse("2026-11-26T17:00:00Z");
const retained = JSON.stringify({
  metaAttribution: { fbclid: "ftops-crm-qa-fixture", fbp: "browser-marker" },
});
const inquiry = {
  email: "ftops-crm-qa-fixture@example.com",
  fields_json: retained,
  raw_payload: retained,
  source_type: "website_submission",
  source_id: submissionId,
  expected_classification: "qualified",
  reviewed_at: "2026-11-26T16:00:00Z",
};

test("a confirmed fixture produces a stable event with only synthetic match data", () => {
  const result = buildTestEvent(inquiry, submissionId, now);
  assert.equal(result.event_name, "QualifiedLead");
  assert.equal(result.event_id, `ftops-crm-test-${submissionId}`);
  assert.equal(result.event_time, Date.parse(inquiry.reviewed_at) / 1000);
  assert.deepEqual(Object.keys(result.user_data), ["em"]);
  assert.match(result.user_data.em[0], /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(result).includes(inquiry.email));
});

test("the sender rejects real, unattributed, unrelated, unreviewed, and stale leads", () => {
  for (const [changes, error] of [
    [{ email: "lead@example.net" }, /synthetic/],
    [{ raw_payload: "{}" }, /click marker/],
    [{ source_id: "another-submission" }, /staff review/],
    [{ expected_classification: null }, /staff review/],
    [{ expected_classification: "not_qualified" }, /staff review/],
    [{ reviewed_at: "2026-11-01T00:00:00Z" }, /seven days/],
  ]) {
    assert.throws(
      () => buildTestEvent({ ...inquiry, ...changes }, submissionId, now),
      error,
    );
  }
});
