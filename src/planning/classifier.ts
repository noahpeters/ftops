import type {
  ClassificationFlags,
  ClassificationFacts,
  ClassificationResult,
  WorkspaceConfig,
} from "./types";

export const classifierVersion = "v0";

export type RegistryEntry = {
  key: string;
  label: string;
  is_active: number;
  category_key?: string | null;
};

export type Registries = {
  categories: Map<string, RegistryEntry>;
  deliverables: Map<string, RegistryEntry>;
};

export type CommercialLineItemRow = {
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
  snapshot_json: string | null;
  snapshot_hash: string | null;
  created_at: string;
  updated_at: string;
};

export function classifyLineItem(
  lineItem: CommercialLineItemRow,
  registries: Registries,
  _config: WorkspaceConfig,
  parsedConfig?: Record<string, unknown>
): ClassificationResult {
  const warnings: string[] = [];
  const config = parsedConfig ?? safeParseConfig(lineItem.config_json, warnings);

  const categoryEntry = registries.categories.get(lineItem.category_key);
  if (!categoryEntry) {
    warnings.push(`unknown category_key: ${lineItem.category_key}`);
  } else if (!categoryEntry.is_active) {
    warnings.push(`inactive category_key: ${lineItem.category_key}`);
  }

  const deliverableEntry = registries.deliverables.get(lineItem.deliverable_key);
  if (!deliverableEntry) {
    warnings.push(`unknown deliverable_key: ${lineItem.deliverable_key}`);
  } else {
    if (!deliverableEntry.is_active) {
      warnings.push(`inactive deliverable_key: ${lineItem.deliverable_key}`);
    }
    if (deliverableEntry.category_key && deliverableEntry.category_key !== lineItem.category_key) {
      warnings.push(
        `deliverable category mismatch: ${lineItem.deliverable_key} -> ${deliverableEntry.category_key}`
      );
    }
  }

  const flags = extractFlags(config);
  const facts = extractFacts(config);

  let confidence = 1.0;
  if (warnings.some((warning) => warning.startsWith("invalid config_json"))) {
    confidence = Math.min(confidence, 0.7);
  }
  if (!categoryEntry || !deliverableEntry) {
    confidence = Math.min(confidence, 0.5);
  }

  return {
    category_key: lineItem.category_key,
    deliverable_key: lineItem.deliverable_key,
    flags,
    facts,
    confidence,
    warnings,
    parsed_config: config,
  };
}

function safeParseConfig(configJson: string, warnings: string[]): Record<string, unknown> {
  try {
    const parsed = JSON.parse(configJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    warnings.push("invalid config_json");
    return {};
  }
}

function extractFlags(config: Record<string, unknown>): ClassificationFlags {
  const workflow =
    (config.workflow as Record<string, unknown> | undefined) ??
    (config.flags as Record<string, unknown> | undefined) ??
    config;

  return {
    requiresDesign: Boolean(workflow?.requiresDesign),
    requiresApproval: Boolean(workflow?.requiresApproval),
    requiresSamples: Boolean(workflow?.requiresSamples),
    installRequired: Boolean(workflow?.installRequired),
    deliveryRequired: Boolean(workflow?.deliveryRequired),
  };
}

function extractFacts(config: Record<string, unknown>): ClassificationFacts {
  return {
    woodSpecies: (config.woodSpecies as string | undefined) ?? null,
    finish: (config.finish as string | undefined) ?? null,
    dimensions: (config.dimensions as string | undefined) ?? null,
    room: (config.room as string | undefined) ?? null,
    revisionLimit: (config.revisionLimit as number | undefined) ?? null,
    deliverables: Array.isArray(config.deliverables) ? (config.deliverables as string[]) : null,
  };
}
