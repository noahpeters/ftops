import { canAccessWorkspace, canAdminWorkspace, requireActor } from "../lib/access";
import { badRequest, forbidden, json, methodNotAllowed, notFound } from "../lib/http";
import type { Env } from "../lib/types";
import { nowISO } from "../lib/utils";
import {
  applyEmailCandidate,
  customerEmailStaleBeforeISO,
  normalizeEmail,
  receiveCustomerEmail,
  receiveCustomerEmailStream,
  verifyInboundEmailRequest,
  verifyInboundEmailStreamRequest,
} from "../services/customerEmailIngestion";

export async function handleCustomerEmails(
  segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  url: URL
) {
  if (segments[0] === "inbound") return await receiveInbound(request, env);
  const auth = await requireActor(env, request);
  if (!auth.ok) return auth.response;
  const actor = auth.actor;

  if (segments.length === 0) {
    if (request.method !== "GET") return methodNotAllowed(["GET"]);
    const workspaceId = url.searchParams.get("workspaceId")?.trim() || "";
    if (!workspaceId) return badRequest("missing_workspace_id");
    if (!canAccessWorkspace(actor, workspaceId)) return forbidden("forbidden");
    const status = url.searchParams.get("status")?.trim();
    const attentionOnly = status === "attention";
    const result = await env.DB.prepare(
      `SELECT i.*,
              customer.display_name AS customer_display_name,
              contact.display_name AS contact_display_name,
              (SELECT COUNT(*) FROM customer_email_attachments a WHERE a.ingestion_id=i.id) AS attachment_count,
              (SELECT COUNT(*) FROM customer_email_note_candidates c WHERE c.ingestion_id=i.id) AS candidate_count,
              (SELECT COUNT(*) FROM customer_email_note_candidates c WHERE c.ingestion_id=i.id AND c.status='pending') AS pending_candidate_count,
              (SELECT COUNT(*) FROM customer_email_note_candidates c WHERE c.ingestion_id=i.id AND c.status='applied') AS applied_candidate_count,
              (SELECT COUNT(*) FROM customer_email_messages m WHERE m.ingestion_id=i.id) AS message_count
       FROM customer_email_ingestions i
       LEFT JOIN customers customer ON customer.id=i.customer_id AND customer.workspace_id=i.workspace_id
       LEFT JOIN contacts contact ON contact.id=i.contact_id AND contact.workspace_id=i.workspace_id
       WHERE i.workspace_id=?
         AND (?=1 AND (i.status IN ('failed','needs_match') OR (i.status='processing' AND i.updated_at<=?))
              OR ?=0 AND (? IS NULL OR i.status=?))
       ORDER BY i.received_at DESC LIMIT 100`
    )
      .bind(
        workspaceId,
        attentionOnly ? 1 : 0,
        customerEmailStaleBeforeISO(),
        attentionOnly ? 1 : 0,
        status && !attentionOnly ? status : null,
        status && !attentionOnly ? status : null
      )
      .all();
    return json(result.results ?? []);
  }

  if (segments[0] === "forwarders" || segments[0] === "mailboxes") {
    const workspaceId = url.searchParams.get("workspaceId")?.trim() || "";
    if (!workspaceId) return badRequest("missing_workspace_id");
    if (!canAdminWorkspace(actor, workspaceId)) return forbidden("forbidden");
    if (request.method === "GET") {
      const table =
        segments[0] === "mailboxes" ? "email_ingestion_mailboxes" : "email_ingestion_forwarders";
      const column = segments[0] === "mailboxes" ? "address" : "email";
      const rows = await env.DB.prepare(
        `SELECT id,${column},enabled,created_by,created_at,updated_at FROM ${table} WHERE workspace_id=? ORDER BY ${column}`
      )
        .bind(workspaceId)
        .all();
      return json(rows.results ?? []);
    }
    if (request.method === "POST") {
      const body = await readJson(request);
      const key = segments[0] === "mailboxes" ? "address" : "email";
      const email = normalizeEmail(typeof body[key] === "string" ? body[key] : "");
      if (!email || !email.includes("@")) return badRequest("invalid_email");
      const now = nowISO();
      if (segments[0] === "mailboxes") {
        const existing = await env.DB.prepare(
          `SELECT workspace_id FROM email_ingestion_mailboxes WHERE address=?`
        )
          .bind(email)
          .first<{ workspace_id: string }>();
        if (existing && existing.workspace_id !== workspaceId)
          return badRequest("mailbox_already_assigned");
        await env.DB.prepare(
          `INSERT INTO email_ingestion_mailboxes (id,workspace_id,address,enabled,created_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?) ON CONFLICT(address) DO UPDATE SET enabled=1,updated_at=excluded.updated_at`
        )
          .bind(crypto.randomUUID(), workspaceId, email, 1, actor.email, now, now)
          .run();
        return json({ address: email, enabled: true }, 201);
      }
      await env.DB.prepare(
        `INSERT INTO email_ingestion_forwarders (id,workspace_id,email,enabled,created_by,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?) ON CONFLICT(workspace_id,email) DO UPDATE SET enabled=1,updated_at=excluded.updated_at`
      )
        .bind(crypto.randomUUID(), workspaceId, email, 1, actor.email, now, now)
        .run();
      return json({ email, enabled: true }, 201);
    }
    return methodNotAllowed(["GET", "POST"]);
  }

  const candidateId = segments[1];
  const action = segments[2];
  if (segments[0] === "candidates" && candidateId && (action === "apply" || action === "dismiss")) {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    const candidate = await env.DB.prepare(
      `SELECT workspace_id,customer_id,status,ingestion_id,email_message_id FROM customer_email_note_candidates WHERE id=?`
    )
      .bind(candidateId)
      .first<{
        workspace_id: string;
        customer_id: string;
        status: string;
        ingestion_id: string;
        email_message_id: string | null;
      }>();
    if (!candidate) return notFound("Candidate not found");
    if (!canAccessWorkspace(actor, candidate.workspace_id)) return forbidden("forbidden");
    if (candidate.status !== "pending") return badRequest("candidate_already_reviewed");
    if (action === "apply") {
      const activityId = await applyEmailCandidate(env, {
        candidateId,
        workspaceId: candidate.workspace_id,
        customerId: candidate.customer_id,
        actorEmail: actor.email,
      });
      return json({ applied: true, activityId });
    }
    const now = nowISO();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE customer_email_note_candidates SET status='dismissed',reviewed_at=?,reviewed_by=? WHERE id=? AND status='pending'`
      ).bind(now, actor.email, candidateId),
      env.DB.prepare(
        `UPDATE customer_email_messages SET status='dismissed',reviewed_at=?,reviewed_by=? WHERE id=? AND status='pending'`
      ).bind(now, actor.email, candidate.email_message_id),
      env.DB.prepare(
        `UPDATE customer_email_ingestions SET status=CASE WHEN NOT EXISTS (
          SELECT 1 FROM customer_email_note_candidates WHERE ingestion_id=? AND status='pending' AND id!=?
         ) THEN 'dismissed' ELSE status END,reviewed_at=?,reviewed_by=?,updated_at=? WHERE id=?`
      ).bind(candidate.ingestion_id, candidateId, now, actor.email, now, candidate.ingestion_id),
    ]);
    return json({ dismissed: true });
  }
  if (segments[0] === "ingestions" && candidateId && action === "match") {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    const ingestion = await env.DB.prepare(
      `SELECT workspace_id,status FROM customer_email_ingestions WHERE id=?`
    )
      .bind(candidateId)
      .first<{ workspace_id: string; status: string }>();
    if (!ingestion) return notFound("Ingestion not found");
    if (!canAccessWorkspace(actor, ingestion.workspace_id)) return forbidden("forbidden");
    if (ingestion.status !== "needs_match" && ingestion.status !== "failed")
      return badRequest("ingestion_not_matchable");
    const body = await readJson(request);
    const customerId = typeof body.customerId === "string" ? body.customerId.trim() : "";
    const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
    if (!customerId) return badRequest("customer_id_required");
    const customer = await env.DB.prepare(`SELECT 1 FROM customers WHERE id=? AND workspace_id=?`)
      .bind(customerId, ingestion.workspace_id)
      .first();
    if (!customer) return badRequest("invalid_customer");
    if (contactId) {
      const contact = await env.DB.prepare(
        `SELECT 1 FROM contacts WHERE id=? AND customer_id=? AND workspace_id=?`
      )
        .bind(contactId, customerId, ingestion.workspace_id)
        .first();
      if (!contact) return badRequest("invalid_contact");
    }
    const now = nowISO();
    await env.DB.prepare(
      `UPDATE customer_email_ingestions SET customer_id=?,contact_id=?,status='queued',failure_reason=NULL,updated_at=? WHERE id=? AND workspace_id=?`
    )
      .bind(customerId, contactId || null, now, candidateId, ingestion.workspace_id)
      .run();
    await env.EVENT_QUEUE.send({
      source: "ftops",
      type: "customer.email.extract",
      externalId: candidateId,
      idempotencyKey: `customer-email-match/${candidateId}/${now}`,
      payload: { ingestionId: candidateId },
      receivedAt: now,
    });
    return json({ queued: true });
  }
  return notFound("Route not found");
}

async function receiveInbound(request: Request, env: Env) {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  if (request.headers.get("x-ftops-email-signature-version") === "2") {
    if (!(await verifyInboundEmailStreamRequest(request, env)))
      return forbidden("invalid_signature");
    if (!request.body) return badRequest("email_size_invalid");
    try {
      const result = await receiveCustomerEmailStream(env, {
        raw: request.body,
        rawSize: Number(request.headers.get("x-ftops-raw-size")),
        forwardingEmail: request.headers.get("x-ftops-envelope-from") || "",
        envelopeTo: request.headers.get("x-ftops-envelope-to") || "",
      });
      return json(result, result.duplicate ? 200 : 202);
    } catch (error) {
      return inboundError(error);
    }
  }
  const raw = await request.arrayBuffer();
  if (!(await verifyInboundEmailRequest(request, raw, env))) return forbidden("invalid_signature");
  try {
    const result = await receiveCustomerEmail(env, {
      raw,
      forwardingEmail: request.headers.get("x-ftops-envelope-from") || "",
      envelopeTo: request.headers.get("x-ftops-envelope-to") || "",
    });
    return json(result, result.duplicate ? 200 : 202);
  } catch (error) {
    return inboundError(error);
  }
}
function inboundError(error: unknown) {
  const message = error instanceof Error ? error.message : "email_ingestion_failed";
  if (message === "email_forwarder_not_authorized" || message === "email_mailbox_not_configured")
    return forbidden(message);
  if (message === "email_size_invalid" || message === "email_size_mismatch")
    return badRequest(message);
  throw error;
}
async function readJson(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}
