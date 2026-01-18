import { json, methodNotAllowed, notFound } from "../lib/http";
import type { Env } from "../lib/types";

export async function handleProjects(
  segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  _url: URL
) {
  if (segments.length === 0) {
    if (request.method === "GET") {
      const result = await env.DB.prepare(
        "SELECT * FROM projects ORDER BY created_at DESC"
      ).all();

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

  return notFound("Route not found");
}
