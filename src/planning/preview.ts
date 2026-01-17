import type { Env } from "../lib/types";
import { classifyLineItem } from "./classifier";
import type { CommercialLineItemRow, Registries } from "./classifier";
import { stableStringify, sha256Hex } from "./deterministic";
import { derivePlan } from "./planner";
import type {
  PlanInput,
  PlanPreviewResponse,
  PlanLineItemInput,
} from "./types";
import { loadWorkspaceConfig } from "./workspaceConfig";
import { classifierVersion } from "./classifier";
import { plannerVersion } from "./planner";

export class NotFoundError extends Error {}

type CommercialRecordRow = {
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
  last_event_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function getPlanPreview(
  env: Env,
  recordUri: string
): Promise<PlanPreviewResponse> {
  const config = await loadWorkspaceConfig(env);
  const registries = await loadRegistries(env);
  const record = await loadRecord(env, recordUri);

  if (!record) {
    throw new NotFoundError(`Record not found: ${recordUri}`);
  }

  const lineItems = await loadLineItems(env, recordUri);
  const warnings: string[] = [];

  const planLineItems: PlanLineItemInput[] = lineItems.map((lineItem) => {
    const classification = classifyLineItem(lineItem, registries, config);
    if (classification.warnings.length > 0) {
      warnings.push(
        ...classification.warnings.map((warning) => `line_item ${lineItem.uri}: ${warning}`)
      );
    }

    const categoryLabel =
      registries.categories.get(lineItem.category_key)?.label ?? null;
    const deliverableLabel =
      registries.deliverables.get(lineItem.deliverable_key)?.label ?? null;

    return {
      uri: lineItem.uri,
      record_uri: lineItem.record_uri,
      title: lineItem.title,
      position: lineItem.position,
      quantity: lineItem.quantity,
      category_key: lineItem.category_key,
      category_label: categoryLabel,
      deliverable_key: lineItem.deliverable_key,
      deliverable_label: deliverableLabel,
      group_key: lineItem.group_key,
      config: classification.parsed_config,
      config_hash: lineItem.config_hash,
      classification,
    };
  });

  const planInput: PlanInput = {
    record: {
      uri: record.uri,
      source: record.source,
      kind: record.kind,
      external_id: record.external_id,
      customer_uri: record.customer_uri,
      customer_display: record.customer_display,
      quoted_delivery_date: record.quoted_delivery_date,
      quoted_install_date: record.quoted_install_date,
      currency: record.currency,
      total_amount_cents: record.total_amount_cents,
      snapshot_hash: record.snapshot_hash,
    },
    line_items: planLineItems,
  };

  const planPreview = derivePlan(planInput, config);
  if (planPreview.warnings.length > 0) {
    warnings.push(...planPreview.warnings);
  }

  const planInputHash = await sha256Hex(stableStringify(planInput));
  const planId = await sha256Hex(
    `plan:${record.uri}:${record.snapshot_hash}:${planInputHash}`
  );

  return {
    plan_input: planInput,
    plan_preview: planPreview,
    versions: {
      workspace_config_version: config.workspace_config_version,
      classifier_version: classifierVersion,
      planner_version: plannerVersion,
    },
    computed_at: new Date().toISOString(),
    debug: {
      plan_id: planId,
      plan_input_hash: planInputHash,
      snapshot_hash: record.snapshot_hash,
    },
    warnings,
  };
}

async function loadRegistries(env: Env): Promise<Registries> {
  const categories = await env.DB.prepare(
    "SELECT key, label, is_active FROM line_item_categories"
  ).all();
  const deliverables = await env.DB.prepare(
    "SELECT key, label, category_key, is_active FROM deliverable_kinds"
  ).all();

  const categoryMap = new Map<string, { key: string; label: string; is_active: number }>();
  for (const row of categories.results as {
    key: string;
    label: string;
    is_active: number;
  }[]) {
    categoryMap.set(row.key, row);
  }

  const deliverableMap = new Map<
    string,
    { key: string; label: string; category_key: string; is_active: number }
  >();
  for (const row of deliverables.results as {
    key: string;
    label: string;
    category_key: string;
    is_active: number;
  }[]) {
    deliverableMap.set(row.key, row);
  }

  return { categories: categoryMap, deliverables: deliverableMap };
}

async function loadRecord(env: Env, recordUri: string) {
  return env.DB.prepare(
    `SELECT uri, source, kind, external_id, customer_uri, customer_display,
            quoted_delivery_date, quoted_install_date, currency, total_amount_cents,
            snapshot_json, snapshot_hash, first_seen_at, last_seen_at, last_event_id,
            created_at, updated_at
     FROM commercial_records
     WHERE uri = ?`
  )
    .bind(recordUri)
    .first<CommercialRecordRow>();
}

async function loadLineItems(env: Env, recordUri: string) {
  const result = await env.DB.prepare(
    `SELECT uri, record_uri, category_key, deliverable_key, group_key, title, quantity,
            unit_price_cents, amount_cents, position, config_json, config_hash,
            snapshot_json, snapshot_hash, created_at, updated_at
     FROM commercial_line_items
     WHERE record_uri = ?
     ORDER BY position, uri`
  )
    .bind(recordUri)
    .all<CommercialLineItemRow>();

  return (result.results ?? []) as CommercialLineItemRow[];
}
