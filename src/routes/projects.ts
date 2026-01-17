import { json, methodNotAllowed, notFound } from "../lib/http";
import type { Env } from "../lib/types";

export async function handleProjects(
  segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  _url: URL
) {
  if (segments.length > 0) {
    return notFound("Route not found");
  }

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
