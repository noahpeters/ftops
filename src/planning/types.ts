export type WorkspaceConfig = {
  workspace_id: string;
  workspace_config_version: string;
  samples_default_group: "project" | "shared";
};

export type ClassificationFlags = {
  requiresDesign: boolean;
  requiresApproval: boolean;
  requiresSamples: boolean;
  installRequired: boolean;
  deliveryRequired: boolean;
};

export type ClassificationFacts = {
  woodSpecies: string | null;
  finish: string | null;
  dimensions: string | null;
  room: string | null;
  revisionLimit: number | null;
  deliverables: string[] | null;
};

export type ClassificationResult = {
  category_key: string;
  deliverable_key: string;
  flags: ClassificationFlags;
  facts: ClassificationFacts;
  confidence: number;
  warnings: string[];
  parsed_config: Record<string, unknown>;
};

export type PlanLineItemInput = {
  uri: string;
  record_uri: string;
  title: string | null;
  position: number;
  quantity: number;
  category_key: string;
  category_label: string | null;
  deliverable_key: string;
  deliverable_label: string | null;
  group_key: string | null;
  config: Record<string, unknown>;
  config_hash: string;
  classification: ClassificationResult;
};

export type PlanInput = {
  record: {
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
    snapshot_hash: string;
  };
  line_items: PlanLineItemInput[];
};

export type PlanGroup = {
  id: string;
  kind: "project" | "deliverable" | "shared";
  title?: string;
  line_item_uris: string[];
  template_candidates: string[];
  template_candidate_details?: {
    key: string;
    title: string;
    kind: string;
    default_position: number | null;
  }[];
  warnings: string[];
};

export type PlanPreview = {
  groups: PlanGroup[];
  warnings: string[];
};

export type PlanPreviewResponse = {
  plan_input: PlanInput;
  plan_preview: PlanPreview;
  versions: {
    workspace_config_version: string;
    classifier_version: string;
    planner_version: string;
  };
  computed_at: string;
  debug: {
    plan_id: string;
    plan_input_hash: string;
    snapshot_hash: string;
  };
  warnings: string[];
};
