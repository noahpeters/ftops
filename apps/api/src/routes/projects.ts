import { badRequest, json, methodNotAllowed, notFound, serverError } from "../lib/http";
import type { Env } from "../lib/types";
import { compilePlanForRecord } from "../plan/compilePlan";
import { stableStringify } from "../lib/jsonStable";
import { sha256Hex } from "../lib/hash";

export async function handleProjects(
  segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  _url: URL
) {
  if (segments.length === 0) {
    if (request.method === "GET") {
      const result = await env.DB.prepare("SELECT * FROM projects ORDER BY created_at DESC").all();

      return json(result.results);
    }

    if (request.method === "POST") {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await env.DB.prepare(
        `
        INSERT INTO projects (id, title, project_type, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      )
        .bind(id, "Test Project", "internal", "intake", now, now)
        .run();

      return json({ id }, 201);
    }

    return methodNotAllowed(["GET", "POST"]);
  }

  if (segments.length === 1 && segments[0] === "from-record" && request.method === "POST") {
    let body: { recordUri?: string; title?: string } = {};
    try {
      body = (await request.json()) as { recordUri?: string; title?: string };
    } catch {
      body = {};
    }

    const recordUri = body.recordUri?.trim();
    if (!recordUri) {
      return badRequest("missing_record_uri");
    }

    const record = await env.DB.prepare(
      `SELECT uri, customer_display
       FROM commercial_records
       WHERE uri = ?`
    )
      .bind(recordUri)
      .first<{ uri: string; customer_display: string | null }>();

    if (!record) {
      return notFound("Commercial record not found");
    }

    const workspaceId = "default";
    const existing = await env.DB.prepare(
      `SELECT * FROM projects
       WHERE workspace_id = ? AND commercial_record_uri = ?
       LIMIT 1`
    )
      .bind(workspaceId, recordUri)
      .first();

    if (existing) {
      return json({ ok: true, project: existing, created: false });
    }

    const title =
      body.title?.trim() || `${record.customer_display ?? "Customer"} — ${shorten(recordUri)}`;
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    await env.DB.prepare(
      `
        INSERT INTO projects
          (id, title, project_type, status, workspace_id, commercial_record_uri, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
      .bind(id, title, "commercial", "intake", workspaceId, recordUri, now, now)
      .run();

    const project = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();

    return json({ ok: true, project, created: true });
  }

  if (segments.length === 1 && segments[0] === "by-record" && request.method === "GET") {
    const recordUri = new URL(request.url).searchParams.get("recordUri") ?? "";
    if (!recordUri.trim()) {
      return badRequest("missing_record_uri");
    }

    const project = await env.DB.prepare(
      `SELECT * FROM projects
       WHERE workspace_id = ? AND commercial_record_uri = ?
       LIMIT 1`
    )
      .bind("default", recordUri.trim())
      .first();

    if (!project) {
      return notFound("Project not found");
    }

    return json(project);
  }

  if (segments.length === 1 && request.method === "GET") {
    const projectId = segments[0];
    const project = await env.DB.prepare("SELECT * FROM projects WHERE id = ?")
      .bind(projectId)
      .first();

    if (!project) {
      return notFound("Project not found");
    }

    return json(project);
  }

  if (segments.length === 2 && segments[1] === "tasks" && request.method === "GET") {
    const projectId = segments[0];
    const result = await env.DB.prepare(
      `SELECT * FROM tasks
       WHERE project_id = ?
       ORDER BY scope ASC, group_key ASC, position ASC`
    )
      .bind(projectId)
      .all();

    return json(result.results ?? []);
  }

  if (segments.length === 2 && segments[1] === "materialize" && request.method === "POST") {
    const projectId = segments[0];
    const project = await env.DB.prepare("SELECT * FROM projects WHERE id = ?")
      .bind(projectId)
      .first();

    if (!project) {
      return notFound("Project not found");
    }

    const recordUri = (project as { commercial_record_uri?: string | null }).commercial_record_uri;
    if (!recordUri) {
      return badRequest("project_missing_commercial_record_uri");
    }

    let body: { dryRun?: boolean } = {};
    try {
      body = (await request.json()) as { dryRun?: boolean };
    } catch {
      body = {};
    }
    const dryRun = Boolean(body?.dryRun);

    let compiled;
    try {
      compiled = await compilePlanForRecord(env, {
        workspaceId: (project as { workspace_id?: string | null }).workspace_id ?? "default",
        recordUri,
      });
    } catch {
      return badRequest("commercial_record_not_found");
    }

    const recordSnapshotHash = compiled.record.snapshot_hash;
    const templateConfigHash = compiled.templateConfigHash;
    const materializationKey = `${recordUri}::${recordSnapshotHash}::${templateConfigHash}`;

    const tasksPreview = buildTasksPreview(compiled);

    const workspaceId = (project as { workspace_id?: string | null }).workspace_id ?? "default";

    const existingMaterialization = await env.DB.prepare(
      `SELECT id FROM project_materializations
       WHERE workspace_id = ? AND materialization_key = ?`
    )
      .bind(workspaceId, materializationKey)
      .first();
    let alreadyMaterialized = Boolean(existingMaterialization);

    if (!dryRun && !alreadyMaterialized) {
      await env.DB.prepare(
        `INSERT INTO project_materializations
          (id, workspace_id, project_id, commercial_record_uri, record_snapshot_hash,
           template_config_hash, materialization_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          crypto.randomUUID(),
          workspaceId,
          projectId,
          recordUri,
          recordSnapshotHash,
          templateConfigHash,
          materializationKey,
          new Date().toISOString()
        )
        .run();
    }

    let tasksCreated = 0;
    let createdTaskIds: string[] = [];

    if (!dryRun && !alreadyMaterialized) {
      const taskRows = tasksPreview.map((task) => ({
        id: crypto.randomUUID(),
        workspace_id: workspaceId,
        project_id: projectId,
        scope: task.scope,
        group_key: task.groupKey ?? null,
        line_item_uri: task.lineItemUri ?? null,
        template_key: task.templateKey,
        template_id: task.templateKey,
        title: task.title,
        kind: task.kind,
        description: null,
        position: task.position,
        status: "scheduled",
        state_json: task.state_json ?? null,
        due_at: null,
        completed_at: null,
        assigned_to: null,
        customer_id: null,
      }));

      try {
        if (taskRows.length > 0) {
          const statements = taskRows.map((task) =>
            env.DB.prepare(
              `INSERT INTO tasks
                (id, workspace_id, project_id, scope, group_key, line_item_uri, template_key, template_id,
                 title, kind, description, position, status, state_json, due_at, completed_at, assigned_to,
                 customer_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              task.id,
              task.workspace_id,
              task.project_id,
              task.scope,
              task.group_key,
              task.line_item_uri,
              task.template_key,
              task.template_id,
              task.title,
              task.kind,
              task.description,
              task.position,
              task.status,
              task.state_json,
              task.due_at,
              task.completed_at,
              task.assigned_to,
              task.customer_id,
              new Date().toISOString(),
              new Date().toISOString()
            )
          );
          await env.DB.batch(statements);
        }

        const debugSnapshot = {
          recordUri,
          recordSnapshotHash,
          templateConfigHash,
          compiledAt: new Date().toISOString(),
          contexts: compiled.contexts,
          tasksPreview: tasksPreview.map((task) => ({
            scope: task.scope,
            groupKey: task.groupKey ?? null,
            lineItemUri: task.lineItemUri ?? null,
            templateKey: task.templateKey,
            title: task.title,
            kind: task.kind,
            position: task.position,
          })),
          matches: compiled.matches,
        };
        const debugJson = stableStringify(debugSnapshot);
        const debugHash = await sha256Hex(debugJson);

        await env.DB.prepare(
          `UPDATE projects
           SET debug_plan_json = ?, debug_plan_hash = ?, updated_at = ?
           WHERE id = ?`
        )
          .bind(debugJson, debugHash, new Date().toISOString(), projectId)
          .run();
      } catch {
        return serverError("Failed to materialize tasks");
      }

      tasksCreated = taskRows.length;
      createdTaskIds = taskRows.map((task) => task.id);
    }

    return json({
      ok: true,
      projectId,
      alreadyMaterialized,
      dryRun,
      materializationKey,
      recordSnapshotHash,
      templateConfigHash,
      tasksCreated,
      createdTaskIds,
      tasksPreview: tasksPreview.map((task) => ({
        scope: task.scope,
        groupKey: task.groupKey ?? null,
        lineItemUri: task.lineItemUri ?? null,
        templateKey: task.templateKey,
        title: task.title,
        kind: task.kind,
        position: task.position,
      })),
    });
  }

  return notFound("Route not found");
}

function shorten(value: string, max = 40) {
  if (value.length <= max) return value;
  return `${value.slice(0, 16)}…${value.slice(-12)}`;
}

type TaskPreview = {
  scope: "project" | "shared" | "deliverable";
  groupKey?: string | null;
  lineItemUri?: string | null;
  templateKey: string;
  title: string;
  kind: string;
  position: number;
  state_json?: string | null;
  rulePriority: number;
  ruleId: string;
  defaultPosition: number | null;
  lineItemPosition: number;
};

function buildTasksPreview(compiled: Awaited<ReturnType<typeof compilePlanForRecord>>) {
  const tasks: TaskPreview[] = [];
  const matched = compiled.matchedTemplatesByContext;

  const projectMatches = dedupeMatches(matched[`project::${compiled.record.uri}`] ?? []);
  tasks.push(
    ...buildTasksForContext({
      scope: "project",
      groupKey: null,
      lineItemUri: null,
      lineItemPosition: 0,
      matches: projectMatches,
    })
  );

  for (const shared of compiled.contexts.shared) {
    const matchesForShared = dedupeMatches(matched[`shared::${shared.key}`] ?? []);
    tasks.push(
      ...buildTasksForContext({
        scope: "shared",
        groupKey: shared.group_key,
        lineItemUri: null,
        lineItemPosition: 0,
        matches: matchesForShared,
      })
    );
  }

  for (const deliverable of compiled.contexts.deliverables) {
    const matchesForDeliverable = dedupeMatches(matched[`deliverable::${deliverable.key}`] ?? []);
    tasks.push(
      ...buildTasksForContext({
        scope: "deliverable",
        groupKey: deliverable.group_key ?? null,
        lineItemUri: deliverable.line_item_uri,
        lineItemPosition: deliverable.position ?? 0,
        matches: matchesForDeliverable,
      })
    );
  }

  return tasks;
}

function buildTasksForContext(args: {
  scope: "project" | "shared" | "deliverable";
  groupKey: string | null;
  lineItemUri: string | null;
  lineItemPosition: number;
  matches: Array<{
    templateKey: string;
    title: string | null;
    kind: string;
    default_position: number | null;
    default_state_json?: string | null;
    rulePriority: number;
    ruleId: string;
  }>;
}): TaskPreview[] {
  const base = args.scope === "project" ? 1000 : args.scope === "shared" ? 2000 : 3000;
  const lineItemOffset = args.lineItemPosition * 10;

  const sorted = [...args.matches].sort((a, b) => {
    const posA = a.default_position ?? 100000;
    const posB = b.default_position ?? 100000;
    if (posA !== posB) return posA - posB;
    if (a.rulePriority !== b.rulePriority) return b.rulePriority - a.rulePriority;
    const keyCompare = a.templateKey.localeCompare(b.templateKey);
    if (keyCompare !== 0) return keyCompare;
    return a.ruleId.localeCompare(b.ruleId);
  });

  return sorted.map((match, index) => {
    const defaultPos = match.default_position ?? 100000;
    const priorityOffset = Math.max(0, 1000 - match.rulePriority);
    const position = base + lineItemOffset + defaultPos + priorityOffset + index;
    return {
      scope: args.scope,
      groupKey: args.groupKey,
      lineItemUri: args.lineItemUri,
      templateKey: match.templateKey,
      title: match.title ?? match.templateKey,
      kind: match.kind ?? "task",
      position,
      rulePriority: match.rulePriority,
      ruleId: match.ruleId,
      defaultPosition: match.default_position ?? null,
      lineItemPosition: args.lineItemPosition,
      state_json: match.default_state_json ?? null,
    };
  });
}

function dedupeMatches(
  matches: Array<{
    templateKey: string;
    title: string | null;
    kind: string;
    default_position: number | null;
    default_state_json?: string | null;
    rulePriority: number;
    ruleId: string;
  }>
) {
  const seen = new Set<string>();
  return matches.filter((match) => {
    if (seen.has(match.templateKey)) {
      return false;
    }
    seen.add(match.templateKey);
    return true;
  });
}
