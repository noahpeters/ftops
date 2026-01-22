import { forbidden, json, methodNotAllowed, notFound } from "../lib/http";
import type { Env } from "../lib/types";
import { nowISO } from "../lib/utils";
import { buildEventFromIngestMessage } from "../processors/ingestQueue";
import type { IngestQueueMessage } from "@ftops/webhooks";
import { requireActor } from "../lib/access";

export async function handleAdmin(
  segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  url: URL
) {
  const actorResult = await requireActor(env, request);
  if ("response" in actorResult) {
    return actorResult.response;
  }
  if (!actorResult.actor.isSystemAdmin) {
    return forbidden("forbidden");
  }

  if (segments.length < 3) {
    return notFound("Route not found");
  }

  const [resource, id, action] = segments;
  if (resource !== "ingest-requests" || action !== "replay" || !id) {
    return notFound("Route not found");
  }

  if (request.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  const row = await env.DB.prepare(`SELECT * FROM ingest_requests WHERE id = ?`)
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) {
    return notFound("Ingest request not found");
  }

  const force = url.searchParams.get("force") === "1";
  const emittedEventId = row.emitted_event_id as string | null | undefined;

  const message = ingestRowToMessage(row);
  const event = buildEventFromIngestMessage(message);

  if (!emittedEventId) {
    await env.DB.prepare(
      `UPDATE ingest_requests
       SET emitted_event_id = ?, emitted_at = ?
       WHERE id = ? AND emitted_event_id IS NULL`
    )
      .bind(event.idempotencyKey, nowISO(), id)
      .run();
  } else if (!force) {
    return json({ ok: false, error: "already_emitted" }, 409);
  }

  try {
    await env.EVENT_QUEUE.send(event);
  } catch (error) {
    const message = error instanceof Error ? error.message : "event_enqueue_failed";
    await env.DB.prepare(`UPDATE ingest_requests SET emit_error = ? WHERE id = ?`)
      .bind(message, id)
      .run();
    return json({ ok: false, error: "enqueue_failed" }, 502);
  }

  return json({ ok: true, emitted_event_id: event.idempotencyKey });
}

function ingestRowToMessage(row: Record<string, unknown>): IngestQueueMessage {
  return {
    id: String(row.id),
    source: row.provider === "shopify" ? "shopify" : "quickbooks",
    workspace_id: String(row.workspace_id ?? "default"),
    environment: (row.environment as string | null) ?? null,
    external_account_id: (row.external_account_id as string | null) ?? null,
    integration_id: (row.integration_id as string | null) ?? null,
    received_at: String(row.received_at ?? nowISO()),
    method: String(row.method ?? "POST"),
    path: String(row.url ?? ""),
    headers_json: String(row.headers_json ?? "{}"),
    body_text: String(row.body_text ?? ""),
    body_json: (row.body_json as string | null) ?? null,
    content_type: (row.content_type as string | null) ?? null,
    signature: (row.signature_header as string | null) ?? null,
    signature_header: (row.signature_header as string | null) ?? null,
    signature_verified: Boolean(row.signature_verified),
    verify_error: (row.verify_error as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    processed_at: (row.processed_at as string | null) ?? null,
    process_error: (row.process_error as string | null) ?? null,
  };
}
