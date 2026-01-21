import { badRequest, json, methodNotAllowed, notFound, serverError } from "../lib/http";
import type { Env } from "../lib/types";
import { nowISO } from "../lib/utils";
import { getActorEmail } from "../lib/identity";
import { presignR2S3Url, tryCreatePresignedUrl } from "../lib/r2";
import { handleTasksKanban } from "./tasksKanban";

const ALLOWED_STATUSES = new Set([
  "todo",
  "doing",
  "blocked",
  "done",
  "canceled",
  "overdue",
  "due_this_week",
]);

export async function handleTasks(
  segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  url: URL
) {
  if (segments.length === 0) {
    return notFound("Route not found");
  }

  const [taskId, sub, action] = segments;

  if (taskId === "kanban") {
    return await handleTasksKanban(request, env, url);
  }

  if (!sub && request.method === "PATCH") {
    let body: { status?: string; priority?: number } = {};
    try {
      body = (await request.json()) as { status?: string; priority?: number };
    } catch {
      body = {};
    }

    if (body.status && !ALLOWED_STATUSES.has(body.status)) {
      return badRequest("invalid_status");
    }

    const hasPriority = typeof body.priority === "number" && Number.isFinite(body.priority);
    const hasStatus = Boolean(body.status);

    if (!hasPriority && !hasStatus) {
      return badRequest("missing_fields");
    }

    const existing = await env.DB.prepare("SELECT id FROM tasks WHERE id = ?").bind(taskId).first();
    if (!existing) {
      return notFound("Task not found");
    }

    const nextStatus = body.status ?? null;
    const nextPriority = hasPriority ? body.priority : null;

    const result = await env.DB.prepare(
      `UPDATE tasks
       SET status = COALESCE(?, status),
           priority = COALESCE(?, priority),
           updated_at = ?
       WHERE id = ?`
    )
      .bind(nextStatus, nextPriority, nowISO(), taskId)
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

  if (sub === "files") {
    if (!action && request.method === "GET") {
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

  return methodNotAllowed(["PATCH"]);
}
