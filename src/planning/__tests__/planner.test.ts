import { describe, expect, it } from "vitest";
import { derivePlan } from "../planner";
import type { PlanInput } from "../types";

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

    const preview = derivePlan(planInput, {
      workspace_config_version: "v0",
      samples_default_group: "project",
    });

    const groupIds = preview.groups.map((group) => group.id);
    expect(groupIds).toEqual([
      "deliverable::line://a",
      "project::record://1",
      "shared::record://1::kitchen",
    ]);

    const deliverableGroup = preview.groups.find(
      (group) => group.id === "deliverable::line://a"
    );
    expect(deliverableGroup?.template_candidates).toEqual([
      "furniture.dining_table.base",
      "furniture.dining_table.design",
    ]);

    const sharedGroup = preview.groups.find(
      (group) => group.id === "shared::record://1::kitchen"
    );
    expect(sharedGroup?.template_candidates).toEqual(["core.shared.samples"]);

    const projectGroup = preview.groups.find((group) => group.kind === "project");
    expect(projectGroup?.template_candidates).toContain("core.project.intake");
    expect(projectGroup?.template_candidates).toContain("core.shared.install_planning");
  });
});
