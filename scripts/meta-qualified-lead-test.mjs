import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

function readInquiry(submissionId, remote) {
  if (
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(submissionId ?? "")
  ) {
    throw new Error("Provide the synthetic inquiry's submission UUID.");
  }
  const sql = `
    SELECT s.email, s.fields_json, s.raw_payload, a.source_type, a.source_id,
           r.expected_classification, r.reviewed_at
    FROM website_submissions s
    LEFT JOIN customer_qualification_assessments a ON a.id = (
      SELECT id FROM customer_qualification_assessments
      WHERE workspace_id = s.workspace_id AND customer_id = s.customer_id
      ORDER BY created_at DESC, rowid DESC LIMIT 1
    )
    LEFT JOIN customer_qualification_reviews r ON r.id = (
      SELECT id FROM customer_qualification_reviews
      WHERE workspace_id = s.workspace_id AND customer_id = s.customer_id AND assessment_id = a.id
      ORDER BY reviewed_at DESC, rowid DESC LIMIT 1
    )
    WHERE s.id = '${submissionId}' AND s.reconciliation_status = 'linked'
      AND s.email GLOB 'ftops-crm-qa-*@example.com'`;
  const result = JSON.parse(
    execFileSync(
      fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url)),
      [
        "d1",
        "execute",
        "ftops-db",
        remote ? "--remote" : "--local",
        "--json",
        "--command",
        sql,
      ],
      {
        cwd: fileURLToPath(new URL("../apps/api/", import.meta.url)),
        encoding: "utf8",
      },
    ),
  )[0];
  if (!result?.success)
    throw new Error("Could not read the FTOPS test inquiry.");
  return result.results[0];
}

export function buildTestEvent(inquiry, submissionId, now = Date.now()) {
  if (
    !inquiry ||
    !/^ftops-crm-qa-[a-z0-9-]+@example\.com$/.test(inquiry.email)
  ) {
    throw new Error("Expected a linked synthetic FTOPS CRM test inquiry.");
  }
  const { metaAttribution: stored } = JSON.parse(inquiry.fields_json);
  const { metaAttribution: original } = JSON.parse(inquiry.raw_payload);
  const marker = inquiry.email.split("@")[0];
  if (stored?.fbclid !== marker || original?.fbclid !== marker) {
    throw new Error(
      "The synthetic click marker was not retained in both copies of the inquiry.",
    );
  }
  if (
    inquiry.source_type !== "website_submission" ||
    inquiry.source_id !== submissionId ||
    inquiry.expected_classification !== "qualified"
  ) {
    throw new Error(
      "The latest assessment for this inquiry needs a staff review confirming qualified.",
    );
  }
  const reviewTime = Date.parse(inquiry.reviewed_at);
  if (
    !Number.isFinite(reviewTime) ||
    reviewTime > now ||
    now - reviewTime >= 7 * 86400_000
  ) {
    throw new Error("The staff review must be less than seven days old.");
  }
  return {
    event_name: "QualifiedLead",
    event_time: Math.floor(reviewTime / 1000),
    event_id: `ftops-crm-test-${submissionId}`,
    action_source: "system_generated",
    // The retained click marker is synthetic, and the browser ID belongs to the test operator.
    user_data: {
      em: [createHash("sha256").update(inquiry.email).digest("hex")],
    },
    custom_data: { event_source: "crm", lead_event_source: "FTOPS" },
  };
}

async function main() {
  const [command, submissionId, scope] = process.argv.slice(2);
  if (
    !["verify", "send"].includes(command) ||
    !["--local", "--remote"].includes(scope)
  ) {
    throw new Error(
      "Usage: node scripts/meta-qualified-lead-test.mjs verify|send <submission-uuid> --local|--remote",
    );
  }
  const event = buildTestEvent(
    readInquiry(submissionId, scope === "--remote"),
    submissionId,
  );
  if (command === "verify") {
    console.log(
      `Verified attribution and staff qualification for ${event.event_id}.`,
    );
    return;
  }
  const { META_TEST_EVENT_CODE, META_CAPI_ACCESS_TOKEN, META_DATASET_ID } =
    process.env;
  if (
    !/^TEST\w+$/i.test(META_TEST_EVENT_CODE ?? "") ||
    !META_CAPI_ACCESS_TOKEN ||
    !/^\d+$/.test(META_DATASET_ID ?? "")
  ) {
    throw new Error(
      "Set META_TEST_EVENT_CODE, META_CAPI_ACCESS_TOKEN, and META_DATASET_ID before sending.",
    );
  }
  const response = await fetch(
    `https://graph.facebook.com/v25.0/${META_DATASET_ID}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${META_CAPI_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: [event],
        test_event_code: META_TEST_EVENT_CODE,
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const result = await response.json();
  if (!response.ok || result.events_received !== 1) {
    throw new Error(
      `Meta did not accept the test event (HTTP ${response.status}, code ${Number(result.error?.code) || "unknown"}).`,
    );
  }
  console.log(
    `Meta accepted ${event.event_id} (events_received=1). Verify it in Events Manager → Test events.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
