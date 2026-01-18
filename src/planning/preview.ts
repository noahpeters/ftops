import type { Env } from "../lib/types";
import { classifyLineItem } from "./classifier";
import type { CommercialLineItemRow, Registries } from "./classifier";
import { stableStringify, sha256Hex } from "./deterministic";
import { derivePlanWithTemplates } from "./planner";
import type {
  PlanInput,
  PlanPreviewContextDeliverable,
  PlanPreviewContextProject,
  PlanPreviewContextShared,
  PlanPreviewMatch,
  PlanPreviewMatchedTemplate,
  PlanPreviewResponse,
  PlanLineItemInput,
} from "./types";
import { loadWorkspaceConfig } from "./workspaceConfig";
import { classifierVersion } from "./classifier";
import { plannerVersion } from "./planner";
import { loadTemplateConfig } from "../config/templatesRepo";
import type { TemplateConfig } from "../config/templatesRepo";
import { matchRule } from "./ruleMatcher";
import type { GroupContext } from "./ruleMatcher";

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
  const templateConfig = await loadTemplateConfig(env, config.workspace_id);

  if (!record) {
    throw new NotFoundError(`Record not found: ${recordUri}`);
  }

  const lineItems = await loadLineItems(env, recordUri);
  const warnings: string[] = [];

  const parsedConfigByUri = new Map<
    string,
    { config: Record<string, unknown> | null; parseError?: string }
  >();

  const planLineItems: PlanLineItemInput[] = lineItems.map((lineItem) => {
    const parsedConfig = parseConfigJson(lineItem.config_json);
    parsedConfigByUri.set(lineItem.uri, parsedConfig);
    const classification = classifyLineItem(
      lineItem,
      registries,
      config,
      parsedConfig.config ?? {}
    );
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

  const planPreview = derivePlanWithTemplates(planInput, config, templateConfig);
  if (planPreview.warnings.length > 0) {
    warnings.push(...planPreview.warnings);
  }

  const planInputHash = await sha256Hex(stableStringify(planInput));
  const planId = await sha256Hex(
    `plan:${record.uri}:${record.snapshot_hash}:${planInputHash}`
  );

  const contexts = buildContexts(
    record,
    lineItems,
    planLineItems,
    parsedConfigByUri
  );
  const { matches, matchedTemplatesByContext } = buildMatches(
    contexts,
    planLineItems,
    templateConfig
  );

  return {
    plan_input: planInput,
    plan_preview: planPreview,
    record: {
      uri: record.uri,
      customer_display: record.customer_display,
      quoted_delivery_date: record.quoted_delivery_date,
      quoted_install_date: record.quoted_install_date,
      snapshot_hash: record.snapshot_hash,
    },
    contexts,
    matches,
    matchedTemplatesByContext,
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

function parseConfigJson(configJson: string | null) {
  if (!configJson) {
    return { config: null as Record<string, unknown> | null };
  }
  try {
    const parsed = JSON.parse(configJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        config: null,
        parseError: "config_json must be an object",
      };
    }
    return { config: parsed as Record<string, unknown> };
  } catch {
    return { config: null, parseError: "invalid config_json" };
  }
}

function buildContexts(
  record: CommercialRecordRow,
  lineItems: CommercialLineItemRow[],
  planLineItems: PlanLineItemInput[],
  parsedConfigByUri: Map<string, { config: Record<string, unknown> | null; parseError?: string }>
) {
  const projectContext: PlanPreviewContextProject = {
    type: "project",
    key: record.uri,
    record_uri: record.uri,
    customer_display: record.customer_display,
    quoted_delivery_date: record.quoted_delivery_date,
    quoted_install_date: record.quoted_install_date,
    snapshot_hash: record.snapshot_hash,
  };

  const planLineItemByUri = new Map(planLineItems.map((item) => [item.uri, item]));

  const deliverables: PlanPreviewContextDeliverable[] = lineItems.map((lineItem) => {
    const parsedConfig = parsedConfigByUri.get(lineItem.uri);
    return {
      type: "deliverable",
      key: lineItem.uri,
      record_uri: record.uri,
      line_item_uri: lineItem.uri,
      title: lineItem.title,
      category_key: lineItem.category_key,
      deliverable_key: lineItem.deliverable_key,
      group_key: lineItem.group_key,
      quantity: lineItem.quantity,
      position: lineItem.position,
      config: parsedConfig?.config ?? null,
      config_hash: lineItem.config_hash,
      configParseError: parsedConfig?.parseError,
    };
  });

  const sharedByKey = new Map<string, PlanPreviewContextShared>();
  for (const lineItem of lineItems) {
    const groupKey = lineItem.group_key;
    if (!groupKey) continue;
    let shared = sharedByKey.get(groupKey);
    if (!shared) {
      shared = {
        type: "shared",
        key: groupKey,
        record_uri: record.uri,
        group_key: groupKey,
        line_items: [],
        derived: {
          requiresSamples: false,
          installRequired: false,
          deliveryRequired: false,
        },
      };
      sharedByKey.set(groupKey, shared);
    }
    shared.line_items.push({
      line_item_uri: lineItem.uri,
      title: lineItem.title,
      category_key: lineItem.category_key,
      deliverable_key: lineItem.deliverable_key,
      position: lineItem.position,
    });

    const planItem = planLineItemByUri.get(lineItem.uri);
    if (planItem) {
      shared.derived.requiresSamples =
        shared.derived.requiresSamples || planItem.classification.flags.requiresSamples;
      shared.derived.installRequired =
        shared.derived.installRequired ||
        planItem.classification.flags.installRequired ||
        lineItem.category_key === "install";
      shared.derived.deliveryRequired =
        shared.derived.deliveryRequired ||
        planItem.classification.flags.deliveryRequired ||
        lineItem.category_key === "delivery";
    }
  }

  const shared = Array.from(sharedByKey.values()).sort((a, b) =>
    a.key.localeCompare(b.key)
  );

  return {
    project: projectContext,
    shared,
    deliverables,
  };
}

function buildMatches(
  contexts: {
    project: PlanPreviewContextProject;
    shared: PlanPreviewContextShared[];
    deliverables: PlanPreviewContextDeliverable[];
  },
  planLineItems: PlanLineItemInput[],
  templateConfig: TemplateConfig
): {
  matches: PlanPreviewMatch[];
  matchedTemplatesByContext: Record<string, PlanPreviewMatchedTemplate[]>;
} {
  const matches: PlanPreviewMatch[] = [];
  const matchedTemplatesByContext: Record<string, PlanPreviewMatchedTemplate[]> = {};
  const lineItemByUri = new Map(planLineItems.map((item) => [item.uri, item]));

  const contextsToMatch: Array<{
    type: "project" | "shared" | "deliverable";
    key: string;
    lineItemUris: string[];
  }> = [
    {
      type: "project",
      key: contexts.project.key,
      lineItemUris: planLineItems.map((item) => item.uri),
    },
    ...contexts.shared.map((shared) => ({
      type: "shared" as const,
      key: shared.key,
      lineItemUris: shared.line_items.map((item) => item.line_item_uri),
    })),
    ...contexts.deliverables.map((deliverable) => ({
      type: "deliverable" as const,
      key: deliverable.key,
      lineItemUris: [deliverable.line_item_uri],
    })),
  ];

  for (const context of contextsToMatch) {
    const lineItems = context.lineItemUris
      .map((uri) => lineItemByUri.get(uri))
      .filter((item): item is PlanLineItemInput => Boolean(item));
    const groupContext = buildGroupContext(context.type, lineItems);
    const mapKey = `${context.type}::${context.key}`;

    for (const rule of templateConfig.rules) {
      if (!templateConfig.templatesByKey.has(rule.template_key)) {
        continue;
      }
      if (!matchRule(rule.match, groupContext)) {
        continue;
      }
      const template = templateConfig.templatesByKey.get(rule.template_key);
      if (!template) continue;

      matches.push({
        contextType: context.type,
        contextKey: context.key,
        templateKey: rule.template_key,
        rule: {
          id: rule.id,
          priority: rule.priority,
        },
      });

      if (!matchedTemplatesByContext[mapKey]) {
        matchedTemplatesByContext[mapKey] = [];
      }
      matchedTemplatesByContext[mapKey].push({
        templateKey: template.key,
        title: template.title,
        kind: template.kind,
        default_position: template.default_position ?? null,
        rulePriority: rule.priority,
        ruleId: rule.id,
      });
    }
  }

  return { matches, matchedTemplatesByContext };
}

function buildGroupContext(
  kind: "project" | "shared" | "deliverable",
  lineItems: PlanLineItemInput[]
): GroupContext {
  const flags = mergeFlags(lineItems.map((item) => item.classification.flags));
  const quantityTotal = lineItems.reduce((total, item) => total + item.quantity, 0);
  const groupKeyPresent = kind === "shared";

  if (kind === "deliverable") {
    const lineItem = lineItems[0];
    return {
      kind,
      category_key: lineItem?.category_key,
      deliverable_key: lineItem?.deliverable_key,
      flags,
      group_key_present: groupKeyPresent,
      quantity_total: quantityTotal,
    };
  }

  return {
    kind,
    flags,
    group_key_present: groupKeyPresent,
    quantity_total: quantityTotal,
  };
}

function mergeFlags(flagsList: PlanLineItemInput["classification"]["flags"][]) {
  return flagsList.reduce(
    (acc, flags) => ({
      requiresDesign: acc.requiresDesign || flags.requiresDesign,
      requiresApproval: acc.requiresApproval || flags.requiresApproval,
      requiresSamples: acc.requiresSamples || flags.requiresSamples,
      installRequired: acc.installRequired || flags.installRequired,
      deliveryRequired: acc.deliveryRequired || flags.deliveryRequired,
    }),
    {
      requiresDesign: false,
      requiresApproval: false,
      requiresSamples: false,
      installRequired: false,
      deliveryRequired: false,
    }
  );
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
