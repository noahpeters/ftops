import { describe, expect, it } from "vitest";
import { matchRule } from "../ruleMatcher";

describe("matchRule", () => {
  it("matches attach_to and flags_any", () => {
    const result = matchRule(
      { attach_to: "shared", flags_any: ["requiresSamples"] },
      {
        kind: "shared",
        flags: {
          requiresDesign: false,
          requiresApproval: false,
          requiresSamples: true,
          installRequired: false,
          deliveryRequired: false,
        },
        group_key_present: true,
        quantity_total: 2,
      }
    );

    expect(result).toBe(true);
  });

  it("fails when min_quantity_total is not met", () => {
    const result = matchRule(
      { attach_to: "project", min_quantity_total: 3 },
      {
        kind: "project",
        flags: {
          requiresDesign: false,
          requiresApproval: false,
          requiresSamples: false,
          installRequired: false,
          deliveryRequired: false,
        },
        group_key_present: false,
        quantity_total: 2,
      }
    );

    expect(result).toBe(false);
  });
});
