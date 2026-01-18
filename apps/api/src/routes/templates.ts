import { badRequest, json, methodNotAllowed, notFound } from "../lib/http";
import type { Env } from "../lib/types";
import {
  createRule,
  createTemplate,
  deleteRule,
  deleteTemplate,
  getTemplateDetailByKey,
  listTemplates,
  updateRule,
  updateTemplate,
} from "../config/templatesRepo";
import { parseJsonInput, stableStringify } from "../lib/jsonStable";

const TEMPLATE_KEY_RE = /^[a-z0-9]+(\.[a-z0-9_]+)+$/;
const VALID_SCOPES = new Set(["project", "shared", "deliverable"] as const);
const VALID_ATTACH_TO = new Set(["project", "shared", "deliverable"] as const);
const VALID_TEMPLATE_KINDS = new Set(["task", "checklist", "milestone"] as const);

type TemplateBody = {
  key?: string;
  title?: string;
  kind?: "task" | "checklist" | "milestone";
  scope?: "project" | "shared" | "deliverable";
  category_key?: string | null;
  deliverable_key?: string | null;
  default_state_json?: unknown;
  default_position?: number | null;
  is_active?: boolean | number;
};

type RuleBody = {
  priority?: number;
  match_json?: unknown;
  is_active?: boolean | number;
};

export async function handleTemplates(
  segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  _url: URL
) {
  if (segments.length === 0) {
    if (request.method === "GET") {
      const templates = await listTemplates(env);
      return json(
        templates.map((template) => ({
          key: template.key,
          title: template.title,
          kind: template.kind,
          scope: template.scope,
          is_active: template.is_active,
          category_key: template.category_key,
          deliverable_key: template.deliverable_key,
          default_state_json: template.default_state_json,
          default_position: template.default_position,
        }))
      );
    }

    if (request.method === "POST") {
      const body = await readJsonBody<TemplateBody>(request);
      if (!body) {
        return badRequest("invalid_json");
      }

      const key = body.key?.trim();
      const title = body.title?.trim();
      const kind = body.kind ?? "task";
      const scope = body.scope;
      const categoryKey = normalizeNullable(body.category_key);
      const deliverableKey = normalizeNullable(body.deliverable_key);
      const defaultStateJson = parseOptionalJson(body.default_state_json);
      if (defaultStateJson.error) {
        return badRequest("invalid_template", { details: "default_state_json_invalid" });
      }
      const defaultPosition = normalizeOptionalInt(body.default_position);
      const isActive = normalizeIsActive(body.is_active, true) ?? 1;

      const validationError = validateTemplateInput({
        key,
        title,
        kind,
        scope,
        category_key: categoryKey,
        deliverable_key: deliverableKey,
      });
      if (validationError) {
        return badRequest("invalid_template", { details: validationError });
      }
      if (defaultPosition.error) {
        return badRequest("invalid_template", { details: "default_position_invalid" });
      }

      const existing = await getTemplateDetailByKey(env, key!);
      if (existing) {
        return json({ error: "template_key_exists" }, 409);
      }

      const detail = await createTemplate(env, {
        key: key!,
        title: title!,
        kind,
        scope: scope!,
        category_key: categoryKey,
        deliverable_key: deliverableKey,
        default_state_json: defaultStateJson.value ?? null,
        default_position: defaultPosition.value ?? null,
        is_active: isActive,
      });

      return json(detail, 201);
    }

    return methodNotAllowed(["GET", "POST"]);
  }

  if (segments.length >= 1) {
    const [templateKey, next, subId] = segments;

    if (segments.length === 1) {
      if (request.method === "GET") {
        const detail = await getTemplateDetailByKey(env, templateKey);
        if (!detail) {
          return notFound("Template not found");
        }

        return json({
          template: detail.template,
          rules: detail.rules.map((rule) => ({
            id: rule.id,
            template_key: rule.template_key,
            priority: rule.priority,
            match: rule.match,
            match_json: rule.match_json,
          })),
        });
      }

      if (request.method === "PATCH") {
        const body = await readJsonBody<TemplateBody>(request);
        if (!body) {
          return badRequest("invalid_json");
        }

        const defaultStateJson = parseOptionalJson(body.default_state_json);
        if (defaultStateJson.error) {
          return badRequest("invalid_template", { details: "default_state_json_invalid" });
        }
        const defaultPosition = normalizeOptionalInt(body.default_position);
        const patch = {
          title: body.title?.trim(),
          kind: body.kind,
          scope: body.scope,
          category_key:
            body.category_key !== undefined ? normalizeNullable(body.category_key) : undefined,
          deliverable_key:
            body.deliverable_key !== undefined
              ? normalizeNullable(body.deliverable_key)
              : undefined,
          default_state_json:
            defaultStateJson.value === undefined ? undefined : defaultStateJson.value,
          default_position: defaultPosition.value === undefined ? undefined : defaultPosition.value,
          is_active: normalizeIsActive(body.is_active, undefined),
        };

        const existing = await getTemplateDetailByKey(env, templateKey);
        if (!existing) {
          return notFound("Template not found");
        }

        const validationError = validateTemplateInput({
          key: templateKey,
          title: patch.title ?? existing.template.title,
          kind: patch.kind ?? existing.template.kind,
          scope: patch.scope ?? existing.template.scope,
          category_key:
            patch.category_key !== undefined ? patch.category_key : existing.template.category_key,
          deliverable_key:
            patch.deliverable_key !== undefined
              ? patch.deliverable_key
              : existing.template.deliverable_key,
        });
        if (validationError) {
          return badRequest("invalid_template", { details: validationError });
        }
        if (defaultPosition.error) {
          return badRequest("invalid_template", { details: "default_position_invalid" });
        }

        const detail = await updateTemplate(env, templateKey, patch);
        if (!detail) {
          return notFound("Template not found");
        }

        return json(detail);
      }

      if (request.method === "DELETE") {
        const deleted = await deleteTemplate(env, templateKey);
        if (!deleted) {
          return notFound("Template not found");
        }
        return json({ deleted: true });
      }

      return methodNotAllowed(["GET", "PATCH", "DELETE"]);
    }

    if (next === "rules") {
      if (segments.length === 2) {
        if (request.method !== "POST") {
          return methodNotAllowed(["POST"]);
        }

        const body = await readJsonBody<RuleBody>(request);
        if (!body) {
          return badRequest("invalid_json");
        }

        const priority = body.priority;
        const isActive = normalizeIsActive(body.is_active, true) ?? 1;
        if (typeof priority !== "number") {
          return badRequest("invalid_rule", { details: "priority_required" });
        }

        const matchParse = parseMatchJson(body.match_json);
        if (!matchParse.ok) {
          return badRequest("invalid_rule", { details: matchParse.error });
        }

        const template = await getTemplateDetailByKey(env, templateKey);
        if (!template) {
          return notFound("Template not found");
        }

        const rule = await createRule(env, templateKey, {
          priority,
          match_json: matchParse.matchJson,
          is_active: isActive,
        });

        return json(rule, 201);
      }

      if (segments.length === 3) {
        const ruleId = subId as string;

        if (request.method === "PATCH") {
          const body = await readJsonBody<RuleBody>(request);
          if (!body) {
            return badRequest("invalid_json");
          }

          let matchJson: string | undefined;
          if (body.match_json !== undefined) {
            const matchParse = parseMatchJson(body.match_json);
            if (!matchParse.ok) {
              return badRequest("invalid_rule", { details: matchParse.error });
            }
            matchJson = matchParse.matchJson;
          }

          const patch = {
            priority: body.priority,
            match_json: matchJson,
            is_active: normalizeIsActive(body.is_active, undefined),
          };

          const updated = await updateRule(env, templateKey, ruleId, patch);
          if (!updated) {
            return notFound("Rule not found");
          }

          return json(updated);
        }

        if (request.method === "DELETE") {
          const deleted = await deleteRule(env, templateKey, ruleId);
          if (!deleted) {
            return notFound("Rule not found");
          }
          return json({ deleted: true });
        }

        return methodNotAllowed(["PATCH", "DELETE"]);
      }

      return notFound("Route not found");
    }

    if (next === "steps") {
      return json({ error: "steps_deprecated" }, 410);
    }

    return notFound("Route not found");
  }

  return notFound("Route not found");
}

async function readJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function normalizeIsActive(value: boolean | number | undefined, fallback?: boolean) {
  if (value === undefined) {
    return fallback === undefined ? undefined : fallback ? 1 : 0;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return value ? 1 : 0;
}

function normalizeNullable(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseOptionalJson(value: unknown): {
  value: string | null | undefined;
  error: boolean;
} {
  if (value === undefined) {
    return { value: undefined, error: false };
  }
  if (value === null) {
    return { value: null, error: false };
  }
  try {
    const parsed = parseJsonInput(value);
    if (parsed === null || parsed === undefined) {
      return { value: null, error: false };
    }
    return { value: stableStringify(parsed), error: false };
  } catch {
    return { value: undefined, error: true };
  }
}

function normalizeOptionalInt(value: number | null | undefined): {
  value: number | null | undefined;
  error: boolean;
} {
  if (value === undefined) return { value: undefined, error: false };
  if (value === null) return { value: null, error: false };
  if (Number.isInteger(value)) return { value, error: false };
  return { value: undefined, error: true };
}

function validateTemplateInput(input: {
  key?: string;
  title?: string;
  kind?: string;
  scope?: string;
  category_key?: string | null;
  deliverable_key?: string | null;
}) {
  if (!input.key || !TEMPLATE_KEY_RE.test(input.key)) {
    return "invalid_key";
  }
  if (!input.title) {
    return "title_required";
  }
  if (!input.kind || !VALID_TEMPLATE_KINDS.has(input.kind as never)) {
    return "invalid_kind";
  }
  if (!input.scope || !VALID_SCOPES.has(input.scope as never)) {
    return "invalid_scope";
  }
  if (input.scope === "deliverable") {
    if (!input.category_key || !input.deliverable_key) {
      return "deliverable_requires_category_and_key";
    }
  }
  return null;
}

function parseMatchJson(
  value: unknown
): { ok: true; matchJson: string } | { ok: false; error: string } {
  try {
    const parsed = parseJsonInput(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "match_json_invalid" };
    }

    const attachTo = (parsed as { attach_to?: string }).attach_to;
    if (!attachTo || !VALID_ATTACH_TO.has(attachTo as never)) {
      return { ok: false, error: "attach_to_required" };
    }

    return { ok: true, matchJson: stableStringify(parsed) };
  } catch {
    return { ok: false, error: "match_json_invalid" };
  }
}
