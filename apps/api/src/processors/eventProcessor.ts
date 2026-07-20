import type { Env, EventQueuePayload } from "../lib/types";
import { nowISO } from "../lib/utils";
import { processCommercialRecordUpserted } from "./commercialRecordUpserted";
import { processQuickbooksWebhook } from "./quickbooksWebhook";
import { processQuickbooksBootstrap } from "./quickbooksBootstrap";

export async function processEventMessage(msg: EventQueuePayload, env: Env): Promise<void> {
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
