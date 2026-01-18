export type DemoScenario = {
  id: string;
  name: string;
  description: string;
  defaultRequest: {
    source: string;
    type: string;
    baseExternalId: string;
    payload: Record<string, unknown>;
  };
  supports: {
    idStrategies: Array<"increment" | "random" | "fixed" | "timestamped">;
  };
  buildRequest?: (args: { externalId: string; nowIso: string }) => {
    source: string;
    type: string;
    payload: Record<string, unknown>;
  };
};

function buildManualProposalPayload(externalId: string) {
  return {
    record: {
      uri: `manual://proposal/${externalId}`,
      kind: "proposal",
      customer: { display: "Jane Smith" },
      commitments: {
        quotedDeliveryDate: "2026-03-15",
        quotedInstallDate: "2026-03-20",
      },
      currency: "USD",
    },
    line_items: [
      {
        uri: `manual://proposal/${externalId}/line/table`,
        title: "Ash Dining Table",
        category_key: "furniture",
        deliverable_key: "dining_table",
        quantity: 1,
        position: 1,
        config: {
          woodSpecies: "ash",
          finish: "smoke",
          dimensions: { length: 84, width: 40, height: 30 },
          requiresDesign: true,
          requiresApproval: true,
        },
      },
      {
        uri: `manual://proposal/${externalId}/line/delivery`,
        title: "White-glove delivery",
        category_key: "delivery",
        deliverable_key: "delivery_service",
        quantity: 1,
        position: 2,
        config: { deliveryRequired: true },
      },
      {
        uri: `manual://proposal/${externalId}/line/install`,
        title: "On-site installation",
        category_key: "install",
        deliverable_key: "install_service",
        quantity: 1,
        position: 3,
        config: { installRequired: true },
      },
    ],
  };
}

function buildCabinetryPayload(externalId: string) {
  return {
    record: {
      uri: `manual://proposal/${externalId}`,
      kind: "proposal",
      customer: { display: "Anderson Residence" },
      commitments: { quotedInstallDate: "2026-04-10" },
      currency: "USD",
    },
    line_items: [
      {
        uri: `manual://proposal/${externalId}/line/kitchen`,
        title: "Kitchen base cabinets",
        category_key: "cabinetry",
        deliverable_key: "cabinet_run",
        group_key: "kitchen",
        quantity: 1,
        position: 1,
        config: {
          room: "Kitchen",
          style: "Shaker",
          material: "Painted maple",
          requiresSamples: true,
          installRequired: true,
        },
      },
      {
        uri: `manual://proposal/${externalId}/line/pantry`,
        title: "Pantry storage cabinets",
        category_key: "cabinetry",
        deliverable_key: "cabinet_run",
        group_key: "kitchen",
        quantity: 1,
        position: 2,
        config: {
          room: "Pantry",
          style: "Shaker",
          material: "Painted maple",
          requiresSamples: true,
          installRequired: true,
        },
      },
    ],
  };
}

function buildDesignOnlyPayload(externalId: string) {
  return {
    record: {
      uri: `manual://proposal/${externalId}`,
      kind: "proposal",
      customer: { display: "Lopez Condo" },
      currency: "USD",
    },
    line_items: [
      {
        uri: `manual://proposal/${externalId}/line/design`,
        title: "Custom kitchen design package",
        category_key: "design",
        deliverable_key: "design_services",
        quantity: 1,
        position: 1,
        config: {
          revisionLimit: 3,
          deliverables: ["3D renderings", "AR walkthrough"],
          requiresApproval: true,
        },
      },
    ],
  };
}

function buildIdempotencyPayload(externalId: string, requiresDesign: boolean) {
  return {
    record: {
      uri: `manual://proposal/${externalId}`,
      kind: "proposal",
      customer: { display: "Replay Test" },
      currency: "USD",
    },
    line_items: [
      {
        uri: `manual://proposal/${externalId}/line/table`,
        title: "Walnut Coffee Table",
        category_key: "furniture",
        deliverable_key: "coffee_table",
        quantity: 1,
        position: 1,
        config: { woodSpecies: "walnut", requiresDesign },
      },
    ],
  };
}

export const DEFAULT_SCENARIOS: DemoScenario[] = [
  {
    id: "manual-proposal",
    name: "Manual proposal (furniture + delivery + install)",
    description: "Dining table with delivery/install line items and design/approval flags.",
    defaultRequest: {
      source: "manual",
      type: "commercial_record_upserted",
      baseExternalId: "proposal-demo",
      payload: buildManualProposalPayload("proposal-demo"),
    },
    supports: {
      idStrategies: ["increment", "random", "fixed", "timestamped"],
    },
    buildRequest: ({ externalId }) => ({
      source: "manual",
      type: "commercial_record_upserted",
      payload: buildManualProposalPayload(externalId),
    }),
  },
  {
    id: "cabinetry-grouped",
    name: "Cabinetry (shared samples + install)",
    description: "Grouped cabinet runs that require samples and install for shared planning.",
    defaultRequest: {
      source: "manual",
      type: "commercial_record_upserted",
      baseExternalId: "cabinet-demo",
      payload: buildCabinetryPayload("cabinet-demo"),
    },
    supports: {
      idStrategies: ["increment", "random", "fixed", "timestamped"],
    },
    buildRequest: ({ externalId }) => ({
      source: "manual",
      type: "commercial_record_upserted",
      payload: buildCabinetryPayload(externalId),
    }),
  },
  {
    id: "design-only",
    name: "Design-only engagement",
    description: "Design services only, with approval flag and no delivery/install.",
    defaultRequest: {
      source: "manual",
      type: "commercial_record_upserted",
      baseExternalId: "design-demo",
      payload: buildDesignOnlyPayload("design-demo"),
    },
    supports: {
      idStrategies: ["increment", "random", "fixed", "timestamped"],
    },
    buildRequest: ({ externalId }) => ({
      source: "manual",
      type: "commercial_record_upserted",
      payload: buildDesignOnlyPayload(externalId),
    }),
  },
  {
    id: "idempotency-variant",
    name: "Idempotency + change detection",
    description: "Re-send with fixed externalId and flip requiresDesign to test idempotency.",
    defaultRequest: {
      source: "manual",
      type: "commercial_record_upserted",
      baseExternalId: "idempotency-demo",
      payload: buildIdempotencyPayload("idempotency-demo", false),
    },
    supports: {
      idStrategies: ["fixed", "timestamped", "random"],
    },
  },
];

export function buildIdempotencyVariant(externalId: string, variant: "off" | "on") {
  return buildIdempotencyPayload(externalId, variant === "on");
}
