import type { Env, EventQueuePayload } from "../lib/types";
import { nowISO } from "../lib/utils";
import { processCommercialRecordUpserted } from "./commercialRecordUpserted";

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
