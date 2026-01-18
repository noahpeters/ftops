import { stableStringify } from "../lib/jsonStable";
import { sha256Hex } from "../lib/hash";
import { deriveLineItemUri } from "./commercialRecordUpserted";

type CommercialRecordPayload = {
  record?: {
    uri?: string;
    kind?: string;
    customer?: { display?: string | null };
    commitments?: {
      quotedDeliveryDate?: string | null;
      quotedInstallDate?: string | null;
    };
    currency?: string | null;
  };
  line_items?: Array<{
    uri?: string;
    title?: string;
    category_key?: string;
    deliverable_key?: string;
    group_key?: string;
    quantity?: number;
    position?: number;
    config?: Record<string, unknown>;
  }>;
};

export type NormalizedCommercialRow = {
  recordUri: string;
  recordRow: {
    uri: string;
    source: string;
    kind: string;
    external_id: string;
    customer_uri: string | null;
    customer_display: string | null;
    quoted_delivery_date: string | null;
    quoted_install_date: string | null;
    currency: string | null;
    total_amount_cents: number | null;
    snapshot_json: string;
    snapshot_hash: string;
    first_seen_at: string;
    last_seen_at: string;
    last_event_id: string;
    created_at: string;
    updated_at: string;
  };
  lineItemRows: Array<{
    uri: string;
    record_uri: string;
    category_key: string;
    deliverable_key: string;
    group_key: string | null;
    title: string | null;
    quantity: number;
    unit_price_cents: number | null;
    amount_cents: number | null;
    position: number;
    config_json: string;
    config_hash: string;
    snapshot_json: string;
    snapshot_hash: string;
    created_at: string;
    updated_at: string;
  }>;
  snapshotJson: string;
  snapshotHash: string;
};

export async function normalizeCommercialUpsert(args: {
  eventSource: string;
  externalId?: string | null;
  receivedAt: string;
  eventId: string;
  payload: unknown;
  nowIso: string;
}): Promise<NormalizedCommercialRow> {
  const payload = args.payload as CommercialRecordPayload | undefined;
  if (!payload || typeof payload !== "object") {
    throw new Error("invalid_payload");
  }

  const record = payload.record;
  const lineItems = payload.line_items;

  if (!record?.uri || !Array.isArray(lineItems)) {
    throw new Error("missing_record_or_line_items");
  }
  if (!record.kind) {
    throw new Error("missing_record_kind");
  }

  const recordUri = record.uri;
  const snapshotJson = stableStringify({ record, line_items: lineItems });
  const snapshotHash = await sha256Hex(snapshotJson);
  const externalId = args.externalId ?? recordUri;

  const recordRow = {
    uri: recordUri,
    source: args.eventSource,
    kind: record.kind,
    external_id: externalId,
    customer_uri: null,
    customer_display: record.customer?.display ?? null,
    quoted_delivery_date: record.commitments?.quotedDeliveryDate ?? null,
    quoted_install_date: record.commitments?.quotedInstallDate ?? null,
    currency: record.currency ?? null,
    total_amount_cents: null,
    snapshot_json: snapshotJson,
    snapshot_hash: snapshotHash,
    first_seen_at: args.receivedAt,
    last_seen_at: args.receivedAt,
    last_event_id: args.eventId,
    created_at: args.nowIso,
    updated_at: args.nowIso,
  };

  const lineItemRows = [] as NormalizedCommercialRow["lineItemRows"];
  for (let index = 0; index < lineItems.length; index += 1) {
    const item = lineItems[index] ?? {};
    if (!item.category_key || !item.deliverable_key) {
      throw new Error(`missing_line_item_keys_${index}`);
    }
    const quantity = item.quantity ?? 1;
    if (typeof quantity !== "number" || Number.isNaN(quantity)) {
      throw new Error(`invalid_line_item_quantity_${index}`);
    }

    const lineUri = deriveLineItemUri(recordUri, item.uri, index);
    const configJson = stableStringify(item.config ?? {});
    const configHash = await sha256Hex(configJson);
    const lineSnapshotJson = stableStringify(item);
    const lineSnapshotHash = await sha256Hex(lineSnapshotJson);

    lineItemRows.push({
      uri: lineUri,
      record_uri: recordUri,
      category_key: item.category_key,
      deliverable_key: item.deliverable_key,
      group_key: item.group_key ?? null,
      title: item.title ?? null,
      quantity,
      unit_price_cents: null,
      amount_cents: null,
      position: item.position ?? index + 1,
      config_json: configJson,
      config_hash: configHash,
      snapshot_json: lineSnapshotJson,
      snapshot_hash: lineSnapshotHash,
      created_at: args.nowIso,
      updated_at: args.nowIso,
    });
  }

  return {
    recordUri,
    recordRow,
    lineItemRows,
    snapshotJson,
    snapshotHash,
  };
}
