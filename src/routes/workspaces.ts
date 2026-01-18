import { badRequest, json, methodNotAllowed, notFound } from "../lib/http";
import type { Env } from "../lib/types";
import { nowISO } from "../lib/utils";

const SLUG_REGEX = /^[a-z0-9-]{3,40}$/;

export async function handleWorkspaces(
  segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  _url: URL
) {
  if (segments.length === 0) {
    if (request.method === "GET") {
      const result = await env.DB.prepare(
        "SELECT id, slug, name, created_at, updated_at FROM workspaces ORDER BY created_at ASC"
      ).all();
      return json(result.results ?? []);
    }

    if (request.method === "POST") {
      let body: { slug?: string; name?: string } = {};
      try {
        body = (await request.json()) as { slug?: string; name?: string };
      } catch {
        body = {};
      }

      const slug = body.slug?.trim();
      const name = body.name?.trim();
      if (!slug || !name) {
        return badRequest("missing_slug_or_name");
      }
      if (!SLUG_REGEX.test(slug)) {
        return badRequest("invalid_slug");
      }

      const existing = await env.DB.prepare(
        "SELECT id FROM workspaces WHERE slug = ? LIMIT 1"
      )
        .bind(slug)
        .first();
      if (existing) {
        return badRequest("workspace_slug_exists");
      }

      const id = crypto.randomUUID();
      const now = nowISO();
      await env.DB.prepare(
        `INSERT INTO workspaces (id, slug, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind(id, slug, name, now, now)
        .run();

      const workspace = await env.DB.prepare(
        "SELECT id, slug, name, created_at, updated_at FROM workspaces WHERE id = ?"
      )
        .bind(id)
        .first();
      return json(workspace, 201);
    }

    return methodNotAllowed(["GET", "POST"]);
  }

  if (segments.length === 1 && request.method === "GET") {
    const workspace = await env.DB.prepare(
      "SELECT id, slug, name, created_at, updated_at FROM workspaces WHERE id = ?"
    )
      .bind(segments[0])
      .first();
    if (!workspace) {
      return notFound("Workspace not found");
    }
    return json(workspace);
  }

  if (segments.length === 1 && request.method === "PATCH") {
    const workspaceId = segments[0];
    let body: { slug?: string; name?: string } = {};
    try {
      body = (await request.json()) as { slug?: string; name?: string };
    } catch {
      body = {};
    }

    const updates: string[] = [];
    const bindings: unknown[] = [];

    if (body.slug !== undefined) {
      const slug = body.slug.trim();
      if (!SLUG_REGEX.test(slug)) {
        return badRequest("invalid_slug");
      }
      const existing = await env.DB.prepare(
        "SELECT id FROM workspaces WHERE slug = ? AND id != ? LIMIT 1"
      )
        .bind(slug, workspaceId)
        .first();
      if (existing) {
        return badRequest("workspace_slug_exists");
      }
      updates.push("slug = ?");
      bindings.push(slug);
    }

    if (body.name !== undefined) {
      updates.push("name = ?");
      bindings.push(body.name.trim());
    }

    if (updates.length === 0) {
      return badRequest("no_updates");
    }

    updates.push("updated_at = ?");
    bindings.push(nowISO());
    bindings.push(workspaceId);

    await env.DB.prepare(
      `UPDATE workspaces SET ${updates.join(", ")} WHERE id = ?`
    )
      .bind(...bindings)
      .run();

    const workspace = await env.DB.prepare(
      "SELECT id, slug, name, created_at, updated_at FROM workspaces WHERE id = ?"
    )
      .bind(workspaceId)
      .first();

    if (!workspace) {
      return notFound("Workspace not found");
    }

    return json(workspace);
  }

  if (segments.length === 1 && request.method === "DELETE") {
    const workspaceId = segments[0];
    const workspace = await env.DB.prepare(
      "SELECT id, slug FROM workspaces WHERE id = ?"
    )
      .bind(workspaceId)
      .first<{ id: string; slug: string | null }>();
    if (!workspace) {
      return notFound("Workspace not found");
    }

    if (workspace.slug === "default" || workspace.id === "ws_default" || workspace.id === "default") {
      return badRequest("cannot_delete_default_workspace");
    }

    const counts = await getWorkspaceDependencyCounts(env, workspaceId);
    const hasDeps = Object.values(counts).some((count) => count > 0);
    if (hasDeps) {
      return json(
        { ok: false, error: "workspace_not_empty", counts },
        409
      );
    }

    await env.DB.prepare("DELETE FROM workspaces WHERE id = ?")
      .bind(workspaceId)
      .run();

    return json({ ok: true });
  }

  return notFound("Route not found");
}

async function getWorkspaceDependencyCounts(env: Env, workspaceId: string) {
  const tables = [
    { table: "integrations", key: "integrations" },
    { table: "projects", key: "projects" },
    { table: "tasks", key: "tasks" },
    { table: "commercial_records", key: "commercial_records" },
    { table: "ingest_requests", key: "ingest_requests" },
  ] as const;

  const counts: Record<string, number> = {};
  for (const entry of tables) {
    counts[entry.key] = await safeCount(env, entry.table, workspaceId);
  }
  return counts;
}

async function safeCount(env: Env, table: string, workspaceId: string) {
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM ${table} WHERE workspace_id = ?`
    )
      .bind(workspaceId)
      .first<{ count: number }>();
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}
