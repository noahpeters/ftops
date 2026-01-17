import type { PlanGroup, PlanInput, PlanPreview, WorkspaceConfig } from "./types";

export const plannerVersion = "v0";

const PROJECT_TEMPLATE_KEYS = ["core.project.intake", "core.project.materials_review"];

export function derivePlan(planInput: PlanInput, _config: WorkspaceConfig): PlanPreview {
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

  for (const templateKey of PROJECT_TEMPLATE_KEYS) {
    addCandidate(projectGroup, templateKey);
  }

  for (const lineItem of planInput.line_items) {
    projectGroup.line_item_uris.push(lineItem.uri);

    const deliverableId = `deliverable::${lineItem.uri}`;
    const deliverableGroup = ensureGroup(groups, {
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

    const baseKey = `${lineItem.category_key}.${lineItem.deliverable_key}.base`;
    addCandidate(deliverableGroup, baseKey);

    if (lineItem.classification.flags.requiresDesign) {
      addCandidate(
        deliverableGroup,
        `${lineItem.category_key}.${lineItem.deliverable_key}.design`
      );
    }

    if (lineItem.classification.flags.requiresApproval) {
      addCandidate(
        deliverableGroup,
        `${lineItem.category_key}.${lineItem.deliverable_key}.approval`
      );
    }

    if (lineItem.classification.flags.requiresSamples) {
      if (sharedId) {
        addCandidate(groups.get(sharedId)!, "core.shared.samples");
      } else {
        addCandidate(projectGroup, "core.shared.samples");
      }
    }

    if (lineItem.classification.flags.installRequired) {
      addCandidate(projectGroup, "core.shared.install_planning");
    }

    if (lineItem.classification.flags.deliveryRequired) {
      addCandidate(projectGroup, "core.shared.delivery_planning");
    }
  }

  const sortedGroups = Array.from(groups.values()).sort((a, b) =>
    a.id.localeCompare(b.id)
  );

  for (const group of sortedGroups) {
    group.line_item_uris = Array.from(new Set(group.line_item_uris)).sort();
    group.template_candidates = Array.from(new Set(group.template_candidates)).sort();
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

function addCandidate(group: PlanGroup, key: string) {
  group.template_candidates.push(key);
}
