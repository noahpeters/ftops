import { describe, expect, it } from "vitest";
import { classifyLineItem } from "../classifier";
import type { Registries } from "../classifier";

const registries: Registries = {
  categories: new Map([
    ["furniture", { key: "furniture", label: "Furniture", is_active: 1 }],
  ]),
  deliverables: new Map([
    [
      "dining_table",
      { key: "dining_table", label: "Dining Table", category_key: "furniture", is_active: 1 },
    ],
  ]),
};

describe("classifyLineItem", () => {
  it("extracts flags and facts and warns on invalid JSON", () => {
    const result = classifyLineItem(
      {
        uri: "line://1",
        record_uri: "record://1",
        category_key: "furniture",
        deliverable_key: "dining_table",
        group_key: null,
        title: "Table",
        quantity: 1,
        unit_price_cents: null,
        amount_cents: null,
        position: 1,
        config_json: "{",
        config_hash: "hash",
        snapshot_json: null,
        snapshot_hash: null,
        created_at: "now",
        updated_at: "now",
      },
      registries,
      { workspace_config_version: "v0", samples_default_group: "project" }
    );

    expect(result.flags.requiresDesign).toBe(false);
    expect(result.facts.woodSpecies).toBeNull();
    expect(result.warnings).toContain("invalid config_json");
    expect(result.confidence).toBeLessThan(1);
  });

  it("warns when deliverable category mismatches", () => {
    const mismatchRegistries: Registries = {
      categories: new Map([
        ["furniture", { key: "furniture", label: "Furniture", is_active: 1 }],
      ]),
      deliverables: new Map([
        [
          "cabinet_run",
          { key: "cabinet_run", label: "Cabinet Run", category_key: "cabinetry", is_active: 1 },
        ],
      ]),
    };

    const result = classifyLineItem(
      {
        uri: "line://2",
        record_uri: "record://1",
        category_key: "furniture",
        deliverable_key: "cabinet_run",
        group_key: null,
        title: null,
        quantity: 1,
        unit_price_cents: null,
        amount_cents: null,
        position: 1,
        config_json: "{}",
        config_hash: "hash",
        snapshot_json: null,
        snapshot_hash: null,
        created_at: "now",
        updated_at: "now",
      },
      mismatchRegistries,
      { workspace_config_version: "v0", samples_default_group: "project" }
    );

    expect(result.warnings.join("|")).toContain("deliverable category mismatch");
  });
});
