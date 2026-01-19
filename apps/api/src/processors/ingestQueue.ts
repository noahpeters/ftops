import type { IngestQueueMessage } from "@ftops/webhooks";
import type { Env, EventQueuePayload } from "../lib/types";
import { buildIdempotencyKey, nowISO } from "../lib/utils";

type ParsedHeaders = Record<string, string>;

export async function processIngestQueueMessage(msg: IngestQueueMessage, env: Env): Promise<void> {
  await insertIngestRequest(msg, env);

  const event = buildEventFromIngestMessage(msg);
  const emittedEventId = event.idempotencyKey;
  const emittedAt = nowISO();

  const update = await env.DB.prepare(
    `UPDATE ingest_requests
     SET emitted_event_id = ?, emitted_at = ?
     WHERE id = ? AND emitted_event_id IS NULL`
  )
    .bind(emittedEventId, emittedAt, msg.id)
    .run();

  if (!update.meta || update.meta.changes !== 1) {
    return;
  }

  try {
    await env.EVENT_QUEUE.send(event);
  } catch (error) {
    const message = error instanceof Error ? error.message : "event_enqueue_failed";
    await env.DB.prepare(`UPDATE ingest_requests SET emit_error = ? WHERE id = ?`)
      .bind(message, msg.id)
      .run();
  }
}

export function buildEventFromIngestMessage(msg: IngestQueueMessage): EventQueuePayload {
  const headers = parseHeaders(msg.headers_json);
  const rawTopic = msg.source === "shopify" ? headers["x-shopify-topic"] : null;
  const normalizedTopic = rawTopic ? rawTopic.replace(/\//g, ".") : null;

  const type =
    msg.source === "shopify" && normalizedTopic
      ? `shopify.${normalizedTopic}`
      : `${msg.source}.webhook`;
  const externalId = headers["x-shopify-webhook-id"] ?? msg.id;
  const idempotencyKey = buildIdempotencyKey(msg.source, type, msg.id);

  return {
    source: msg.source,
    type,
    externalId,
    idempotencyKey,
    payload: {
      ingestRequestId: msg.id,
      integrationId: msg.integration_id,
      externalAccountId: msg.external_account_id,
      environment: msg.environment,
      topic: rawTopic ?? null,
    },
    receivedAt: msg.received_at,
  };
}

async function insertIngestRequest(msg: IngestQueueMessage, env: Env): Promise<void> {
  const signatureHeader = msg.signature_header ?? msg.signature ?? null;
  const notes = msg.notes ?? null;

  await env.DB.prepare(
    `INSERT INTO ingest_requests
      (id, workspace_id, provider, environment, external_account_id, integration_id,
       received_at, method, url, headers_json, body_text, body_json, signature_header,
       signature_verified, verify_error, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  )
    .bind(
      msg.id,
      msg.workspace_id,
      msg.source,
      msg.environment,
      msg.external_account_id,
      msg.integration_id,
      msg.received_at,
      msg.method,
      msg.path,
      msg.headers_json,
      msg.body_text,
      msg.body_json,
      signatureHeader,
      msg.signature_verified ? 1 : 0,
      msg.verify_error,
      notes
    )
    .run();
}

function parseHeaders(raw: string): ParsedHeaders {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const headers: ParsedHeaders = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        headers[key.toLowerCase()] = value;
      }
    }
    return headers;
  } catch {
    return {};
  }
}
