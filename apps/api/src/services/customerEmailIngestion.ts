import type { Env } from "../lib/types";
import { nowISO } from "../lib/utils";
import { enqueueCustomerNoteFollowUpAnalysis } from "./customerFollowUp";
import {
  parseEmailFromR2,
  type StreamedAttachment,
  type StreamedEmail,
  uploadStreamToR2,
} from "./streamingMime";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_RAW_BYTES = 25 * 1024 * 1024;
const STALE_PROCESSING_MS = 10 * 60_000;

type Candidate = {
  subject: string;
  body: string;
  confidence: number;
};

type ThreadMessage = {
  sourceMessageId: string | null;
  senderEmail: string;
  senderName: string;
  subject: string;
  sentAt: string | null;
  text: string;
  attachments: Array<{
    filename: string | null;
    mimeType: string;
    size: number;
    sha256: string;
    storageKey: string;
  }>;
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

export async function verifyInboundEmailStreamRequest(request: Request, env: Env) {
  if (!env.EMAIL_INGESTION_SECRET) return false;
  const timestamp = request.headers.get("x-ftops-email-timestamp") || "";
  const signature = request.headers.get("x-ftops-email-signature") || "";
  const rawSize = Number(request.headers.get("x-ftops-raw-size"));
  const parsedTimestamp = Number(timestamp);
  if (
    !Number.isFinite(parsedTimestamp) ||
    Math.abs(Date.now() - parsedTimestamp) > 5 * 60_000 ||
    !Number.isInteger(rawSize) ||
    rawSize <= 0 ||
    rawSize > MAX_RAW_BYTES
  )
    return false;
  const envelopeFrom = normalizeEmail(request.headers.get("x-ftops-envelope-from"));
  const envelopeTo = normalizeEmail(request.headers.get("x-ftops-envelope-to"));
  if (!envelopeFrom || !envelopeTo) return false;
  const signed = `v2\n${timestamp}\n${envelopeFrom}\n${envelopeTo}\n${rawSize}`;
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
  if (!forwarder) {
    const customerSender = await env.DB.prepare(
      `SELECT 1 FROM contacts WHERE workspace_id=? AND lower(email)=? LIMIT 1`
    )
      .bind(mailbox.workspace_id, forwardingEmail)
      .first();
    if (!customerSender) throw new Error("email_forwarder_not_authorized");
  }

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

export async function receiveCustomerEmailStream(
  env: Env,
  input: {
    raw: ReadableStream<Uint8Array>;
    rawSize: number;
    forwardingEmail: string;
    envelopeTo: string;
  }
) {
  if (!Number.isInteger(input.rawSize) || input.rawSize <= 0 || input.rawSize > MAX_RAW_BYTES)
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
  if (!forwarder) {
    const customerSender = await env.DB.prepare(
      `SELECT 1 FROM contacts WHERE workspace_id=? AND lower(email)=? LIMIT 1`
    )
      .bind(mailbox.workspace_id, forwardingEmail)
      .first();
    if (!customerSender) throw new Error("email_forwarder_not_authorized");
  }

  const id = crypto.randomUUID();
  const storageKey = `customer-emails/${mailbox.workspace_id}/${id}.eml`;
  let uploaded: Awaited<ReturnType<typeof uploadStreamToR2>>;
  try {
    uploaded = await uploadStreamToR2(env.R2_CUSTOMER_EMAILS_BUCKET, storageKey, input.raw, {
      httpMetadata: { contentType: "message/rfc822" },
      customMetadata: { forwardingEmail, envelopeTo },
    });
  } catch (error) {
    await env.R2_CUSTOMER_EMAILS_BUCKET.delete(storageKey);
    throw error;
  }
  if (uploaded.size !== input.rawSize || uploaded.object.size !== input.rawSize) {
    await env.R2_CUSTOMER_EMAILS_BUCKET.delete(storageKey);
    throw new Error("email_size_mismatch");
  }
  const hash = uploaded.sha256;
  const existing = await env.DB.prepare(
    `SELECT id,status FROM customer_email_ingestions WHERE workspace_id=? AND raw_sha256=?`
  )
    .bind(mailbox.workspace_id, hash)
    .first<{ id: string; status: string }>();
  if (existing) {
    await env.R2_CUSTOMER_EMAILS_BUCKET.delete(storageKey);
    return { ...existing, duplicate: true };
  }

  const now = nowISO();
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
      input.rawSize,
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
  let uploadedAttachments: StreamedAttachment[] = [];
  const recordedAttachmentKeys = new Set<string>();
  try {
    const outer = await parseEmailFromR2(
      env.R2_CUSTOMER_EMAILS_BUCKET,
      String(ingestion.raw_storage_key),
      (attachment, index) => {
        const filename = safeFilename(attachment.filename || `attachment-${index + 1}`);
        return `customer-emails/${ingestion.workspace_id}/${ingestionId}/attachments/${String(index + 1).padStart(4, "0")}-${crypto.randomUUID()}-${filename}`;
      }
    );
    uploadedAttachments = allStreamedAttachments(outer);
    const messages = parseThreadMessages(outer);
    if (messages.length === 0) throw new Error("email_thread_empty");
    const internalEmails = await workspaceInternalEmails(env, String(ingestion.workspace_id));
    const candidateEmails = customerAddressCandidates(outer, messages).filter(
      (email) => !internalEmails.has(email)
    );
    const uniqueMatches = new Map<string, { id: string; customer_id: string; email: string }>();
    for (const senderEmail of candidateEmails) {
      const matches = await env.DB.prepare(
        `SELECT id,customer_id,lower(email) AS email FROM contacts WHERE workspace_id=? AND lower(email)=?`
      )
        .bind(ingestion.workspace_id, senderEmail)
        .all<{ id: string; customer_id: string; email: string }>();
      for (const match of matches.results ?? []) uniqueMatches.set(match.id, match);
    }
    const matchedContacts = [...uniqueMatches.values()];
    const contact = ingestion.customer_id
      ? {
          id: ingestion.contact_id ? String(ingestion.contact_id) : null,
          customer_id: String(ingestion.customer_id),
        }
      : matchedContacts.length === 1
        ? matchedContacts[0]
        : null;
    const primaryMessage = contact
      ? messages.find((message) =>
          matchedContacts.some(
            (match) => match.id === contact.id && message.senderEmail === match.email
          )
        ) || messages[0]
      : messages[0];
    const now = nowISO();
    await env.DB.prepare(
      `UPDATE customer_email_ingestions SET original_sender_email=?,original_sender_name=?,contact_id=?,customer_id=?,subject=?,message_id=?,sent_at=?,status=?,failure_reason=?,processed_at=?,updated_at=? WHERE id=?`
    )
      .bind(
        primaryMessage.senderEmail || null,
        primaryMessage.senderName || null,
        contact?.id || null,
        contact?.customer_id || null,
        primaryMessage.subject || null,
        primaryMessage.sourceMessageId || null,
        primaryMessage.sentAt,
        contact ? "processing" : "needs_match",
        contact
          ? null
          : matchedContacts.length > 1
            ? "multiple_contact_matches"
            : "contact_not_found",
        now,
        now,
        ingestionId
      )
      .run();
    if (!contact) {
      await deleteAttachments(env.R2_CUSTOMER_EMAILS_BUCKET, uploadedAttachments);
      return;
    }
    let attachmentsRecorded = false;
    for (const message of messages) {
      const bodyHash = await sha256Hex(
        new TextEncoder().encode(normalizeMessageText(message.text)).buffer
      );
      const fingerprint = await messageFingerprint(message, bodyHash);
      const existing = await env.DB.prepare(
        `SELECT id FROM customer_email_messages WHERE workspace_id=? AND message_fingerprint=?`
      )
        .bind(ingestion.workspace_id, fingerprint)
        .first();
      if (existing) continue;
      const candidate = await summarizeMessage(env, message);
      const emailMessageId = crypto.randomUUID();
      const candidateId = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO customer_email_messages
            (id,ingestion_id,workspace_id,customer_id,contact_id,message_fingerprint,source_message_id,sender_email,sender_name,subject,sent_at,body_sha256,status,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'pending',?)`
        ).bind(
          emailMessageId,
          ingestionId,
          ingestion.workspace_id,
          contact.customer_id,
          contact.id,
          fingerprint,
          message.sourceMessageId,
          message.senderEmail,
          message.senderName || null,
          message.subject || null,
          message.sentAt,
          bodyHash,
          now
        ),
        env.DB.prepare(
          `INSERT INTO customer_email_note_candidates
            (id,ingestion_id,workspace_id,customer_id,email_message_id,category,proposed_subject,proposed_body,confidence,evidence,status,created_at)
           VALUES (?,?,?,?,?,'email_summary',?,?,?,NULL,'pending',?)`
        ).bind(
          candidateId,
          ingestionId,
          ingestion.workspace_id,
          contact.customer_id,
          emailMessageId,
          candidate.subject,
          candidate.body,
          candidate.confidence,
          now
        ),
      ]);
      if (!attachmentsRecorded && message.attachments.length > 0) {
        await recordStreamedAttachments(env, {
          ingestionId,
          emailMessageId,
          workspaceId: String(ingestion.workspace_id),
          attachments: message.attachments,
          now,
        });
        for (const attachment of message.attachments)
          recordedAttachmentKeys.add(attachment.storageKey);
        attachmentsRecorded = true;
      }
    }
    await deleteAttachments(
      env.R2_CUSTOMER_EMAILS_BUCKET,
      uploadedAttachments.filter((attachment) => !recordedAttachmentKeys.has(attachment.storageKey))
    );
    await env.DB.prepare(
      `UPDATE customer_email_ingestions SET status='ready',failure_reason=NULL,updated_at=? WHERE id=?`
    )
      .bind(now, ingestionId)
      .run();
  } catch (error) {
    await deleteAttachments(
      env.R2_CUSTOMER_EMAILS_BUCKET,
      uploadedAttachments.filter((attachment) => !recordedAttachmentKeys.has(attachment.storageKey))
    );
    const reason = error instanceof Error ? error.message : "email_processing_failed";
    await env.DB.prepare(
      `UPDATE customer_email_ingestions SET status='failed',failure_reason=?,updated_at=? WHERE id=?`
    )
      .bind(reason.slice(0, 500), nowISO(), ingestionId)
      .run();
    throw error;
  }
}

export function customerEmailStaleBeforeISO(now = Date.now()) {
  return new Date(now - STALE_PROCESSING_MS).toISOString();
}

export async function recoverStaleCustomerEmailIngestions(env: Env, now = Date.now()) {
  const stale = await env.DB.prepare(
    `SELECT id FROM customer_email_ingestions
     WHERE status='processing' AND updated_at<=?
     ORDER BY updated_at LIMIT 20`
  )
    .bind(customerEmailStaleBeforeISO(now))
    .all<{ id: string }>();
  let requeued = 0;
  for (const row of stale.results ?? []) {
    const updatedAt = new Date(now).toISOString();
    const update = await env.DB.prepare(
      `UPDATE customer_email_ingestions
       SET status='queued',failure_reason='interrupted_processing_requeued',updated_at=?
       WHERE id=? AND status='processing' AND updated_at<=?`
    )
      .bind(updatedAt, row.id, customerEmailStaleBeforeISO(now))
      .run();
    if (Number(update.meta.changes ?? 0) === 0) continue;
    try {
      await env.EVENT_QUEUE.send({
        source: "ftops",
        type: "customer.email.extract",
        externalId: row.id,
        idempotencyKey: `customer-email-recovery/${row.id}/${updatedAt}`,
        payload: { ingestionId: row.id },
        receivedAt: updatedAt,
      });
      requeued += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "email_recovery_enqueue_failed";
      await env.DB.prepare(
        `UPDATE customer_email_ingestions
         SET status='failed',failure_reason=?,updated_at=? WHERE id=? AND status='queued'`
      )
        .bind(`email_recovery_enqueue_failed:${reason}`.slice(0, 500), updatedAt, row.id)
        .run();
    }
  }
  return requeued;
}

async function workspaceInternalEmails(env: Env, workspaceId: string) {
  const [mailboxes, forwarders] = await Promise.all([
    env.DB.prepare(
      `SELECT lower(address) AS email FROM email_ingestion_mailboxes WHERE workspace_id=?`
    )
      .bind(workspaceId)
      .all<{ email: string }>(),
    env.DB.prepare(
      `SELECT lower(email) AS email FROM email_ingestion_forwarders WHERE workspace_id=?`
    )
      .bind(workspaceId)
      .all<{ email: string }>(),
  ]);
  return new Set(
    [...(mailboxes.results ?? []), ...(forwarders.results ?? [])]
      .map((row) => normalizeEmail(row.email))
      .filter(Boolean)
  );
}

function customerAddressCandidates(outer: StreamedEmail, messages: ThreadMessage[]) {
  const candidates: string[] = [];
  const add = (value: string | null | undefined) => {
    const email = normalizeEmail(value);
    if (email && !candidates.includes(email)) candidates.push(email);
  };
  add(firstAddress(outer.from));
  for (const email of addressEmails(outer.to)) add(email);
  for (const email of addressEmails(outer.cc)) add(email);
  for (const email of addressEmails(outer.bcc)) add(email);
  for (const email of forwardedHeaderEmails(outer.text || stripHtml(outer.html || ""))) add(email);
  for (const message of messages) add(message.senderEmail);
  return candidates;
}

function firstAddress(value: unknown) {
  return addressEmails(value)[0] || "";
}

function addressEmails(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const addresses = (value as { value?: unknown }).value;
  if (!Array.isArray(addresses)) return [];
  return addresses.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as { address?: unknown; group?: unknown };
    if (typeof row.address === "string") return [row.address];
    return Array.isArray(row.group)
      ? row.group.flatMap((member) =>
          member &&
          typeof member === "object" &&
          typeof (member as { address?: unknown }).address === "string"
            ? [String((member as { address: string }).address)]
            : []
        )
      : [];
  });
}

function forwardedHeaderEmails(text: string) {
  const emails: string[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let inForwardedHeaders = false;
  let foundForwardedHeader = false;
  for (const rawLine of lines) {
    const line = rawLine.replace(/^\s*>+\s?/, "").trimEnd();
    if (/^(?:-{2,}\s*)?(?:begin\s+)?forwarded message(?:\s*-{2,})?:?$/i.test(line.trim())) {
      inForwardedHeaders = true;
      foundForwardedHeader = false;
      continue;
    }
    if (!inForwardedHeaders) continue;
    if (!line.trim()) {
      if (foundForwardedHeader) inForwardedHeaders = false;
      continue;
    }
    const header = line.match(/^(?:from|to|cc|bcc):\s*(.+)$/i);
    if (!header) continue;
    foundForwardedHeader = true;
    for (const match of header[1].matchAll(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+/gi)) {
      emails.push(normalizeEmail(match[0].replace(/[>,;]+$/, "")));
    }
  }
  return emails;
}

export async function applyEmailCandidate(
  env: Env,
  input: { candidateId: string; workspaceId: string; customerId: string; actorEmail: string }
) {
  const candidate = await env.DB.prepare(
    `SELECT c.*,m.sender_email AS original_sender_email,m.sender_name AS original_sender_name,
            m.sent_at,m.subject AS email_subject,i.raw_storage_key
     FROM customer_email_note_candidates c
     JOIN customer_email_ingestions i ON i.id=c.ingestion_id
     LEFT JOIN customer_email_messages m ON m.id=c.email_message_id
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
      `UPDATE customer_email_messages SET status='applied',reviewed_at=?,reviewed_by=? WHERE id=? AND status='pending'`
    ).bind(now, input.actorEmail, candidate.email_message_id),
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
    emailMessageId: candidate.email_message_id ? String(candidate.email_message_id) : null,
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

async function recordStreamedAttachments(
  env: Env,
  input: {
    ingestionId: string;
    emailMessageId: string;
    workspaceId: string;
    attachments: StreamedAttachment[];
    now: string;
  }
) {
  const existing = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM customer_email_attachments WHERE ingestion_id=? AND email_message_id=?`
  )
    .bind(input.ingestionId, input.emailMessageId)
    .first<{ count: number }>();
  if (Number(existing?.count ?? 0) > 0) return;
  for (const [index, attachment] of input.attachments.entries()) {
    const id = crypto.randomUUID();
    const filename = safeFilename(attachment.filename || `attachment-${index + 1}`);
    await env.DB.prepare(
      `INSERT INTO customer_email_attachments
        (id,ingestion_id,email_message_id,workspace_id,original_filename,content_type,size_bytes,sha256,storage_key,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
      .bind(
        id,
        input.ingestionId,
        input.emailMessageId,
        input.workspaceId,
        filename,
        attachment.mimeType || "application/octet-stream",
        attachment.size,
        attachment.sha256,
        attachment.storageKey,
        input.now
      )
      .run();
  }
}

async function deleteAttachments(bucket: R2Bucket, attachments: StreamedAttachment[]) {
  if (attachments.length === 0) return;
  await bucket.delete(attachments.map((attachment) => attachment.storageKey));
}

async function attachEmailFilesToNote(
  env: Env,
  input: {
    ingestionId: string;
    emailMessageId: string | null;
    workspaceId: string;
    customerId: string;
    activityId: string;
    actorEmail: string;
    now: string;
  }
) {
  const rows = await env.DB.prepare(
    `SELECT * FROM customer_email_attachments
     WHERE ingestion_id=? AND workspace_id=? AND applied_activity_id IS NULL
       AND (? IS NULL OR email_message_id=?)`
  )
    .bind(input.ingestionId, input.workspaceId, input.emailMessageId, input.emailMessageId)
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

function parseThreadMessages(outer: StreamedEmail): ThreadMessage[] {
  const nestedMessages = outer.nestedEmails.flatMap((nested) => parseThreadMessages(nested));
  if (nestedMessages.length > 0) return nestedMessages;
  const text = outer.text || stripHtml(outer.html || "");
  const parsed = parseQuotedThreadText(text, outer.subject || "Customer email");
  if (parsed.length > 0) {
    parsed[0].attachments = outer.attachments;
    return parsed;
  }
  const senderEmail = normalizeEmail(firstAddress(outer.from));
  if (!senderEmail) return [];
  return [
    {
      sourceMessageId: outer.messageId,
      senderEmail,
      senderName: firstAddressName(outer.from),
      subject: outer.subject || "Customer email",
      sentAt: validDate(outer.date),
      text: normalizeMessageText(text),
      attachments: outer.attachments,
    },
  ];
}

function allStreamedAttachments(email: StreamedEmail): StreamedAttachment[] {
  return [
    ...email.attachments,
    ...email.nestedEmails.flatMap((nested) => allStreamedAttachments(nested)),
  ];
}

function firstAddressName(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const addresses = (value as { value?: unknown }).value;
  if (!Array.isArray(addresses) || !addresses[0] || typeof addresses[0] !== "object") return "";
  const name = (addresses[0] as { name?: unknown }).name;
  return typeof name === "string" ? name : "";
}

function parseQuotedThreadText(text: string, fallbackSubject: string): ThreadMessage[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const messages: ThreadMessage[] = [];
  let current: ThreadMessage | null = null;
  let readingHeaders = false;
  let body: string[] = [];
  const finish = () => {
    if (!current) return;
    current.text = normalizeMessageText(body.join("\n"));
    if (current.senderEmail && current.text) messages.push(current);
    current = null;
    body = [];
  };
  for (const line of lines) {
    const clean = line.replace(/^\s*>+\s?/, "").trimEnd();
    const from = clean.match(/^From:\s*(.+)$/i);
    if (!current && from) {
      const address = parseAddress(from[1]);
      if (!address.email) continue;
      current = {
        sourceMessageId: null,
        senderEmail: address.email,
        senderName: address.name,
        subject: normalizeThreadSubject(fallbackSubject),
        sentAt: null,
        text: "",
        attachments: [],
      };
      readingHeaders = true;
      continue;
    }
    const reply = parseReplyMarker(clean);
    if (reply) {
      finish();
      current = {
        sourceMessageId: null,
        senderEmail: reply.email,
        senderName: reply.name,
        subject: normalizeThreadSubject(fallbackSubject),
        sentAt: reply.sentAt,
        text: "",
        attachments: [],
      };
      readingHeaders = false;
      continue;
    }
    if (!current) continue;
    if (readingHeaders) {
      const subject = clean.match(/^Subject:\s*(.+)$/i);
      if (subject) current.subject = normalizeThreadSubject(subject[1]);
      const date = clean.match(/^Date:\s*(.+)$/i);
      if (date) current.sentAt = validDate(date[1]);
      if (!clean.trim()) readingHeaders = false;
      continue;
    }
    body.push(clean);
  }
  finish();
  return messages;
}

function parseReplyMarker(line: string) {
  if (!/^On\s.+\swrote:$/i.test(line)) return null;
  const address = line.match(/<([^<>\s]+@[^<>\s]+)>\s*wrote:$/i);
  const plain = address ? null : line.match(/([^\s<>]+@[^\s<>]+)\s*wrote:$/i);
  const email = normalizeEmail(address?.[1] || plain?.[1]);
  if (!email) return null;
  const beforeAddress = line
    .slice(3, line.lastIndexOf(address ? address[0] : plain![0]))
    .trim()
    .replace(/,\s*$/, "");
  return { email, name: "", sentAt: validDate(beforeAddress) };
}

function parseAddress(value: string) {
  const bracketed = value.match(/^(.*?)\s*<([^<>]+@[^<>]+)>/);
  if (bracketed)
    return {
      name: bracketed[1].trim().replace(/^['"]|['"]$/g, ""),
      email: normalizeEmail(bracketed[2]),
    };
  const email = value.match(/[^\s<>]+@[^\s<>]+/i)?.[0] || "";
  return { name: "", email: normalizeEmail(email) };
}

function normalizeThreadSubject(value: string) {
  return value.replace(/^\s*(?:(?:fwd?|re):\s*)+/i, "").trim() || "Customer email";
}

function normalizeMessageText(value: string) {
  return value
    .replace(/^\s*>+\s?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function messageFingerprint(message: ThreadMessage, bodyHash: string) {
  if (message.sourceMessageId) return `message-id:${normalizeEmail(message.sourceMessageId)}`;
  const identity = [
    message.senderEmail,
    message.sentAt || "",
    normalizeThreadSubject(message.subject).toLowerCase(),
    bodyHash,
  ].join("\n");
  return await sha256Hex(new TextEncoder().encode(identity).buffer);
}

async function summarizeMessage(env: Env, email: ThreadMessage) {
  if (!env.AI) throw new Error("email_ai_unavailable");
  const result = await env.AI.run(MODEL, {
    messages: [
      {
        role: "system",
        content:
          "Summarize this single email as one complete customer timeline note. Do not return sentence fragments and do not split it into multiple notes. Preserve every substantive project detail, especially exact dimensions and quantities; material, finish, color, construction, and hardware selections; decisions and changes; constraints and preferences; questions and concerns; budget, timing, location, contact information, and commitments. Clearly distinguish what the sender requested, decided, reported, asked, or promised. Ignore greetings, signatures, links used only for scheduling, and quoted history because other messages are summarized separately. Never invent details. Use concise Markdown bullets when the email contains multiple points. Return JSON only as {subject,summary,confidence}.",
      },
      {
        role: "user",
        content: `Sender: ${email.senderName ? `${email.senderName} <${email.senderEmail}>` : email.senderEmail}\nSent at: ${email.sentAt || "unknown"}\nSubject: ${email.subject}\n\n${email.text.slice(0, 60_000)}`,
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1400,
    temperature: 0,
  });
  const response: unknown = typeof result === "string" ? result : result.response;
  if (!response) throw new Error("email_ai_empty_response");
  return normalizeCandidate(parseAIResponse(response), email.subject);
}

function parseAIResponse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    if (unfenced) return { summary: unfenced };
    throw new Error("email_ai_response_invalid:empty_text_response");
  }
}

function normalizeCandidate(value: unknown, fallbackSubject: string): Candidate {
  const row = candidateRecord(value);
  const subject = String(row.subject || row.title || row.note_title || fallbackSubject)
    .trim()
    .slice(0, 200);
  const preferredBody =
    row.summary || row.body || row.content || row.details || row.customer_note || row.note;
  const body = candidateBody(preferredBody || candidateContentFields(row))
    .trim()
    .slice(0, 4000);
  if (!subject || !body) {
    const keys = Object.keys(row).slice(0, 12).join(",") || "none";
    throw new Error(`email_ai_response_invalid:missing_content:keys=${keys}`);
  }
  return {
    subject,
    body,
    confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0)),
  };
}

function candidateContentFields(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).filter(
      ([key]) => !["subject", "title", "note_title", "confidence"].includes(key)
    )
  );
}

function candidateRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("email_ai_response_invalid");
  if (Array.isArray(value)) return candidateRecord(value[0]);
  const row = value as Record<string, unknown>;
  for (const key of ["candidate", "result", "note"] as const) {
    if (row[key] && typeof row[key] === "object") return candidateRecord(row[key]);
  }
  for (const key of ["candidates", "notes", "summaries"] as const) {
    if (Array.isArray(row[key]) && row[key].length > 0) return candidateRecord(row[key][0]);
  }
  return row;
}

function candidateBody(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value
      .map((item) => (typeof item === "string" ? `- ${item}` : candidateBody(item)))
      .filter(Boolean)
      .join("\n");
  if (value && typeof value === "object")
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `- ${key}: ${candidateBody(item)}`)
      .filter((line) => !line.endsWith(": "))
      .join("\n");
  return "";
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
  return bytesToHex(new Uint8Array(digest));
}
function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function hexBytes(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) return new Uint8Array();
  return new Uint8Array(value.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
}
