import type { Env, EventQueuePayload } from "../lib/types";
import { nowISO } from "../lib/utils";
import { processCommercialRecordUpserted } from "./commercialRecordUpserted";
import { processQuickbooksWebhook } from "./quickbooksWebhook";
import { processQuickbooksBootstrap } from "./quickbooksBootstrap";
import { processQuoContactSync } from "../services/quo";
import { processCustomerNoteFollowUpAnalysis } from "../services/customerFollowUp";
import { processCustomerEmailIngestion } from "../services/customerEmailIngestion";
import { processDoodleCustomerEmailIngestion } from "../services/doodleEmailIngestion";
import { processQuoCallWebhook } from "../services/quoCallWebhook";

export async function processEventMessage(msg: EventQueuePayload, env: Env): Promise<void> {
  if (msg.source === "ftops" && msg.type === "customer.email.extract") {
    const ingestionId = (msg.payload as { ingestionId?: string } | undefined)?.ingestionId;
    if (!ingestionId) throw new Error("customer_email_ingestion_payload_invalid");
    const handledByDoodle = await processDoodleCustomerEmailIngestion(env, ingestionId);
    if (!handledByDoodle) await processCustomerEmailIngestion(env, ingestionId);
    return;
  }
  if (msg.source === "ftops" && msg.type === "quo.contact.sync") {
    await processQuoContactSync(
      env,
      (msg.payload ?? {}) as { contactId?: string; version?: number }
    );
    return;
  }
  if (msg.source === "ftops" && msg.type === "customer.note.follow_up.analyze") {
    await processCustomerNoteFollowUpAnalysis(
      env,
      (msg.payload ?? {}) as { workspaceId?: string; customerId?: string; noteId?: string }
    );
    return;
  }
  if (msg.source === "quo" && msg.type === "quo.webhook") {
    const ingestRequestId = (msg.payload as { ingestRequestId?: string } | undefined)
      ?.ingestRequestId;
    if (!ingestRequestId) throw new Error("quo_ingest_request_missing");
    const ingest = await env.DB.prepare(
      `SELECT workspace_id,integration_id,body_json,body_text,received_at
       FROM ingest_requests WHERE id=? AND signature_verified=1`
    )
      .bind(ingestRequestId)
      .first<{
        workspace_id: string;
        integration_id: string | null;
        body_json: string | null;
        body_text: string;
        received_at: string;
      }>();
    if (!ingest) throw new Error("quo_ingest_request_not_found_or_unverified");
    await processQuoCallWebhook(env, {
      workspaceId: ingest.workspace_id,
      integrationId: ingest.integration_id,
      eventId: msg.externalId || ingestRequestId,
      body: JSON.parse(ingest.body_json || ingest.body_text),
      receivedAt: ingest.received_at,
    });
    return;
  }
  const now = nowISO();
  const eventId = crypto.randomUUID();

  try {
    await env.DB.prepare(
      `INSERT INTO events
        (id, source, type, external_id, idempotency_key, payload, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        eventId,
        msg.source,
        msg.type,
        msg.externalId ?? null,
        msg.idempotencyKey,
        JSON.stringify(msg.payload ?? {}),
        msg.receivedAt ?? now
      )
      .run();
  } catch {
    // Duplicate (or already inserted) => ignore
    return;
  }

  try {
    if (msg.type === "commercial_record_upserted") {
      await processCommercialRecordUpserted(env, msg, eventId);
    }

    if (msg.source === "quickbooks" && msg.type === "quickbooks.webhook") {
      const ingestRequestId = (msg.payload as { ingestRequestId?: string } | undefined)
        ?.ingestRequestId;
      if (!ingestRequestId) throw new Error("quickbooks_ingest_request_missing");
      const ingest = await env.DB.prepare(
        `SELECT integration_id, body_json, body_text FROM ingest_requests WHERE id = ?`
      )
        .bind(ingestRequestId)
        .first<{ integration_id: string | null; body_json: string | null; body_text: string }>();
      if (!ingest) throw new Error("quickbooks_ingest_request_not_found");
      const raw = ingest.body_json || ingest.body_text;
      await processQuickbooksWebhook(env, {
        integrationId: ingest.integration_id,
        body: JSON.parse(raw),
      });
    }

    if (msg.source === "quickbooks" && msg.type === "quickbooks.bootstrap") {
      await processQuickbooksBootstrap(env, msg);
    }

    await env.DB.prepare(
      `UPDATE events
       SET processed_at = ?, process_error = NULL
       WHERE idempotency_key = ?`
    )
      .bind(now, msg.idempotencyKey)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "processor_failed";
    await env.DB.prepare(
      `UPDATE events
       SET process_error = ?
       WHERE idempotency_key = ?`
    )
      .bind(message, msg.idempotencyKey)
      .run();
  }
}
