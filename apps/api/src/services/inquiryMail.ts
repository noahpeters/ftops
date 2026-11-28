import type { Env } from "../lib/types";

export const defaultTemplate = {
  subject: "Your project inquiry",
  body: "Hello {{first_name}},\n\nThank you for telling us about your project. We'd love to learn more.\n\nBest,\nThe team",
  files: "[]",
};

export type FileRef = { id: string; filename: string; bytes: number; replyUpload?: true };
export type Template = typeof defaultTemplate;
export type Submission = {
  id: string;
  email: string;
  workspace_id: string;
  fields_json: string;
  customer_id: string | null;
  received_at: string;
};
export function describe(row: Submission) {
  const f = JSON.parse(row.fields_json);
  let project = f.opportunity?.description || f.message || "";
  let source = f.sourcePath || "default";
  try {
    const envelope = JSON.parse(f.message);
    if (envelope.format === "h2-inquiry-v1") {
      if (typeof envelope.message === "string") project = envelope.message;
      if (typeof envelope.source_kind === "string") source = envelope.source_kind;
    }
  } catch {
    /* Other integrations send plain text. */
  }
  const name = f.name || [f.firstName, f.lastName].filter(Boolean).join(" ");
  const fields: Record<string, string> = {
    name,
    first_name: f.firstName || name.split(/\s+/)[0] || "there",
    last_name: f.lastName || name.split(/\s+/).slice(1).join(" "),
    project_description: project,
    project_type: f.projectType || "",
  };
  return { source, project, fields };
}

export type Mail = {
  to: string;
  from: string;
  subject: string;
  text: string;
  files?: FileRef[];
  reply_to?: string;
  cc?: string[];
};
export async function deliver(env: Env, id: string, kind: string) {
  const now = Date.now();
  // Resend retains idempotency keys for 24 hours. Stop ambiguous retries before expiry.
  const job = await env.DB.prepare(
    `UPDATE inquiry_mail SET next_attempt=?, first_attempt=coalesce(first_attempt,?)
    WHERE submission_id=? AND kind=? AND state='pending' AND next_attempt<=?
    AND (first_attempt IS NULL OR first_attempt>?) RETURNING payload`
  )
    .bind(now + 60000, now, id, kind, now, now - 23 * 3600000)
    .first<{ payload: string }>();
  if (!job) {
    await env.DB.prepare(
      "UPDATE inquiry_mail SET state='needs_review' WHERE submission_id=? AND kind=? AND state='pending' AND first_attempt<=? AND next_attempt<=?"
    )
      .bind(id, kind, now - 23 * 3600000, now)
      .run();
    return;
  }
  try {
    const { files = [], ...message } = JSON.parse(job.payload) as Mail;
    const attachments = [];
    for (const file of files) {
      const prefix = file.replyUpload ? "inquiry-replies/" : "inquiry-templates/";
      const object = await env.R2_CUSTOMER_EMAILS_BUCKET.get(prefix + file.id);
      if (!object) throw new Error("attachment_unavailable");
      const bytes = new Uint8Array(await object.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      attachments.push({ filename: file.filename, content: btoa(binary) });
    }
    if (!env.RESEND_API_KEY) throw new Error("missing_email_configuration");
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: "Bearer " + env.RESEND_API_KEY,
        "content-type": "application/json",
        "idempotency-key": "ftops-inquiry-" + kind + "-" + id,
      },
      body: JSON.stringify({ ...message, attachments }),
      signal: AbortSignal.timeout(15000),
    });
    if (!result.ok) throw new Error("provider_rejected");
    const receipt = (await result.json()) as { id?: string };
    if (!receipt.id) throw new Error("missing_receipt");
    await env.DB.prepare(
      "UPDATE inquiry_mail SET state='sent',provider_id=? WHERE submission_id=? AND kind=?"
    )
      .bind(receipt.id, id, kind)
      .run();
  } catch {
    console.error("inquiry_email_pending", { submissionId: id, kind });
  }
}

export async function retryInquiryMail(env: Env) {
  const jobs = await env.DB.prepare(
    "SELECT submission_id,kind FROM inquiry_mail WHERE state='pending' AND next_attempt<=? ORDER BY next_attempt LIMIT 30"
  )
    .bind(Date.now())
    .all<{ submission_id: string; kind: string }>();
  for (const job of jobs.results) await deliver(env, job.submission_id, job.kind);
}
