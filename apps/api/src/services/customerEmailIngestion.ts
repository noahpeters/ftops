import PostalMime from "postal-mime";
import type { Env } from "../lib/types";
import { nowISO } from "../lib/utils";
import { enqueueCustomerNoteFollowUpAnalysis } from "./customerFollowUp";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_RAW_BYTES = 25 * 1024 * 1024;

type Candidate = {
  category: string;
  subject: string;
  body: string;
  confidence: number;
  evidence: string | null;
};

export async function verifyInboundEmailRequest(request: Request, raw: ArrayBuffer, env: Env) {
  if (!env.EMAIL_INGESTION_SECRET) return false;
  const timestamp = request.headers.get("x-ftops-email-timestamp") || "";
  const signature = request.headers.get("x-ftops-email-signature") || "";
  const parsedTimestamp = Number(timestamp);
  if (!Number.isFinite(parsedTimestamp) || Math.abs(Date.now() - parsedTimestamp) > 5 * 60_000)
    return false;
  const envelopeFrom = normalizeEmail(request.headers.get("x-ftops-envelope-from"));
  const envelopeTo = normalizeEmail(request.headers.get("x-ftops-envelope-to"));
  if (!envelopeFrom || !envelopeTo) return false;
  const digest = await sha256Hex(raw);
  const signed = `${timestamp}\n${envelopeFrom}\n${envelopeTo}\n${digest}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.EMAIL_INGESTION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  return await crypto.subtle.verify(
    "HMAC",
    key,
    hexBytes(signature),
    new TextEncoder().encode(signed)
  );
}

export async function receiveCustomerEmail(
  env: Env,
  input: { raw: ArrayBuffer; forwardingEmail: string; envelopeTo: string }
) {
  if (input.raw.byteLength === 0 || input.raw.byteLength > MAX_RAW_BYTES)
    throw new Error("email_size_invalid");
  const forwardingEmail = normalizeEmail(input.forwardingEmail);
  const envelopeTo = normalizeEmail(input.envelopeTo);
  const mailbox = await env.DB.prepare(
    `SELECT workspace_id FROM email_ingestion_mailboxes WHERE address=? AND enabled=1`
  )
    .bind(envelopeTo)
    .first<{ workspace_id: string }>();
  if (!mailbox) throw new Error("email_mailbox_not_configured");
  const forwarder = await env.DB.prepare(
    `SELECT 1 FROM email_ingestion_forwarders WHERE workspace_id=? AND email=? AND enabled=1`
  )
    .bind(mailbox.workspace_id, forwardingEmail)
    .first();
  if (!forwarder) throw new Error("email_forwarder_not_authorized");

  const hash = await sha256Hex(input.raw);
  const existing = await env.DB.prepare(
    `SELECT id,status FROM customer_email_ingestions WHERE workspace_id=? AND raw_sha256=?`
  )
    .bind(mailbox.workspace_id, hash)
    .first<{ id: string; status: string }>();
  if (existing) return { ...existing, duplicate: true };

  const id = crypto.randomUUID();
  const now = nowISO();
  const storageKey = `customer-emails/${mailbox.workspace_id}/${id}.eml`;
  await env.R2_CUSTOMER_EMAILS_BUCKET.put(storageKey, input.raw, {
    httpMetadata: { contentType: "message/rfc822" },
    customMetadata: { forwardingEmail, envelopeTo, sha256: hash },
  });
  await env.DB.prepare(
    `INSERT INTO customer_email_ingestions
      (id,workspace_id,forwarding_email,envelope_to,raw_storage_key,raw_sha256,raw_size_bytes,status,received_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      id,
      mailbox.workspace_id,
      forwardingEmail,
      envelopeTo,
      storageKey,
      hash,
      input.raw.byteLength,
      "queued",
      now,
      now,
      now
    )
    .run();
  await env.EVENT_QUEUE.send({
    source: "ftops",
    type: "customer.email.extract",
    externalId: id,
    idempotencyKey: `customer-email/${id}`,
    payload: { ingestionId: id },
    receivedAt: now,
  });
  return { id, status: "queued", duplicate: false };
}

export async function processCustomerEmailIngestion(env: Env, ingestionId: string) {
  const ingestion = await env.DB.prepare(`SELECT * FROM customer_email_ingestions WHERE id=?`)
    .bind(ingestionId)
    .first<Record<string, unknown>>();
  if (!ingestion) throw new Error("email_ingestion_not_found");
  if (["ready", "applied", "dismissed"].includes(String(ingestion.status))) return;
  await env.DB.prepare(
    `UPDATE customer_email_ingestions SET status='processing',updated_at=? WHERE id=?`
  )
    .bind(nowISO(), ingestionId)
    .run();
  try {
    const object = await env.R2_CUSTOMER_EMAILS_BUCKET.get(String(ingestion.raw_storage_key));
    if (!object) throw new Error("email_source_not_found");
    const raw = await object.arrayBuffer();
    const outer = await PostalMime.parse(raw);
    const original = await findOriginalMessage(outer, String(ingestion.forwarding_email));
    await archiveAttachments(env, {
      ingestionId,
      workspaceId: String(ingestion.workspace_id),
      attachments: original.attachments.filter(
        (attachment) => attachment.mimeType.toLowerCase() !== "message/rfc822"
      ),
      now: nowISO(),
    });
    const senderEmail = normalizeEmail(original.from?.address);
    const matches = senderEmail
      ? await env.DB.prepare(
          `SELECT id,customer_id FROM contacts WHERE workspace_id=? AND lower(email)=?`
        )
          .bind(ingestion.workspace_id, senderEmail)
          .all<{ id: string; customer_id: string }>()
      : { results: [] };
    const uniqueMatches = matches.results ?? [];
    const contact = ingestion.customer_id
      ? {
          id: ingestion.contact_id ? String(ingestion.contact_id) : null,
          customer_id: String(ingestion.customer_id),
        }
      : uniqueMatches.length === 1
        ? uniqueMatches[0]
        : null;
    const now = nowISO();
    await env.DB.prepare(
      `UPDATE customer_email_ingestions SET original_sender_email=?,original_sender_name=?,contact_id=?,customer_id=?,subject=?,message_id=?,sent_at=?,status=?,failure_reason=?,processed_at=?,updated_at=? WHERE id=?`
    )
      .bind(
        senderEmail || null,
        original.from?.name || null,
        contact?.id || null,
        contact?.customer_id || null,
        original.subject || null,
        original.messageId || null,
        validDate(original.date),
        contact ? "processing" : "needs_match",
        contact
          ? null
          : uniqueMatches.length > 1
            ? "multiple_contact_matches"
            : "contact_not_found",
        now,
        now,
        ingestionId
      )
      .run();
    if (!contact) return;
    await env.DB.prepare(
      `DELETE FROM customer_email_note_candidates WHERE ingestion_id=? AND status='pending'`
    )
      .bind(ingestionId)
      .run();
    const candidates = await extractCandidates(env, {
      subject: original.subject || "Customer email",
      text: original.text || stripHtml(original.html || ""),
      senderEmail,
      sentAt: validDate(original.date),
    });
    for (const candidate of candidates) {
      await env.DB.prepare(
        `INSERT INTO customer_email_note_candidates
          (id,ingestion_id,workspace_id,customer_id,category,proposed_subject,proposed_body,confidence,evidence,status,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,'pending',?)`
      )
        .bind(
          crypto.randomUUID(),
          ingestionId,
          ingestion.workspace_id,
          contact.customer_id,
          candidate.category,
          candidate.subject,
          candidate.body,
          candidate.confidence,
          candidate.evidence,
          now
        )
        .run();
    }
    await env.DB.prepare(
      `UPDATE customer_email_ingestions SET status='ready',failure_reason=NULL,updated_at=? WHERE id=?`
    )
      .bind(now, ingestionId)
      .run();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "email_processing_failed";
    await env.DB.prepare(
      `UPDATE customer_email_ingestions SET status='failed',failure_reason=?,updated_at=? WHERE id=?`
    )
      .bind(reason.slice(0, 500), nowISO(), ingestionId)
      .run();
    throw error;
  }
}

export async function applyEmailCandidate(
  env: Env,
  input: { candidateId: string; workspaceId: string; customerId: string; actorEmail: string }
) {
  const candidate = await env.DB.prepare(
    `SELECT c.*,i.original_sender_email,i.sent_at,i.subject AS email_subject,i.raw_storage_key
     FROM customer_email_note_candidates c JOIN customer_email_ingestions i ON i.id=c.ingestion_id
     WHERE c.id=? AND c.workspace_id=? AND c.customer_id=?`
  )
    .bind(input.candidateId, input.workspaceId, input.customerId)
    .first<Record<string, unknown>>();
  if (!candidate) throw new Error("candidate_not_found");
  if (candidate.status !== "pending") throw new Error("candidate_already_reviewed");
  const now = nowISO();
  const activityId = crypto.randomUUID();
  const provenance = [
    `From customer email${candidate.original_sender_email ? ` (${candidate.original_sender_email})` : ""}${candidate.sent_at ? ` sent ${candidate.sent_at}` : ""}.`,
    `Source subject: ${candidate.email_subject || "(no subject)"}`,
    `Source ingestion: ${candidate.ingestion_id}`,
  ].join("\n");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO customer_activities
        (id,workspace_id,customer_id,activity_type,subject,body,source,occurred_at,created_by,created_at,is_human_authored)
       VALUES (?,?,?,?,?,?,?,?,?,?,1)`
    ).bind(
      activityId,
      input.workspaceId,
      input.customerId,
      "note",
      candidate.proposed_subject,
      `${candidate.proposed_body}\n\n---\n${provenance}`,
      "customer_email",
      now,
      input.actorEmail,
      now
    ),
    env.DB.prepare(
      `UPDATE customer_email_note_candidates SET status='applied',applied_activity_id=?,reviewed_at=?,reviewed_by=? WHERE id=? AND status='pending'`
    ).bind(activityId, now, input.actorEmail, input.candidateId),
    env.DB.prepare(
      `UPDATE customer_email_ingestions SET status=CASE WHEN NOT EXISTS (
        SELECT 1 FROM customer_email_note_candidates WHERE ingestion_id=? AND status='pending' AND id!=?
       ) THEN 'applied' ELSE status END,reviewed_at=?,reviewed_by=?,updated_at=? WHERE id=?`
    ).bind(
      candidate.ingestion_id,
      input.candidateId,
      now,
      input.actorEmail,
      now,
      candidate.ingestion_id
    ),
  ]);
  await attachEmailFilesToNote(env, {
    ingestionId: String(candidate.ingestion_id),
    workspaceId: input.workspaceId,
    customerId: input.customerId,
    activityId,
    actorEmail: input.actorEmail,
    now,
  });
  await enqueueCustomerNoteFollowUpAnalysis(env, {
    workspaceId: input.workspaceId,
    customerId: input.customerId,
    noteId: activityId,
    occurredAt: now,
  });
  return activityId;
}

async function archiveAttachments(
  env: Env,
  input: {
    ingestionId: string;
    workspaceId: string;
    attachments: Array<{
      filename: string | null;
      mimeType: string;
      content: string | ArrayBuffer | Uint8Array;
    }>;
    now: string;
  }
) {
  const existing = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM customer_email_attachments WHERE ingestion_id=?`
  )
    .bind(input.ingestionId)
    .first<{ count: number }>();
  if (Number(existing?.count ?? 0) > 0) return;
  for (const [index, attachment] of input.attachments.entries()) {
    const id = crypto.randomUUID();
    const filename = safeFilename(attachment.filename || `attachment-${index + 1}`);
    const bytes = toBytes(attachment.content);
    const raw = bytes.slice().buffer;
    const hash = await sha256Hex(raw);
    const storageKey = `customer-emails/${input.workspaceId}/${input.ingestionId}/attachments/${id}-${filename}`;
    await env.R2_CUSTOMER_EMAILS_BUCKET.put(storageKey, raw, {
      httpMetadata: { contentType: attachment.mimeType || "application/octet-stream" },
      customMetadata: { ingestionId: input.ingestionId, sha256: hash },
    });
    await env.DB.prepare(
      `INSERT INTO customer_email_attachments
        (id,ingestion_id,workspace_id,original_filename,content_type,size_bytes,sha256,storage_key,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
      .bind(
        id,
        input.ingestionId,
        input.workspaceId,
        filename,
        attachment.mimeType || "application/octet-stream",
        bytes.byteLength,
        hash,
        storageKey,
        input.now
      )
      .run();
  }
}

async function attachEmailFilesToNote(
  env: Env,
  input: {
    ingestionId: string;
    workspaceId: string;
    customerId: string;
    activityId: string;
    actorEmail: string;
    now: string;
  }
) {
  const rows = await env.DB.prepare(
    `SELECT * FROM customer_email_attachments
     WHERE ingestion_id=? AND workspace_id=? AND applied_activity_id IS NULL`
  )
    .bind(input.ingestionId, input.workspaceId)
    .all<Record<string, unknown>>();
  for (const row of rows.results ?? []) {
    const object = await env.R2_CUSTOMER_EMAILS_BUCKET.get(String(row.storage_key));
    if (!object) throw new Error("email_attachment_source_not_found");
    const fileId = crypto.randomUUID();
    const storageKey = `customers/${input.workspaceId}/${input.customerId}/${input.activityId}/${fileId}-${safeFilename(String(row.original_filename))}`;
    await env.R2_TASK_FILES_BUCKET.put(storageKey, await object.arrayBuffer(), {
      httpMetadata: { contentType: String(row.content_type) },
      customMetadata: { emailIngestionId: input.ingestionId },
    });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO customer_note_files
          (id,workspace_id,customer_id,activity_id,uploaded_by_email,original_filename,content_type,size_bytes,storage_key,sha256,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        fileId,
        input.workspaceId,
        input.customerId,
        input.activityId,
        input.actorEmail,
        row.original_filename,
        row.content_type,
        row.size_bytes,
        storageKey,
        row.sha256,
        input.now
      ),
      env.DB.prepare(
        `UPDATE customer_email_attachments SET applied_activity_id=? WHERE id=? AND applied_activity_id IS NULL`
      ).bind(input.activityId, row.id),
    ]);
  }
}

async function findOriginalMessage(
  outer: Awaited<ReturnType<typeof PostalMime.parse>>,
  forwarder: string
) {
  for (const attachment of outer.attachments) {
    if (attachment.mimeType.toLowerCase() === "message/rfc822") {
      const nested = await PostalMime.parse(attachment.content);
      if (normalizeEmail(nested.from?.address) !== forwarder) return nested;
    }
  }
  const text = outer.text || stripHtml(outer.html || "");
  const marker = text.match(/(?:^|\n)(?:>\s*)*From:\s*(?:[^\n<]*<)?([^\s<>]+@[^\s<>]+)>?/i);
  if (!marker || normalizeEmail(marker[1]) === forwarder) return outer;
  return { ...outer, from: { name: "", address: marker[1] }, text };
}

async function extractCandidates(
  env: Env,
  email: { subject: string; text: string; senderEmail: string; sentAt: string | null }
) {
  if (!env.AI) throw new Error("email_ai_unavailable");
  const result = await env.AI.run(MODEL, {
    messages: [
      {
        role: "system",
        content:
          "Extract only new, durable customer/project facts from this customer email. Ignore signatures, quoted history, greetings, and facts stated only by the forwarding employee. Never invent or overwrite facts. Return JSON only as {candidates:[{category,subject,body,confidence,evidence}]}. Categories may include preference,dimension,material,budget,timing,address,decision,constraint,concern,contact,other. Keep each note concise and independently reviewable. Return an empty candidates array when nothing useful is present.",
      },
      {
        role: "user",
        content: `Original sender: ${email.senderEmail}\nSent at: ${email.sentAt || "unknown"}\nSubject: ${email.subject}\n\n${email.text.slice(0, 60_000)}`,
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1200,
    temperature: 0,
  });
  const response: unknown = typeof result === "string" ? result : result.response;
  if (!response) throw new Error("email_ai_empty_response");
  const parsed = (typeof response === "string" ? JSON.parse(response) : response) as {
    candidates?: unknown[];
  };
  return (parsed.candidates || [])
    .map(normalizeCandidate)
    .filter((x): x is Candidate => x !== null)
    .slice(0, 20);
}

function normalizeCandidate(value: unknown): Candidate | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const subject = String(row.subject || "")
    .trim()
    .slice(0, 200);
  const body = String(row.body || "")
    .trim()
    .slice(0, 4000);
  if (!subject || !body) return null;
  return {
    category:
      String(row.category || "other")
        .trim()
        .toLowerCase()
        .slice(0, 50) || "other",
    subject,
    body,
    confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0)),
    evidence:
      String(row.evidence || "")
        .trim()
        .slice(0, 1000) || null,
  };
}

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "attachment";
}
function toBytes(value: string | ArrayBuffer | Uint8Array) {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value);
}
function validDate(value: string | null | undefined) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
export function normalizeEmail(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^<|>$/g, "");
}
export async function sha256Hex(raw: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function hexBytes(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) return new Uint8Array();
  return new Uint8Array(value.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
}
