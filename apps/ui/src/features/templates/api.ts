import { buildUrl, fetchJson } from "../../lib/api";

export type TemplateListItem = {
  key: string;
  title: string;
  kind: string;
  scope: string;
  is_active: number;
  category_key: string | null;
  deliverable_key: string | null;
  default_state_json: string | null;
  default_position: number | null;
};

export type TemplateRule = {
  id: string;
  template_key: string;
  priority: number;
  match_json: string;
  is_active: number;
  match?: unknown;
};

export type TemplateDetail = {
  template: TemplateListItem & {
    id?: string;
    workspace_id?: string;
    created_at?: string;
    updated_at?: string;
  };
  rules: TemplateRule[];
};

export type CreateTemplateInput = {
  key: string;
  title: string;
  kind: string;
  scope: string;
  category_key?: string | null;
  deliverable_key?: string | null;
  default_state_json?: string | object | null;
  default_position?: number | null;
  is_active?: boolean;
};

export type UpdateTemplateInput = {
  title?: string;
  kind?: string;
  scope?: string;
  category_key?: string | null;
  deliverable_key?: string | null;
  default_state_json?: string | object | null;
  default_position?: number | null;
  is_active?: boolean;
};

export type CreateRuleInput = {
  priority: number;
  match_json: string;
  is_active?: boolean;
};

export type UpdateRuleInput = {
  priority?: number;
  match_json?: string;
  is_active?: boolean;
};

export function listTemplates(workspaceId: string) {
  return fetchJson<TemplateListItem[]>(buildUrl("/templates", { workspaceId }), {
    method: "GET",
  });
}

export function getTemplate(key: string, workspaceId: string) {
  return fetchJson<TemplateDetail>(
    buildUrl(`/templates/${encodeURIComponent(key)}`, { workspaceId }),
    {
      method: "GET",
    }
  );
}

export function createTemplate(body: CreateTemplateInput, workspaceId: string) {
  return fetchJson<TemplateDetail>(buildUrl("/templates", { workspaceId }), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function updateTemplate(key: string, body: UpdateTemplateInput, workspaceId: string) {
  return fetchJson<TemplateDetail>(
    buildUrl(`/templates/${encodeURIComponent(key)}`, { workspaceId }),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

export function deleteTemplate(key: string, workspaceId: string) {
  return fetchJson<{ deleted: boolean }>(
    buildUrl(`/templates/${encodeURIComponent(key)}`, { workspaceId }),
    { method: "DELETE" }
  );
}

export function createRule(templateKey: string, body: CreateRuleInput, workspaceId: string) {
  return fetchJson<TemplateRule>(
    buildUrl(`/templates/${encodeURIComponent(templateKey)}/rules`, { workspaceId }),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

export function updateRule(
  templateKey: string,
  ruleId: string,
  body: UpdateRuleInput,
  workspaceId: string
) {
  return fetchJson<TemplateRule>(
    buildUrl(`/templates/${encodeURIComponent(templateKey)}/rules/${ruleId}`, { workspaceId }),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

export function deleteRule(templateKey: string, ruleId: string, workspaceId: string) {
  return fetchJson<{ deleted: boolean }>(
    buildUrl(`/templates/${encodeURIComponent(templateKey)}/rules/${ruleId}`, { workspaceId }),
    { method: "DELETE" }
  );
}
