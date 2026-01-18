import { describe, expect, it } from "vitest";
import { derivePlanWithTemplates } from "../planner";
import type { PlanInput } from "../types";
import type { TemplateConfig, TemplateRow } from "../../config/templatesRepo";

describe("derivePlan", () => {
  it("builds deterministic groups and candidates", () => {
    const planInput: PlanInput = {
      record: {
        uri: "record://1",
        source: "manual",
        kind: "proposal",
        external_id: "1",
        customer_uri: null,
        customer_display: null,
        quoted_delivery_date: null,
        quoted_install_date: null,
        currency: null,
        total_amount_cents: null,
        snapshot_hash: "snap",
      },
      line_items: [
        {
          uri: "line://a",
          record_uri: "record://1",
          title: "Dining Table",
          position: 1,
          quantity: 1,
          category_key: "furniture",
          category_label: "Furniture",
          deliverable_key: "dining_table",
          deliverable_label: "Dining Table",
          group_key: "kitchen",
          config: {},
          config_hash: "hash",
          classification: {
            category_key: "furniture",
            deliverable_key: "dining_table",
            flags: {
              requiresDesign: true,
              requiresApproval: false,
              requiresSamples: true,
              installRequired: true,
              deliveryRequired: false,
            },
            facts: {
              woodSpecies: null,
              finish: null,
              dimensions: null,
              room: null,
              revisionLimit: null,
              deliverables: null,
            },
            confidence: 1,
            warnings: [],
            parsed_config: {},
          },
        },
      ],
    };

    const baseTemplate: Omit<TemplateRow, "key" | "title" | "scope"> = {
      id: "id",
      workspace_id: "default",
      kind: "task",
      category_key: null,
      deliverable_key: null,
      default_state_json: null,
      default_position: null,
      is_active: 1,
      created_at: "now",
      updated_at: "now",
    };

    const templateConfig: TemplateConfig = {
      templatesByKey: new Map([
        [
          "core.project.intake",
          { ...baseTemplate, key: "core.project.intake", title: "Intake", scope: "project" },
        ],
        [
          "core.shared.samples",
          { ...baseTemplate, key: "core.shared.samples", title: "Samples", scope: "shared" },
        ],
        [
          "core.shared.install_planning",
          {
            ...baseTemplate,
            key: "core.shared.install_planning",
            title: "Install Planning",
            scope: "shared",
          },
        ],
        [
          "furniture.dining_table.base",
          {
            ...baseTemplate,
            key: "furniture.dining_table.base",
            title: "Base",
            scope: "deliverable",
            category_key: "furniture",
            deliverable_key: "dining_table",
          },
        ],
        [
          "furniture.dining_table.design",
          {
            ...baseTemplate,
            key: "furniture.dining_table.design",
            title: "Design",
            scope: "deliverable",
            category_key: "furniture",
            deliverable_key: "dining_table",
          },
        ],
      ]),
      rules: [
        {
          id: "r1",
          template_key: "core.project.intake",
          priority: 100,
          match: { attach_to: "project" },
          match_json: '{"attach_to":"project"}',
        },
        {
          id: "r2",
          template_key: "core.shared.samples",
          priority: 90,
          match: {
            attach_to: "shared",
            flags_any: ["requiresSamples"],
            group_key_present: true,
          },
          match_json:
            '{"attach_to":"shared","flags_any":["requiresSamples"],"group_key_present":true}',
        },
        {
          id: "r3",
          template_key: "core.shared.install_planning",
          priority: 70,
          match: { attach_to: "shared", flags_any: ["installRequired"] },
          match_json: '{"attach_to":"shared","flags_any":["installRequired"]}',
        },
        {
          id: "r4",
          template_key: "furniture.dining_table.base",
          priority: 60,
          match: {
            attach_to: "deliverable",
            category_key: "furniture",
            deliverable_key: "dining_table",
          },
          match_json:
            '{"attach_to":"deliverable","category_key":"furniture","deliverable_key":"dining_table"}',
        },
        {
          id: "r5",
          template_key: "furniture.dining_table.design",
          priority: 50,
          match: {
            attach_to: "deliverable",
            category_key: "furniture",
            deliverable_key: "dining_table",
            flags_any: ["requiresDesign"],
          },
          match_json:
            '{"attach_to":"deliverable","category_key":"furniture","deliverable_key":"dining_table","flags_any":["requiresDesign"]}',
        },
      ],
      warnings: [],
    };

    const preview = derivePlanWithTemplates(
      planInput,
      {
        workspace_id: "default",
        workspace_config_version: "v0",
        samples_default_group: "project",
      },
      templateConfig
    );

    const groupIds = preview.groups.map((group) => group.id);
    expect(groupIds).toEqual([
      "deliverable::line://a",
      "project::record://1",
      "shared::record://1::kitchen",
    ]);

    const deliverableGroup = preview.groups.find((group) => group.id === "deliverable::line://a");
    expect(deliverableGroup?.template_candidates).toEqual([
      "furniture.dining_table.base",
      "furniture.dining_table.design",
    ]);

    const sharedGroup = preview.groups.find((group) => group.id === "shared::record://1::kitchen");
    expect(sharedGroup?.template_candidates).toEqual([
      "core.shared.samples",
      "core.shared.install_planning",
    ]);

    const projectGroup = preview.groups.find((group) => group.kind === "project");
    expect(projectGroup?.template_candidates).toContain("core.project.intake");
    expect(projectGroup?.template_candidates).not.toContain("core.shared.install_planning");
  });
});
