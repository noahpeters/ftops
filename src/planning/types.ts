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

export type PlanPreviewContextProject = {
  type: "project";
  key: string;
  record_uri: string;
  customer_display: string | null;
  quoted_delivery_date: string | null;
  quoted_install_date: string | null;
  snapshot_hash: string;
};

export type PlanPreviewContextDeliverable = {
  type: "deliverable";
  key: string;
  record_uri: string;
  line_item_uri: string;
  title: string | null;
  category_key: string;
  deliverable_key: string;
  group_key: string | null;
  quantity: number;
  position: number;
  config: Record<string, unknown> | null;
  config_hash: string | null;
  configParseError?: string;
};

export type PlanPreviewContextShared = {
  type: "shared";
  key: string;
  record_uri: string;
  group_key: string;
  line_items: Array<{
    line_item_uri: string;
    title: string | null;
    category_key: string;
    deliverable_key: string;
    position: number;
  }>;
  derived: {
    requiresSamples: boolean;
    installRequired: boolean;
    deliveryRequired: boolean;
  };
};

export type PlanPreviewContexts = {
  project: PlanPreviewContextProject;
  shared: PlanPreviewContextShared[];
  deliverables: PlanPreviewContextDeliverable[];
};

export type PlanPreviewMatch = {
  contextType: "project" | "shared" | "deliverable";
  contextKey: string;
  templateKey: string;
  rule: {
    id: string;
    priority: number;
  };
};

export type PlanPreviewMatchedTemplate = {
  templateKey: string;
  title: string | null;
  kind: string;
  default_position: number | null;
  default_state_json?: string | null;
  rulePriority: number;
  ruleId: string;
};

export type PlanPreviewResponse = {
  plan_input: PlanInput;
  plan_preview: PlanPreview;
  record: {
    uri: string;
    customer_display: string | null;
    quoted_delivery_date: string | null;
    quoted_install_date: string | null;
    snapshot_hash: string;
  };
  contexts: PlanPreviewContexts;
  matches: PlanPreviewMatch[];
  matchedTemplatesByContext: Record<string, PlanPreviewMatchedTemplate[]>;
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
