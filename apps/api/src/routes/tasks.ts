import { badRequest, json, methodNotAllowed, notFound } from "../lib/http";
import type { Env } from "../lib/types";
import { nowISO } from "../lib/utils";
import { getActorEmail } from "../lib/identity";

const ALLOWED_STATUSES = new Set(["todo", "doing", "blocked", "done", "canceled"]);

export async function handleTasks(
  segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  _url: URL
) {
  if (segments.length === 0) {
    return notFound("Route not found");
  }

  const [taskId, sub] = segments;

  if (!sub && request.method === "PATCH") {
    let body: { status?: string } = {};
    try {
      body = (await request.json()) as { status?: string };
    } catch {
      body = {};
    }

    if (body.status && !ALLOWED_STATUSES.has(body.status)) {
      return badRequest("invalid_status");
    }

    if (!body.status) {
      return badRequest("missing_status");
    }

    const existing = await env.DB.prepare("SELECT id FROM tasks WHERE id = ?").bind(taskId).first();
    if (!existing) {
      return notFound("Task not found");
    }

    const result = await env.DB.prepare(
      `UPDATE tasks
       SET status = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(body.status, nowISO(), taskId)
      .run();

    if (!result.success) {
      return notFound("Task not found");
    }

    const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first();

    return json(task);
  }

  if (sub === "notes") {
    if (request.method === "GET") {
      const notes = await env.DB.prepare(
        `SELECT id, workspace_id, task_id, author_email, created_at, body
         FROM task_notes
         WHERE task_id = ?
         ORDER BY created_at ASC`
      )
        .bind(taskId)
        .all();
      return json(notes.results ?? []);
    }

    if (request.method === "POST") {
      let body: { body?: string } = {};
      try {
        body = (await request.json()) as { body?: string };
      } catch {
        body = {};
      }

      const noteBody = body.body?.trim();
      if (!noteBody) {
        return badRequest("missing_body");
      }

      const workspaceRow = await env.DB.prepare("SELECT workspace_id FROM tasks WHERE id = ?")
        .bind(taskId)
        .first<{ workspace_id: string }>();

      if (!workspaceRow) {
        return notFound("Task not found");
      }

      const note = {
        id: crypto.randomUUID(),
        workspace_id: workspaceRow.workspace_id,
        task_id: taskId,
        author_email: getActorEmail(request),
        created_at: nowISO(),
        body: noteBody,
      };

      await env.DB.prepare(
        `INSERT INTO task_notes
          (id, workspace_id, task_id, author_email, created_at, body)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(
          note.id,
          note.workspace_id,
          note.task_id,
          note.author_email,
          note.created_at,
          note.body
        )
        .run();

      return json(note, 201);
    }

    return methodNotAllowed(["GET", "POST"]);
  }

  return methodNotAllowed(["PATCH"]);
}
