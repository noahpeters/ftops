import { useCallback, useEffect, useMemo, useState } from "react";
import { JsonView } from "../../components/JsonView";
import {
  createRule,
  createTemplate,
  deleteRule,
  deleteTemplate,
  getTemplate,
  listTemplates,
  updateRule,
  updateTemplate,
} from "./api";
import type { TemplateDetail, TemplateListItem, TemplateRule } from "./api";

const TEMPLATE_SELECTED_KEY = "ftops-ui:templates:selected";
const TEMPLATE_SEARCH_KEY = "ftops-ui:templates:search";

const EMPTY_RULE_JSON = '{\n  "attach_to": "project"\n}';

const TEMPLATE_KINDS = ["task", "checklist", "milestone"] as const;

type TemplatesState = {
  status?: number;
  url?: string;
  durationMs?: number;
  data?: TemplateListItem[];
  text?: string;
  error?: string;
};

type TemplateDetailState = {
  status?: number;
  url?: string;
  durationMs?: number;
  data?: TemplateDetail;
  text?: string;
  error?: string;
};

type RuleEditState = {
  priority: string;
  is_active: boolean;
  match_json: string;
};

type TemplateFormState = {
  title: string;
  kind: string;
  scope: string;
  category_key: string;
  deliverable_key: string;
  default_position: string;
  default_state_json: string;
  is_active: boolean;
};

type NewTemplateFormState = TemplateFormState & {
  key: string;
};

export function TemplatesPanel(): JSX.Element {
  const [templatesState, setTemplatesState] = useState<TemplatesState>({});
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateDetailState, setTemplateDetailState] = useState<TemplateDetailState>({});
  const [templateDetailLoading, setTemplateDetailLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>(() => {
    return localStorage.getItem(TEMPLATE_SELECTED_KEY) || "";
  });
  const [searchTerm, setSearchTerm] = useState<string>(() => {
    return localStorage.getItem(TEMPLATE_SEARCH_KEY) || "";
  });

  const [templateForm, setTemplateForm] = useState<TemplateFormState>({
    title: "",
    kind: "task",
    scope: "project",
    category_key: "",
    deliverable_key: "",
    default_position: "",
    default_state_json: "",
    is_active: true,
  });

  const [ruleCreateForm, setRuleCreateForm] = useState<RuleEditState>({
    priority: "100",
    is_active: true,
    match_json: EMPTY_RULE_JSON,
  });
  const [ruleEdits, setRuleEdits] = useState<Record<string, RuleEditState>>({});

  const [showNewTemplateModal, setShowNewTemplateModal] = useState(false);
  const [newTemplateForm, setNewTemplateForm] = useState<NewTemplateFormState>({
    key: "",
    title: "",
    kind: "task",
    scope: "project",
    category_key: "",
    deliverable_key: "",
    default_position: "",
    default_state_json: "",
    is_active: true,
  });

  const [savingTemplate, setSavingTemplate] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState(false);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [creatingRule, setCreatingRule] = useState(false);
  const [savingRuleId, setSavingRuleId] = useState<string | null>(null);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(TEMPLATE_SELECTED_KEY, selectedTemplateKey);
  }, [selectedTemplateKey]);

  useEffect(() => {
    localStorage.setItem(TEMPLATE_SEARCH_KEY, searchTerm);
  }, [searchTerm]);

  const refreshTemplates = useCallback(async (): Promise<void> => {
    setTemplatesLoading(true);
    setActionError(null);
    const result = await listTemplates();
    setTemplatesState({
      status: result.status,
      durationMs: result.durationMs,
      data: result.data ?? undefined,
      text: result.text,
      error: result.ok ? undefined : formatApiError(result, "Failed to load templates."),
    });

    if (result.ok && Array.isArray(result.data)) {
      const keys = result.data.map((item) => item.key);
      if (!selectedTemplateKey || !keys.includes(selectedTemplateKey)) {
        setSelectedTemplateKey(keys[0] || "");
      }
    }
    setTemplatesLoading(false);
  }, [selectedTemplateKey]);

  const loadTemplateDetail = useCallback(async (key: string): Promise<void> => {
    if (!key) {
      setTemplateDetailState({});
      return;
    }
    setTemplateDetailLoading(true);
    setActionError(null);
    const result = await getTemplate(key);
    setTemplateDetailState({
      status: result.status,
      durationMs: result.durationMs,
      data: result.data ?? undefined,
      text: result.text,
      error: result.ok ? undefined : formatApiError(result, "Failed to load template."),
    });
    setTemplateDetailLoading(false);
  }, []);

  useEffect(() => {
    if (templatesState.data) {
      return;
    }
    void refreshTemplates();
  }, [refreshTemplates, templatesState.data]);

  useEffect(() => {
    if (!selectedTemplateKey) {
      return;
    }
    void loadTemplateDetail(selectedTemplateKey);
  }, [loadTemplateDetail, selectedTemplateKey]);

  useEffect(() => {
    if (!templateDetailState.data) {
      return;
    }
    const template = templateDetailState.data.template;
    setTemplateForm({
      title: template.title ?? "",
      kind: template.kind ?? "task",
      scope: template.scope ?? "project",
      category_key: template.category_key ?? "",
      deliverable_key: template.deliverable_key ?? "",
      default_position:
        template.default_position !== null && template.default_position !== undefined
          ? String(template.default_position)
          : "",
      default_state_json: template.default_state_json ?? "",
      is_active: Boolean(template.is_active),
    });

    const nextRuleEdits: Record<string, RuleEditState> = {};
    for (const rule of templateDetailState.data.rules ?? []) {
      nextRuleEdits[rule.id] = {
        priority: String(rule.priority ?? ""),
        is_active: Boolean(rule.is_active),
        match_json: rule.match_json ?? "",
      };
    }
    setRuleEdits(nextRuleEdits);
  }, [templateDetailState.data]);

  const templates = useMemo(() => templatesState.data ?? [], [templatesState.data]);

  const filteredTemplates = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return templates;
    return templates.filter((template) => {
      return (
        template.key.toLowerCase().includes(term) ||
        template.title.toLowerCase().includes(term) ||
        template.scope.toLowerCase().includes(term)
      );
    });
  }, [templates, searchTerm]);

  const templateDetail = templateDetailState.data;
  const rules = templateDetail?.rules ?? [];

  async function handleCreateTemplate(): Promise<void> {
    if (!newTemplateForm.key.trim() || !newTemplateForm.title.trim()) {
      setActionError("Template key and title are required.");
      return;
    }

    const defaultState = parseJsonOrError(newTemplateForm.default_state_json);
    if (defaultState.error) {
      setActionError("Default state JSON must be valid.");
      return;
    }

    setCreatingTemplate(true);
    setActionError(null);
    const result = await createTemplate({
      key: newTemplateForm.key.trim(),
      title: newTemplateForm.title.trim(),
      kind: newTemplateForm.kind,
      scope: newTemplateForm.scope,
      category_key: newTemplateForm.category_key || undefined,
      deliverable_key: newTemplateForm.deliverable_key || undefined,
      default_state_json: defaultState.value,
      default_position: normalizePosition(newTemplateForm.default_position),
      is_active: newTemplateForm.is_active,
    });

    if (!result.ok) {
      setActionError(formatApiError(result, "Failed to create template."));
      setCreatingTemplate(false);
      return;
    }

    setShowNewTemplateModal(false);
    setNewTemplateForm({
      key: "",
      title: "",
      kind: "task",
      scope: "project",
      category_key: "",
      deliverable_key: "",
      default_position: "",
      default_state_json: "",
      is_active: true,
    });

    if (result.data?.template?.key) {
      setSelectedTemplateKey(result.data.template.key);
      setTemplateDetailState({
        status: result.status,
        durationMs: result.durationMs,
        data: result.data,
        text: result.text,
      });
    }

    await refreshTemplates();
    setCreatingTemplate(false);
  }

  async function handleUpdateTemplate(): Promise<void> {
    if (!templateDetail?.template?.key) {
      return;
    }

    const defaultState = parseJsonOrError(templateForm.default_state_json);
    if (defaultState.error) {
      setActionError("Default state JSON must be valid.");
      return;
    }

    setSavingTemplate(true);
    setActionError(null);
    const result = await updateTemplate(templateDetail.template.key, {
      title: templateForm.title,
      kind: templateForm.kind,
      scope: templateForm.scope,
      category_key: templateForm.category_key || null,
      deliverable_key: templateForm.deliverable_key || null,
      default_state_json: defaultState.value,
      default_position: normalizePosition(templateForm.default_position),
      is_active: templateForm.is_active,
    });

    if (!result.ok) {
      setActionError(formatApiError(result, "Failed to update template."));
      setSavingTemplate(false);
      return;
    }

    setTemplateDetailState({
      status: result.status,
      durationMs: result.durationMs,
      data: result.data ?? undefined,
      text: result.text,
    });

    await refreshTemplates();
    setSavingTemplate(false);
  }

  async function handleDeleteTemplate(): Promise<void> {
    if (!templateDetail?.template?.key) {
      return;
    }
    if (!confirm(`Delete template ${templateDetail.template.key}?`)) {
      return;
    }
    setDeletingTemplate(true);
    setActionError(null);
    const result = await deleteTemplate(templateDetail.template.key);
    if (!result.ok) {
      setActionError(formatApiError(result, "Failed to delete template."));
      setDeletingTemplate(false);
      return;
    }

    setTemplateDetailState({});
    setSelectedTemplateKey("");
    await refreshTemplates();
    setDeletingTemplate(false);
  }

  async function handleCreateRule(): Promise<void> {
    if (!templateDetail?.template?.key) {
      return;
    }
    setCreatingRule(true);
    setActionError(null);

    const priority = Number(ruleCreateForm.priority);
    if (Number.isNaN(priority)) {
      setActionError("Rule priority must be a number.");
      setCreatingRule(false);
      return;
    }

    const result = await createRule(templateDetail.template.key, {
      priority,
      match_json: ruleCreateForm.match_json,
      is_active: ruleCreateForm.is_active,
    });

    if (!result.ok) {
      setActionError(formatApiError(result, "Failed to create rule."));
      setCreatingRule(false);
      return;
    }

    setRuleCreateForm({
      priority: "100",
      is_active: true,
      match_json: EMPTY_RULE_JSON,
    });

    await loadTemplateDetail(templateDetail.template.key);
    setCreatingRule(false);
  }

  async function handleSaveRule(rule: TemplateRule): Promise<void> {
    if (!templateDetail?.template?.key) {
      return;
    }
    const edit = ruleEdits[rule.id];
    if (!edit) {
      return;
    }

    const priority = Number(edit.priority);
    if (Number.isNaN(priority)) {
      setActionError("Rule priority must be a number.");
      return;
    }

    setSavingRuleId(rule.id);
    setActionError(null);

    const result = await updateRule(templateDetail.template.key, rule.id, {
      priority,
      match_json: edit.match_json,
      is_active: edit.is_active,
    });

    if (!result.ok) {
      setActionError(formatApiError(result, "Failed to update rule."));
      setSavingRuleId(null);
      return;
    }

    await loadTemplateDetail(templateDetail.template.key);
    setSavingRuleId(null);
  }

  async function handleDeleteRule(rule: TemplateRule): Promise<void> {
    if (!templateDetail?.template?.key) {
      return;
    }
    if (!confirm(`Delete rule ${rule.id}?`)) {
      return;
    }
    setDeletingRuleId(rule.id);
    setActionError(null);

    const result = await deleteRule(templateDetail.template.key, rule.id);
    if (!result.ok) {
      setActionError(formatApiError(result, "Failed to delete rule."));
      setDeletingRuleId(null);
      return;
    }

    await loadTemplateDetail(templateDetail.template.key);
    setDeletingRuleId(null);
  }

  function updateRuleEdit(ruleId: string, patch: Partial<RuleEditState>) {
    setRuleEdits((prev) => ({
      ...prev,
      [ruleId]: { ...prev[ruleId], ...patch },
    }));
  }

  return (
    <div className="templates-panel">
      <div className="templates-toolbar">
        <div className="template-search">
          <label htmlFor="template-search">Search templates</label>
          <input
            id="template-search"
            type="text"
            placeholder="Filter by key, title, scope"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>
        <div className="templates-actions">
          <button type="button" onClick={refreshTemplates} disabled={templatesLoading}>
            {templatesLoading ? "Refreshing..." : "Refresh"}
          </button>
          <button type="button" onClick={() => setShowNewTemplateModal(true)}>
            New Template
          </button>
        </div>
      </div>

      {templatesState.error && <div className="error">{templatesState.error}</div>}

      {actionError && <div className="error">{actionError}</div>}

      <div className="templates-layout">
        <div className="template-list">
          <div className="template-list-header">
            <strong>Templates</strong>
            <span>{filteredTemplates.length} shown</span>
          </div>
          {filteredTemplates.length === 0 && <div className="empty">No templates found.</div>}
          {filteredTemplates.map((template) => {
            const isSelected = template.key === selectedTemplateKey;
            return (
              <button
                key={template.key}
                type="button"
                className={isSelected ? "active" : ""}
                onClick={() => setSelectedTemplateKey(template.key)}
              >
                <div className="template-key">{template.key}</div>
                <div className="template-meta">
                  <span>{template.title}</span>
                  <span>
                    {template.kind} · {template.scope}
                    {template.category_key ? ` · ${template.category_key}` : ""}
                    {template.deliverable_key ? `/${template.deliverable_key}` : ""}
                  </span>
                  <span className={template.is_active ? "status-on" : "status-off"}>
                    {template.is_active ? "active" : "inactive"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="template-detail">
          <div className="template-detail-header">
            <strong>Template Editor</strong>
            {templateDetailState.status !== undefined && (
              <span className="url-hint">
                Status {templateDetailState.status} · {templateDetailState.durationMs}ms
              </span>
            )}
          </div>

          {templateDetailLoading && <div className="empty">Loading template details...</div>}

          {templateDetailState.error && <div className="error">{templateDetailState.error}</div>}

          {!templateDetail && !templateDetailLoading && (
            <div className="empty">Select a template to edit.</div>
          )}

          {templateDetail && (
            <>
              <section className="panel-sub">
                <h3>Template</h3>
                <div className="form-grid">
                  <label>
                    Key
                    <input type="text" value={templateDetail.template.key} disabled />
                  </label>
                  <label>
                    Title
                    <input
                      type="text"
                      value={templateForm.title}
                      onChange={(event) =>
                        setTemplateForm((prev) => ({
                          ...prev,
                          title: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Kind
                    <select
                      value={templateForm.kind}
                      onChange={(event) =>
                        setTemplateForm((prev) => ({
                          ...prev,
                          kind: event.target.value,
                        }))
                      }
                    >
                      {TEMPLATE_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Scope
                    <select
                      value={templateForm.scope}
                      onChange={(event) =>
                        setTemplateForm((prev) => ({
                          ...prev,
                          scope: event.target.value,
                        }))
                      }
                    >
                      <option value="project">project</option>
                      <option value="shared">shared</option>
                      <option value="deliverable">deliverable</option>
                    </select>
                  </label>
                  <label>
                    Category Key
                    <input
                      type="text"
                      value={templateForm.category_key}
                      onChange={(event) =>
                        setTemplateForm((prev) => ({
                          ...prev,
                          category_key: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Deliverable Key
                    <input
                      type="text"
                      value={templateForm.deliverable_key}
                      onChange={(event) =>
                        setTemplateForm((prev) => ({
                          ...prev,
                          deliverable_key: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Default Position
                    <input
                      type="number"
                      value={templateForm.default_position}
                      onChange={(event) =>
                        setTemplateForm((prev) => ({
                          ...prev,
                          default_position: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={templateForm.is_active}
                      onChange={(event) =>
                        setTemplateForm((prev) => ({
                          ...prev,
                          is_active: event.target.checked,
                        }))
                      }
                    />
                    Active
                  </label>
                </div>

                <details className="panel-advanced">
                  <summary>Advanced: Default State JSON</summary>
                  <textarea
                    rows={6}
                    value={templateForm.default_state_json}
                    onChange={(event) =>
                      setTemplateForm((prev) => ({
                        ...prev,
                        default_state_json: event.target.value,
                      }))
                    }
                  />
                </details>

                <div className="actions">
                  <button type="button" onClick={handleUpdateTemplate} disabled={savingTemplate}>
                    {savingTemplate ? "Saving..." : "Save Template"}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={handleDeleteTemplate}
                    disabled={deletingTemplate}
                  >
                    {deletingTemplate ? "Deleting..." : "Delete Template"}
                  </button>
                </div>
              </section>

              <section className="panel-sub">
                <h3>Rules</h3>
                <div className="rule-create">
                  <label>
                    Priority
                    <input
                      type="number"
                      value={ruleCreateForm.priority}
                      onChange={(event) =>
                        setRuleCreateForm((prev) => ({
                          ...prev,
                          priority: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={ruleCreateForm.is_active}
                      onChange={(event) =>
                        setRuleCreateForm((prev) => ({
                          ...prev,
                          is_active: event.target.checked,
                        }))
                      }
                    />
                    Active
                  </label>
                  <label className="full">
                    Match JSON
                    <textarea
                      rows={4}
                      value={ruleCreateForm.match_json}
                      onChange={(event) =>
                        setRuleCreateForm((prev) => ({
                          ...prev,
                          match_json: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <button type="button" onClick={handleCreateRule} disabled={creatingRule}>
                    {creatingRule ? "Creating..." : "Create Rule"}
                  </button>
                </div>

                {rules.length === 0 && <div className="empty">No rules yet.</div>}

                <div className="rules-list">
                  {rules.map((rule) => {
                    const edit = ruleEdits[rule.id];
                    const attachTo = getAttachTo(rule.match_json);
                    return (
                      <div key={rule.id} className="rule-card">
                        <div className="rule-header">
                          <strong>Rule {rule.id}</strong>
                          {attachTo && <span className="badge">{attachTo}</span>}
                        </div>
                        <div className="form-grid">
                          <label>
                            Priority
                            <input
                              type="number"
                              value={edit?.priority ?? ""}
                              onChange={(event) =>
                                updateRuleEdit(rule.id, {
                                  priority: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label className="checkbox">
                            <input
                              type="checkbox"
                              checked={edit?.is_active ?? false}
                              onChange={(event) =>
                                updateRuleEdit(rule.id, {
                                  is_active: event.target.checked,
                                })
                              }
                            />
                            Active
                          </label>
                          <label className="full">
                            Match JSON
                            <textarea
                              rows={4}
                              value={edit?.match_json ?? ""}
                              onChange={(event) =>
                                updateRuleEdit(rule.id, {
                                  match_json: event.target.value,
                                })
                              }
                            />
                          </label>
                        </div>
                        <div className="actions">
                          <button
                            type="button"
                            onClick={() => handleSaveRule(rule)}
                            disabled={savingRuleId === rule.id}
                          >
                            {savingRuleId === rule.id ? "Saving..." : "Save"}
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => handleDeleteRule(rule)}
                            disabled={deletingRuleId === rule.id}
                          >
                            {deletingRuleId === rule.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="panel-sub">
                <h3>Raw JSON</h3>
                <div className="json-block">
                  <JsonView data={templateDetail} />
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {showNewTemplateModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h3>New Template</h3>
            <div className="form-grid">
              <label>
                Key
                <input
                  type="text"
                  value={newTemplateForm.key}
                  onChange={(event) =>
                    setNewTemplateForm((prev) => ({
                      ...prev,
                      key: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Title
                <input
                  type="text"
                  value={newTemplateForm.title}
                  onChange={(event) =>
                    setNewTemplateForm((prev) => ({
                      ...prev,
                      title: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Kind
                <select
                  value={newTemplateForm.kind}
                  onChange={(event) =>
                    setNewTemplateForm((prev) => ({
                      ...prev,
                      kind: event.target.value,
                    }))
                  }
                >
                  {TEMPLATE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Scope
                <select
                  value={newTemplateForm.scope}
                  onChange={(event) =>
                    setNewTemplateForm((prev) => ({
                      ...prev,
                      scope: event.target.value,
                    }))
                  }
                >
                  <option value="project">project</option>
                  <option value="shared">shared</option>
                  <option value="deliverable">deliverable</option>
                </select>
              </label>
              {newTemplateForm.scope === "deliverable" && (
                <>
                  <label>
                    Category Key
                    <input
                      type="text"
                      value={newTemplateForm.category_key}
                      onChange={(event) =>
                        setNewTemplateForm((prev) => ({
                          ...prev,
                          category_key: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Deliverable Key
                    <input
                      type="text"
                      value={newTemplateForm.deliverable_key}
                      onChange={(event) =>
                        setNewTemplateForm((prev) => ({
                          ...prev,
                          deliverable_key: event.target.value,
                        }))
                      }
                    />
                  </label>
                </>
              )}
              <label>
                Default Position
                <input
                  type="number"
                  value={newTemplateForm.default_position}
                  onChange={(event) =>
                    setNewTemplateForm((prev) => ({
                      ...prev,
                      default_position: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={newTemplateForm.is_active}
                  onChange={(event) =>
                    setNewTemplateForm((prev) => ({
                      ...prev,
                      is_active: event.target.checked,
                    }))
                  }
                />
                Active
              </label>
            </div>
            <details className="panel-advanced">
              <summary>Advanced: Default State JSON</summary>
              <textarea
                rows={6}
                value={newTemplateForm.default_state_json}
                onChange={(event) =>
                  setNewTemplateForm((prev) => ({
                    ...prev,
                    default_state_json: event.target.value,
                  }))
                }
              />
            </details>
            <div className="actions">
              <button type="button" onClick={handleCreateTemplate} disabled={creatingTemplate}>
                {creatingTemplate ? "Creating..." : "Create"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setShowNewTemplateModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatApiError(result: { data: unknown; text: string }, fallback: string) {
  if (result.data && typeof result.data === "object") {
    const data = result.data as { error?: string; details?: unknown };
    if (data.error) {
      return data.details ? `${data.error}: ${JSON.stringify(data.details)}` : data.error;
    }
  }
  if (result.text) {
    return result.text;
  }
  return fallback;
}

function getAttachTo(matchJson: string) {
  try {
    const parsed = JSON.parse(matchJson) as { attach_to?: string };
    return parsed.attach_to || "";
  } catch {
    return "";
  }
}

function parseJsonOrError(value: string) {
  if (!value.trim()) {
    return { value: null, error: false };
  }
  try {
    return { value: JSON.parse(value), error: false };
  } catch {
    return { value: null, error: true };
  }
}

function normalizePosition(value: string) {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}
