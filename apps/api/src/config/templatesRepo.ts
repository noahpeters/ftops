import type { Env } from "../lib/types";
import { nowISO } from "../lib/utils";

export type TemplateRow = {
  id: string;
  workspace_id: string;
  key: string;
  title: string;
  kind: "task" | "checklist" | "milestone";
  scope: "project" | "shared" | "deliverable";
  category_key: string | null;
  deliverable_key: string | null;
  default_state_json: string | null;
  default_position: number | null;
  is_active: number;
  created_at: string;
  updated_at: string;
};

export type TemplateRuleRow = {
  id: string;
  workspace_id: string;
  template_key: string;
  priority: number;
  match_json: string;
  is_active: number;
  created_at: string;
  updated_at: string;
};

export type TemplateRuleMatch = {
  attach_to: "project" | "shared" | "deliverable";
  category_key?: string;
  deliverable_key?: string;
  flags_all?: string[];
  flags_any?: string[];
  flags_none?: string[];
  group_key_present?: boolean;
  min_quantity_total?: number;
};

export type TemplateRule = {
  id: string;
  template_key: string;
  priority: number;
  match: TemplateRuleMatch;
  match_json: string;
};

export type TemplateConfig = {
  templatesByKey: Map<string, TemplateRow>;
  rules: TemplateRule[];
  warnings: string[];
};

export type TemplateCreateInput = {
  key: string;
  title: string;
  kind: "task" | "checklist" | "milestone";
  scope: "project" | "shared" | "deliverable";
  category_key: string | null;
  deliverable_key: string | null;
  default_state_json: string | null;
  default_position: number | null;
  is_active: number;
};

export type TemplateUpdatePatch = {
  title?: string;
  kind?: "task" | "checklist" | "milestone";
  scope?: "project" | "shared" | "deliverable";
  category_key?: string | null;
  deliverable_key?: string | null;
  default_state_json?: string | null;
  default_position?: number | null;
  is_active?: number;
};

export type RuleCreateInput = {
  priority: number;
  match_json: string;
  is_active: number;
};

export type RuleUpdatePatch = {
  priority?: number;
  match_json?: string;
  is_active?: number;
};

const DEFAULT_WORKSPACE_ID = "default";

export function getDefaultWorkspaceId() {
  return DEFAULT_WORKSPACE_ID;
}

export async function listTemplates(env: Env, workspaceId = DEFAULT_WORKSPACE_ID) {
  const result = await env.DB.prepare(
    `SELECT id, workspace_id, key, title, kind, scope, category_key, deliverable_key,
            default_state_json, default_position, is_active, created_at, updated_at
     FROM templates
     WHERE workspace_id = ?
     ORDER BY key`
  )
    .bind(workspaceId)
    .all<TemplateRow>();

  return (result.results ?? []) as TemplateRow[];
}

export async function getTemplateDetailByKey(
  env: Env,
  templateKey: string,
  workspaceId = DEFAULT_WORKSPACE_ID
) {
  const template = await env.DB.prepare(
    `SELECT id, workspace_id, key, title, kind, scope, category_key, deliverable_key,
            default_state_json, default_position, is_active, created_at, updated_at
     FROM templates
     WHERE workspace_id = ? AND key = ?`
  )
    .bind(workspaceId, templateKey)
    .first<TemplateRow>();

  if (!template) {
    return null;
  }

  const rulesResult = await env.DB.prepare(
    `SELECT id, workspace_id, template_key, priority, match_json, is_active, created_at, updated_at
     FROM template_rules
     WHERE workspace_id = ? AND template_key = ?
     ORDER BY priority DESC, id ASC`
  )
    .bind(workspaceId, templateKey)
    .all<TemplateRuleRow>();

  const parsedRules = parseRules(rulesResult.results ?? []);

  return {
    template,
    rules: parsedRules.rules,
    steps: [],
  };
}

export async function createTemplate(
  env: Env,
  input: TemplateCreateInput,
  workspaceId = DEFAULT_WORKSPACE_ID
) {
  const now = nowISO();
  const id = input.key;

  await env.DB.prepare(
    `INSERT INTO templates
      (id, workspace_id, key, title, kind, scope, category_key, deliverable_key,
       default_state_json, default_position, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      workspaceId,
      input.key,
      input.title,
      input.kind,
      input.scope,
      input.category_key,
      input.deliverable_key,
      input.default_state_json,
      input.default_position,
      input.is_active,
      now,
      now
    )
    .run();

  console.log(
    JSON.stringify({
      action: "template.create",
      template_key: input.key,
      workspace_id: workspaceId,
    })
  );

  return getTemplateDetailByKey(env, input.key, workspaceId);
}

export async function updateTemplate(
  env: Env,
  templateKey: string,
  patch: TemplateUpdatePatch,
  workspaceId = DEFAULT_WORKSPACE_ID
) {
  const existing = await env.DB.prepare(
    `SELECT id, workspace_id, key, title, kind, scope, category_key, deliverable_key,
            default_state_json, default_position, is_active, created_at, updated_at
     FROM templates
     WHERE workspace_id = ? AND key = ?`
  )
    .bind(workspaceId, templateKey)
    .first<TemplateRow>();

  if (!existing) {
    return null;
  }

  const next = {
    title: patch.title ?? existing.title,
    kind: patch.kind ?? existing.kind,
    scope: patch.scope ?? existing.scope,
    category_key: patch.category_key !== undefined ? patch.category_key : existing.category_key,
    deliverable_key:
      patch.deliverable_key !== undefined ? patch.deliverable_key : existing.deliverable_key,
    default_state_json:
      patch.default_state_json !== undefined
        ? patch.default_state_json
        : existing.default_state_json,
    default_position:
      patch.default_position !== undefined ? patch.default_position : existing.default_position,
    is_active: patch.is_active ?? existing.is_active,
  };

  const now = nowISO();

  await env.DB.prepare(
    `UPDATE templates
     SET title = ?, kind = ?, scope = ?, category_key = ?, deliverable_key = ?,
         default_state_json = ?, default_position = ?, is_active = ?, updated_at = ?
     WHERE workspace_id = ? AND key = ?`
  )
    .bind(
      next.title,
      next.kind,
      next.scope,
      next.category_key,
      next.deliverable_key,
      next.default_state_json,
      next.default_position,
      next.is_active,
      now,
      workspaceId,
      templateKey
    )
    .run();

  console.log(
    JSON.stringify({
      action: "template.update",
      template_key: templateKey,
      workspace_id: workspaceId,
    })
  );

  return getTemplateDetailByKey(env, templateKey, workspaceId);
}

export async function deleteTemplate(
  env: Env,
  templateKey: string,
  workspaceId = DEFAULT_WORKSPACE_ID
) {
  const existing = await env.DB.prepare(
    `SELECT id FROM templates WHERE workspace_id = ? AND key = ?`
  )
    .bind(workspaceId, templateKey)
    .first();

  if (!existing) {
    return false;
  }

  await env.DB.prepare(`DELETE FROM template_rules WHERE workspace_id = ? AND template_key = ?`)
    .bind(workspaceId, templateKey)
    .run();

  await env.DB.prepare(`DELETE FROM templates WHERE workspace_id = ? AND key = ?`)
    .bind(workspaceId, templateKey)
    .run();

  console.log(
    JSON.stringify({
      action: "template.delete",
      template_key: templateKey,
      workspace_id: workspaceId,
    })
  );

  return true;
}

export async function createRule(
  env: Env,
  templateKey: string,
  input: RuleCreateInput,
  workspaceId = DEFAULT_WORKSPACE_ID
) {
  const now = nowISO();
  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO template_rules
      (id, workspace_id, template_key, priority, match_json, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, workspaceId, templateKey, input.priority, input.match_json, input.is_active, now, now)
    .run();

  console.log(
    JSON.stringify({
      action: "template.rule.create",
      template_key: templateKey,
      rule_id: id,
      workspace_id: workspaceId,
    })
  );

  return getRuleById(env, templateKey, id, workspaceId);
}

export async function updateRule(
  env: Env,
  templateKey: string,
  ruleId: string,
  patch: RuleUpdatePatch,
  workspaceId = DEFAULT_WORKSPACE_ID
) {
  const existing = await getRuleById(env, templateKey, ruleId, workspaceId);
  if (!existing) {
    return null;
  }

  const next = {
    priority: patch.priority ?? existing.priority,
    match_json: patch.match_json ?? existing.match_json,
    is_active: patch.is_active ?? existing.is_active,
  };

  const now = nowISO();

  await env.DB.prepare(
    `UPDATE template_rules
     SET priority = ?, match_json = ?, is_active = ?, updated_at = ?
     WHERE workspace_id = ? AND template_key = ? AND id = ?`
  )
    .bind(next.priority, next.match_json, next.is_active, now, workspaceId, templateKey, ruleId)
    .run();

  console.log(
    JSON.stringify({
      action: "template.rule.update",
      template_key: templateKey,
      rule_id: ruleId,
      workspace_id: workspaceId,
    })
  );

  return getRuleById(env, templateKey, ruleId, workspaceId);
}

export async function deleteRule(
  env: Env,
  templateKey: string,
  ruleId: string,
  workspaceId = DEFAULT_WORKSPACE_ID
) {
  const result = await env.DB.prepare(
    `DELETE FROM template_rules
     WHERE workspace_id = ? AND template_key = ? AND id = ?`
  )
    .bind(workspaceId, templateKey, ruleId)
    .run();

  const deleted = Boolean(result.success);

  if (deleted) {
    console.log(
      JSON.stringify({
        action: "template.rule.delete",
        template_key: templateKey,
        rule_id: ruleId,
        workspace_id: workspaceId,
      })
    );
  }

  return deleted;
}

export async function loadTemplateConfig(
  env: Env,
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<TemplateConfig> {
  const templatesResult = await env.DB.prepare(
    `SELECT id, workspace_id, key, title, kind, scope, category_key, deliverable_key,
            default_state_json, default_position, is_active, created_at, updated_at
     FROM templates
     WHERE workspace_id = ? AND is_active = 1`
  )
    .bind(workspaceId)
    .all<TemplateRow>();

  const rulesResult = await env.DB.prepare(
    `SELECT id, workspace_id, template_key, priority, match_json, is_active, created_at, updated_at
     FROM template_rules
     WHERE workspace_id = ? AND is_active = 1`
  )
    .bind(workspaceId)
    .all<TemplateRuleRow>();

  const templatesByKey = new Map<string, TemplateRow>();
  for (const template of templatesResult.results ?? []) {
    templatesByKey.set(template.key, template);
  }

  const parsed = parseRules(rulesResult.results ?? []);
  const activeRules = parsed.rules.filter((rule) => templatesByKey.has(rule.template_key));

  activeRules.sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    const keyCompare = a.template_key.localeCompare(b.template_key);
    if (keyCompare !== 0) {
      return keyCompare;
    }
    return a.id.localeCompare(b.id);
  });

  return {
    templatesByKey,
    rules: activeRules,
    warnings: parsed.warnings,
  };
}

export async function loadTemplateConfigRows(env: Env, workspaceId = DEFAULT_WORKSPACE_ID) {
  const templatesResult = await env.DB.prepare(
    `SELECT id, workspace_id, key, title, kind, scope, category_key, deliverable_key,
            default_state_json, default_position, is_active, created_at, updated_at
     FROM templates
     WHERE workspace_id = ? AND is_active = 1`
  )
    .bind(workspaceId)
    .all<TemplateRow>();

  const rulesResult = await env.DB.prepare(
    `SELECT id, workspace_id, template_key, priority, match_json, is_active, created_at, updated_at
     FROM template_rules
     WHERE workspace_id = ? AND is_active = 1`
  )
    .bind(workspaceId)
    .all<TemplateRuleRow>();

  return {
    templates: (templatesResult.results ?? []) as TemplateRow[],
    rules: (rulesResult.results ?? []) as TemplateRuleRow[],
  };
}

async function getRuleById(
  env: Env,
  templateKey: string,
  ruleId: string,
  workspaceId = DEFAULT_WORKSPACE_ID
) {
  return env.DB.prepare(
    `SELECT id, workspace_id, template_key, priority, match_json, is_active, created_at, updated_at
     FROM template_rules
     WHERE workspace_id = ? AND template_key = ? AND id = ?`
  )
    .bind(workspaceId, templateKey, ruleId)
    .first<TemplateRuleRow>();
}

function parseRules(rows: TemplateRuleRow[]) {
  const rules: TemplateRule[] = [];
  const warnings: string[] = [];

  for (const row of rows) {
    const parsed = safeParseMatch(row.match_json);
    if (!parsed) {
      warnings.push(`invalid match_json for rule ${row.id}`);
      continue;
    }
    if (!parsed.attach_to) {
      warnings.push(`missing attach_to for rule ${row.id}`);
      continue;
    }
    rules.push({
      id: row.id,
      template_key: row.template_key,
      priority: row.priority,
      match: parsed,
      match_json: row.match_json,
    });
  }

  return { rules, warnings };
}

function safeParseMatch(matchJson: string): TemplateRuleMatch | null {
  try {
    const parsed = JSON.parse(matchJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as TemplateRuleMatch;
  } catch {
    return null;
  }
}
