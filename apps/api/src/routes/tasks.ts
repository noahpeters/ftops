import { badRequest, forbidden, json, methodNotAllowed, notFound, serverError } from "../lib/http";
import type { Env } from "../lib/types";
import { nowISO } from "../lib/utils";
import { getActorEmail } from "../lib/identity";
import { presignR2S3Url, tryCreatePresignedUrl } from "../lib/r2";
import { handleTasksKanban } from "./tasksKanban";
import { canAccessWorkspace, requireActor } from "../lib/access";

const ALLOWED_STATUSES = new Set(["scheduled", "blocked", "in progress", "done", "canceled"]);

export async function handleTasks(
  segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  url: URL
) {
  const actorResult = await requireActor(env, request);
  if (!actorResult.ok) {
    return actorResult.response;
  }
  const { actor } = actorResult;

  if (segments.length === 0) {
    return notFound("Route not found");
  }

  const [taskId, sub, action] = segments;

  if (taskId === "kanban") {
    const workspaceId = url.searchParams.get("workspaceId");
    if (!workspaceId) {
      return badRequest("missing_workspace_id");
    }
    if (!canAccessWorkspace(actor, workspaceId)) {
      return forbidden("forbidden");
    }
    return await handleTasksKanban(request, env, url, workspaceId);
  }

  if (!sub && request.method === "GET") {
    const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first();
    if (!task) {
      return notFound("Task not found");
    }
    if (!canAccessWorkspace(actor, (task as { workspace_id: string }).workspace_id)) {
      return forbidden("forbidden");
    }
    return json(task);
  }

  if (!sub && request.method === "PATCH") {
    let body: {
      status?: string;
      priority?: number;
      due_at?: string | null;
      assigned_to?: string | null;
      description?: string | null;
      template_id?: string | null;
      customer_id?: string | null;
      title?: string | null;
    } = {};
    try {
      body = (await request.json()) as {
        status?: string;
        priority?: number;
        due_at?: string | null;
        assigned_to?: string | null;
        description?: string | null;
        template_id?: string | null;
        customer_id?: string | null;
        title?: string | null;
      };
    } catch {
      body = {};
    }

    if (body.status && !ALLOWED_STATUSES.has(body.status)) {
      return badRequest("invalid_status");
    }

    const hasPriority = typeof body.priority === "number" && Number.isFinite(body.priority);
    const hasStatus = Boolean(body.status);
    const hasDueAt = Object.prototype.hasOwnProperty.call(body, "due_at");
    const hasAssignedTo = Object.prototype.hasOwnProperty.call(body, "assigned_to");
    const hasDescription = Object.prototype.hasOwnProperty.call(body, "description");
    const hasTemplateId = Object.prototype.hasOwnProperty.call(body, "template_id");
    const hasCustomerId = Object.prototype.hasOwnProperty.call(body, "customer_id");
    const hasTitle = Object.prototype.hasOwnProperty.call(body, "title");

    if (
      !hasPriority &&
      !hasStatus &&
      !hasDueAt &&
      !hasAssignedTo &&
      !hasDescription &&
      !hasTemplateId &&
      !hasCustomerId &&
      !hasTitle
    ) {
      return badRequest("missing_fields");
    }

    const existing = await env.DB.prepare("SELECT id, workspace_id, status FROM tasks WHERE id = ?")
      .bind(taskId)
      .first<{ id: string; workspace_id: string; status: string }>();
    if (!existing) {
      return notFound("Task not found");
    }
    if (!canAccessWorkspace(actor, existing.workspace_id)) {
      return forbidden("forbidden");
    }

    if (hasDueAt && body.due_at && Number.isNaN(Date.parse(body.due_at))) {
      return badRequest("invalid_due_at");
    }
    if (hasTitle && !body.title?.trim()) return badRequest("title_required");
    if (hasCustomerId && body.customer_id) {
      const customer = await env.DB.prepare(
        "SELECT id FROM customers WHERE id=? AND workspace_id=?"
      )
        .bind(body.customer_id, existing.workspace_id)
        .first();
      if (!customer) return badRequest("invalid_customer_id");
    }
    const updates: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => {
      updates.push(`${column}=?`);
      values.push(value);
    };
    if (hasStatus) add("status", body.status);
    if (hasPriority) add("priority", body.priority);
    if (hasDueAt) add("due_at", body.due_at ?? null);
    if (hasAssignedTo) add("assigned_to", body.assigned_to ?? null);
    if (hasDescription) add("description", body.description ?? null);
    if (hasTemplateId) add("template_id", body.template_id ?? null);
    if (hasCustomerId) add("customer_id", body.customer_id ?? null);
    if (hasTitle) add("title", body.title ?? null);
    if (hasStatus) add("completed_at", body.status === "done" ? nowISO() : null);
    add("updated_at", nowISO());
    values.push(taskId);
    const result = await env.DB.prepare(`UPDATE tasks SET ${updates.join(", ")} WHERE id=?`)
      .bind(...values)
      .run();

    if (!result.success) {
      return notFound("Task not found");
    }

    const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first();

    return json(task);
  }

  if (sub === "notes") {
    if (request.method === "GET") {
      const workspaceRow = await env.DB.prepare("SELECT workspace_id FROM tasks WHERE id = ?")
        .bind(taskId)
        .first<{ workspace_id: string }>();
      if (!workspaceRow) {
        return notFound("Task not found");
      }
      if (!canAccessWorkspace(actor, workspaceRow.workspace_id)) {
        return forbidden("forbidden");
      }
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
      if (!canAccessWorkspace(actor, workspaceRow.workspace_id)) {
        return forbidden("forbidden");
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

  if (sub === "files") {
    if (!action && request.method === "GET") {
      const task = await env.DB.prepare("SELECT workspace_id FROM tasks WHERE id = ?")
        .bind(taskId)
        .first<{ workspace_id: string }>();
      if (!task) {
        return notFound("Task not found");
      }
      if (!canAccessWorkspace(actor, task.workspace_id)) {
        return forbidden("forbidden");
      }
      const files = await env.DB.prepare(
        `SELECT id, workspace_id, task_id, uploaded_by_email, original_filename, content_type,
                size_bytes, storage_key, sha256, created_at
         FROM task_files
         WHERE task_id = ?
         ORDER BY created_at DESC`
      )
        .bind(taskId)
        .all();
      return json(files.results ?? []);
    }

    if (action === "init" && request.method === "POST") {
      let body: { filename?: string; contentType?: string; sizeBytes?: number } = {};
      try {
        body = (await request.json()) as {
          filename?: string;
          contentType?: string;
          sizeBytes?: number;
        };
      } catch {
        body = {};
      }

      const filename = body.filename?.trim();
      const contentType = body.contentType?.trim();
      const sizeBytes = body.sizeBytes;

      if (!filename || !contentType || typeof sizeBytes !== "number") {
        return badRequest("missing_fields");
      }

      const taskRow = await env.DB.prepare("SELECT id, workspace_id FROM tasks WHERE id = ?")
        .bind(taskId)
        .first<{ id: string; workspace_id: string }>();

      if (!taskRow) {
        return notFound("Task not found");
      }
      if (!canAccessWorkspace(actor, taskRow.workspace_id)) {
        return forbidden("forbidden");
      }
      if (!canAccessWorkspace(actor, taskRow.workspace_id)) {
        return forbidden("forbidden");
      }

      const storageKey = `tasks/${taskRow.workspace_id}/${taskId}/${crypto.randomUUID()}-${filename}`;

      const bucketName = env.R2_TASK_FILES_BUCKET_NAME;
      const accountId = env.R2_ACCOUNT_ID;
      const accessKeyId = env.R2_ACCESS_KEY_ID;
      const secretAccessKey = env.R2_SECRET_ACCESS_KEY;

      const presigned = await tryCreatePresignedUrl(env.R2_TASK_FILES_BUCKET, storageKey, {
        method: "PUT",
        expiresIn: 900,
      });
      if (presigned) {
        return json({ uploadUrl: presigned, storageKey });
      }

      const missing = [
        !bucketName ? "R2_TASK_FILES_BUCKET_NAME" : null,
        !accountId ? "R2_ACCOUNT_ID" : null,
        !accessKeyId ? "R2_ACCESS_KEY_ID" : null,
        !secretAccessKey ? "R2_SECRET_ACCESS_KEY" : null,
      ].filter(Boolean);

      if (missing.length === 0) {
        const s3Url = await presignR2S3Url({
          method: "PUT",
          key: storageKey,
          bucketName: bucketName as string,
          accountId: accountId as string,
          accessKeyId: accessKeyId as string,
          secretAccessKey: secretAccessKey as string,
          expiresIn: 900,
        });
        return json({ uploadUrl: s3Url, storageKey });
      }

      if (env.ALLOW_R2_FALLBACK_UPLOADS === "true") {
        const uploadUrl = new URL(`/tasks/${taskId}/files/upload`, "http://local");
        uploadUrl.searchParams.set("storageKey", storageKey);
        return json({ uploadUrl: `${uploadUrl.pathname}${uploadUrl.search}`, storageKey });
      }

      return serverError("Failed to sign upload URL", {
        detail: "presigned_url_unsupported",
        missing,
      });
    }

    if (action === "upload" && request.method === "PUT") {
      const taskRow = await env.DB.prepare("SELECT workspace_id FROM tasks WHERE id = ?")
        .bind(taskId)
        .first<{ workspace_id: string }>();
      if (!taskRow) {
        return notFound("Task not found");
      }
      if (!canAccessWorkspace(actor, taskRow.workspace_id)) {
        return forbidden("forbidden");
      }
      const storageKey = url.searchParams.get("storageKey");
      if (!storageKey) {
        return badRequest("missing_storage_key");
      }

      const contentType = request.headers.get("content-type") || "application/octet-stream";
      const payload = await request.arrayBuffer();

      try {
        await env.R2_TASK_FILES_BUCKET.put(storageKey, payload, {
          httpMetadata: { contentType },
        });
      } catch (error) {
        return serverError("Failed to upload file", { detail: String(error) });
      }

      return json({ ok: true });
    }

    if (action === "complete" && request.method === "POST") {
      let body: {
        storageKey?: string;
        filename?: string;
        contentType?: string;
        sizeBytes?: number;
        sha256?: string;
      } = {};
      try {
        body = (await request.json()) as {
          storageKey?: string;
          filename?: string;
          contentType?: string;
          sizeBytes?: number;
          sha256?: string;
        };
      } catch {
        body = {};
      }

      const storageKey = body.storageKey?.trim();
      const filename = body.filename?.trim();
      const contentType = body.contentType?.trim();
      const sizeBytes = body.sizeBytes;
      const sha256 = body.sha256?.trim() ?? null;

      if (!storageKey || !filename || !contentType || typeof sizeBytes !== "number") {
        return badRequest("missing_fields");
      }

      const taskRow = await env.DB.prepare("SELECT id, workspace_id FROM tasks WHERE id = ?")
        .bind(taskId)
        .first<{ id: string; workspace_id: string }>();

      if (!taskRow) {
        return notFound("Task not found");
      }

      const fileRow = {
        id: crypto.randomUUID(),
        workspace_id: taskRow.workspace_id,
        task_id: taskId,
        uploaded_by_email: getActorEmail(request),
        original_filename: filename,
        content_type: contentType,
        size_bytes: sizeBytes,
        storage_key: storageKey,
        sha256,
        created_at: nowISO(),
      };

      await env.DB.prepare(
        `INSERT INTO task_files
          (id, workspace_id, task_id, uploaded_by_email, original_filename,
           content_type, size_bytes, storage_key, sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          fileRow.id,
          fileRow.workspace_id,
          fileRow.task_id,
          fileRow.uploaded_by_email,
          fileRow.original_filename,
          fileRow.content_type,
          fileRow.size_bytes,
          fileRow.storage_key,
          fileRow.sha256,
          fileRow.created_at
        )
        .run();

      return json(fileRow, 201);
    }

    return methodNotAllowed(["GET", "POST"]);
  }

  return methodNotAllowed(["GET", "PATCH"]);
}
