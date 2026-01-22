import { badRequest, forbidden, json, methodNotAllowed, notFound, serverError } from "../lib/http";
import { presignR2S3Url, tryCreatePresignedUrl } from "../lib/r2";
import type { Env } from "../lib/types";
import { canAccessWorkspace, requireActor } from "../lib/access";

type TaskFileRow = {
  id: string;
  workspace_id: string;
  task_id: string;
  uploaded_by_email?: string | null;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  storage_key: string;
  sha256?: string | null;
  created_at: string;
};

export async function handleTaskFiles(
  segments: string[],
  request: Request,
  env: Env
): Promise<Response> {
  const actorResult = await requireActor(env, request);
  if ("response" in actorResult) {
    return actorResult.response;
  }
  const { actor } = actorResult;

  if (segments.length === 0) {
    return notFound("Route not found");
  }

  const [fileId, sub] = segments;

  if (sub === "download" && request.method === "GET") {
    const file = await env.DB.prepare(
      `SELECT tf.id, tf.storage_key, tf.original_filename, tf.content_type, tf.size_bytes,
              tf.created_at, t.workspace_id
       FROM task_files tf
       JOIN tasks t ON t.id = tf.task_id
       WHERE tf.id = ?`
    )
      .bind(fileId)
      .first<TaskFileRow & { workspace_id: string }>();

    if (!file) {
      return notFound("File not found");
    }
    if (!canAccessWorkspace(actor, file.workspace_id)) {
      return forbidden("forbidden");
    }

    const bucketName = env.R2_TASK_FILES_BUCKET_NAME;
    const accountId = env.R2_ACCOUNT_ID;
    const accessKeyId = env.R2_ACCESS_KEY_ID;
    const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
    const hostOverride = env.R2_TASK_FILES_PUBLIC_HOST;

    const presigned = await tryCreatePresignedUrl(env.R2_TASK_FILES_BUCKET, file.storage_key, {
      method: "GET",
      expiresIn: 900,
    });
    if (presigned) {
      return json({ downloadUrl: presigned });
    }

    if (bucketName && accountId && accessKeyId && secretAccessKey) {
      const s3Url = await presignR2S3Url({
        method: "GET",
        key: file.storage_key,
        bucketName: bucketName as string,
        accountId: accountId as string,
        accessKeyId: accessKeyId as string,
        secretAccessKey: secretAccessKey as string,
        hostOverride,
        expiresIn: 900,
      });
      return json({ downloadUrl: s3Url });
    }

    if (env.ALLOW_R2_FALLBACK_UPLOADS === "true") {
      return json({ downloadUrl: `/task-files/${fileId}/blob` });
    }

    return serverError("Failed to sign download URL", {
      detail: "presigned_url_unsupported",
    });
  }

  if (sub === "blob" && request.method === "GET") {
    const file = await env.DB.prepare(
      `SELECT tf.id, tf.storage_key, tf.original_filename, tf.content_type, t.workspace_id
       FROM task_files tf
       JOIN tasks t ON t.id = tf.task_id
       WHERE tf.id = ?`
    )
      .bind(fileId)
      .first<TaskFileRow & { workspace_id: string }>();

    if (!file) {
      return notFound("File not found");
    }
    if (!canAccessWorkspace(actor, file.workspace_id)) {
      return forbidden("forbidden");
    }

    const object = await env.R2_TASK_FILES_BUCKET.get(file.storage_key);
    if (!object) {
      return notFound("File not found");
    }

    return new Response(object.body, {
      headers: {
        "content-type": file.content_type,
        "content-disposition": `attachment; filename="${file.original_filename}"`,
      },
    });
  }

  if (!sub && request.method === "DELETE") {
    const file = await env.DB.prepare(
      `SELECT tf.id, tf.storage_key, t.workspace_id
       FROM task_files tf
       JOIN tasks t ON t.id = tf.task_id
       WHERE tf.id = ?`
    )
      .bind(fileId)
      .first<TaskFileRow & { workspace_id: string }>();

    if (!file) {
      return notFound("File not found");
    }
    if (!canAccessWorkspace(actor, file.workspace_id)) {
      return forbidden("forbidden");
    }

    try {
      await env.R2_TASK_FILES_BUCKET.delete(file.storage_key);
    } catch (error) {
      return serverError("Failed to delete file", { detail: String(error) });
    }

    const result = await env.DB.prepare("DELETE FROM task_files WHERE id = ?").bind(fileId).run();
    if (!result.success) {
      return badRequest("failed_to_delete");
    }

    return json({ ok: true });
  }

  return methodNotAllowed(["GET", "DELETE"]);
}
