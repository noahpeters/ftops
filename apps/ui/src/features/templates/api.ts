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

export function listTemplates() {
  return fetchJson<TemplateListItem[]>(buildUrl("/templates"), {
    method: "GET",
  });
}

export function getTemplate(key: string) {
  return fetchJson<TemplateDetail>(buildUrl(`/templates/${encodeURIComponent(key)}`), {
    method: "GET",
  });
}

export function createTemplate(body: CreateTemplateInput) {
  return fetchJson<TemplateDetail>(buildUrl("/templates"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function updateTemplate(key: string, body: UpdateTemplateInput) {
  return fetchJson<TemplateDetail>(buildUrl(`/templates/${encodeURIComponent(key)}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function deleteTemplate(key: string) {
  return fetchJson<{ deleted: boolean }>(buildUrl(`/templates/${encodeURIComponent(key)}`), {
    method: "DELETE",
  });
}

export function createRule(templateKey: string, body: CreateRuleInput) {
  return fetchJson<TemplateRule>(buildUrl(`/templates/${encodeURIComponent(templateKey)}/rules`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function updateRule(templateKey: string, ruleId: string, body: UpdateRuleInput) {
  return fetchJson<TemplateRule>(
    buildUrl(`/templates/${encodeURIComponent(templateKey)}/rules/${ruleId}`),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

export function deleteRule(templateKey: string, ruleId: string) {
  return fetchJson<{ deleted: boolean }>(
    buildUrl(`/templates/${encodeURIComponent(templateKey)}/rules/${ruleId}`),
    { method: "DELETE" }
  );
}
