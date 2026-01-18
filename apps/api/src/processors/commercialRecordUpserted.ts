import type { Env, EventQueuePayload } from "../lib/types";
import { nowISO } from "../lib/utils";
import { normalizeCommercialUpsert } from "./commercialNormalize";

export async function processCommercialRecordUpserted(
  env: Env,
  evt: EventQueuePayload,
  eventId: string
) {
  const now = nowISO();
  const normalized = await normalizeCommercialUpsert({
    eventSource: evt.source,
    externalId: evt.externalId,
    receivedAt: evt.receivedAt ?? now,
    eventId,
    payload: evt.payload,
    nowIso: now,
  });

  const existing = await env.DB.prepare(
    `SELECT uri, first_seen_at, created_at
     FROM commercial_records
     WHERE uri = ?`
  )
    .bind(normalized.recordUri)
    .first<{ uri: string; first_seen_at: string; created_at: string }>();

  const firstSeenAt = existing?.first_seen_at ?? normalized.recordRow.first_seen_at;
  const createdAt = existing?.created_at ?? normalized.recordRow.created_at;

  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO commercial_records
        (uri, source, kind, external_id, customer_uri, customer_display,
         quoted_delivery_date, quoted_install_date, currency, total_amount_cents,
         snapshot_json, snapshot_hash, first_seen_at, last_seen_at, last_event_id,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        normalized.recordRow.uri,
        normalized.recordRow.source,
        normalized.recordRow.kind,
        normalized.recordRow.external_id,
        normalized.recordRow.customer_uri,
        normalized.recordRow.customer_display,
        normalized.recordRow.quoted_delivery_date,
        normalized.recordRow.quoted_install_date,
        normalized.recordRow.currency,
        normalized.recordRow.total_amount_cents,
        normalized.recordRow.snapshot_json,
        normalized.recordRow.snapshot_hash,
        firstSeenAt,
        normalized.recordRow.last_seen_at,
        normalized.recordRow.last_event_id,
        createdAt,
        now
      )
      .run();
  } else {
    await env.DB.prepare(
      `UPDATE commercial_records
       SET source = ?, kind = ?, external_id = ?, customer_uri = ?, customer_display = ?,
           quoted_delivery_date = ?, quoted_install_date = ?, currency = ?, total_amount_cents = ?,
           snapshot_json = ?, snapshot_hash = ?, last_seen_at = ?, last_event_id = ?, updated_at = ?
       WHERE uri = ?`
    )
      .bind(
        normalized.recordRow.source,
        normalized.recordRow.kind,
        normalized.recordRow.external_id,
        normalized.recordRow.customer_uri,
        normalized.recordRow.customer_display,
        normalized.recordRow.quoted_delivery_date,
        normalized.recordRow.quoted_install_date,
        normalized.recordRow.currency,
        normalized.recordRow.total_amount_cents,
        normalized.recordRow.snapshot_json,
        normalized.recordRow.snapshot_hash,
        normalized.recordRow.last_seen_at,
        normalized.recordRow.last_event_id,
        now,
        normalized.recordRow.uri
      )
      .run();
  }

  await env.DB.prepare(`DELETE FROM commercial_line_items WHERE record_uri = ?`)
    .bind(normalized.recordRow.uri)
    .run();

  for (const item of normalized.lineItemRows) {
    await env.DB.prepare(
      `INSERT INTO commercial_line_items
        (uri, record_uri, category_key, deliverable_key, group_key, title,
         quantity, unit_price_cents, amount_cents, position,
         config_json, config_hash, snapshot_json, snapshot_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        item.uri,
        item.record_uri,
        item.category_key,
        item.deliverable_key,
        item.group_key,
        item.title,
        item.quantity,
        item.unit_price_cents,
        item.amount_cents,
        item.position,
        item.config_json,
        item.config_hash,
        item.snapshot_json,
        item.snapshot_hash,
        item.created_at,
        item.updated_at
      )
      .run();
  }

  console.log(
    JSON.stringify({
      action: "commercial_upsert",
      recordUri: normalized.recordUri,
      lineItemCount: normalized.lineItemRows.length,
      snapshot_hash: normalized.snapshotHash,
    })
  );
}

export function deriveLineItemUri(recordUri: string, itemUri: string | undefined, index: number) {
  return itemUri ?? `${recordUri}/line/${index + 1}`;
}
