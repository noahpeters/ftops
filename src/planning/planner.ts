import type { Env } from "../lib/types";
import { loadTemplateConfig } from "../config/templatesRepo";
import type { TemplateConfig } from "../config/templatesRepo";
import { matchRule } from "./ruleMatcher";
import type { GroupContext } from "./ruleMatcher";
import type { ClassificationFlags, PlanGroup, PlanInput, PlanPreview, WorkspaceConfig } from "./types";

export const plannerVersion = "v1";

export async function derivePlan(
  planInput: PlanInput,
  config: WorkspaceConfig,
  env: Env
): Promise<PlanPreview> {
  const templateConfig = await loadTemplateConfig(env, config.workspace_id);
  return derivePlanWithTemplates(planInput, config, templateConfig);
}

export function derivePlanWithTemplates(
  planInput: PlanInput,
  _config: WorkspaceConfig,
  templateConfig: TemplateConfig
): PlanPreview {
  const warnings: string[] = [];
  const groups = new Map<string, PlanGroup>();

  const projectId = `project::${planInput.record.uri}`;
  const projectGroup = ensureGroup(groups, {
    id: projectId,
    kind: "project",
    line_item_uris: [],
    template_candidates: [],
    warnings: [],
  });

  if (planInput.line_items.length === 0) {
    warnings.push("no line items");
  }

  warnings.push(...templateConfig.warnings);

  for (const lineItem of planInput.line_items) {
    projectGroup.line_item_uris.push(lineItem.uri);

    const deliverableId = `deliverable::${lineItem.uri}`;
    ensureGroup(groups, {
      id: deliverableId,
      kind: "deliverable",
      title: lineItem.title ?? undefined,
      line_item_uris: [lineItem.uri],
      template_candidates: [],
      warnings: [],
    });

    const sharedId = lineItem.group_key
      ? `shared::${planInput.record.uri}::${lineItem.group_key}`
      : null;

    if (sharedId) {
      const sharedGroup = ensureGroup(groups, {
        id: sharedId,
        kind: "shared",
        line_item_uris: [],
        template_candidates: [],
        warnings: [],
      });
      sharedGroup.line_item_uris.push(lineItem.uri);
    }

  }

  const lineItemByUri = new Map(planInput.line_items.map((item) => [item.uri, item]));

  for (const group of groups.values()) {
    const groupLineItems = group.line_item_uris
      .map((uri) => lineItemByUri.get(uri))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    const context = buildGroupContext(group, groupLineItems);

    for (const rule of templateConfig.rules) {
      if (!templateConfig.templatesByKey.has(rule.template_key)) {
        continue;
      }
      if (matchRule(rule.match, context)) {
        addCandidate(group, rule.template_key, templateConfig);
      }
    }
  }

  const sortedGroups = Array.from(groups.values()).sort((a, b) =>
    a.id.localeCompare(b.id)
  );

  for (const group of sortedGroups) {
    group.line_item_uris = Array.from(new Set(group.line_item_uris)).sort();
    group.template_candidates = dedupePreserveOrder(group.template_candidates);
    if (group.template_candidate_details) {
      const detailByKey = new Map(
        group.template_candidate_details.map((detail) => [detail.key, detail])
      );
      group.template_candidate_details = group.template_candidates
        .map((key) => detailByKey.get(key))
        .filter((detail): detail is NonNullable<typeof detail> => Boolean(detail));
    }
  }

  return { groups: sortedGroups, warnings };
}

function ensureGroup(groups: Map<string, PlanGroup>, group: PlanGroup): PlanGroup {
  const existing = groups.get(group.id);
  if (existing) {
    return existing;
  }
  groups.set(group.id, group);
  return group;
}

function addCandidate(group: PlanGroup, key: string, templateConfig: TemplateConfig) {
  group.template_candidates.push(key);
  const template = templateConfig.templatesByKey.get(key);
  if (template) {
    if (!group.template_candidate_details) {
      group.template_candidate_details = [];
    }
    group.template_candidate_details.push({ key, title: template.title });
  }
}

function buildGroupContext(
  group: PlanGroup,
  lineItems: PlanInput["line_items"]
): GroupContext {
  const flags = mergeFlags(lineItems.map((item) => item.classification.flags));
  const quantityTotal = lineItems.reduce((total, item) => total + item.quantity, 0);
  const groupKeyPresent = group.kind === "shared";

  if (group.kind === "deliverable") {
    const lineItem = lineItems[0];
    return {
      kind: group.kind,
      category_key: lineItem?.category_key,
      deliverable_key: lineItem?.deliverable_key,
      flags,
      group_key_present: groupKeyPresent,
      quantity_total: quantityTotal,
    };
  }

  return {
    kind: group.kind,
    flags,
    group_key_present: groupKeyPresent,
    quantity_total: quantityTotal,
  };
}

function dedupePreserveOrder(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

function mergeFlags(flagsList: ClassificationFlags[]): ClassificationFlags {
  return flagsList.reduce<ClassificationFlags>(
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
