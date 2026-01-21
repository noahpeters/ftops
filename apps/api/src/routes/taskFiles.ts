import { badRequest, json, methodNotAllowed, notFound, serverError } from "../lib/http";
import { presignR2S3Url, tryCreatePresignedUrl } from "../lib/r2";
import type { Env } from "../lib/types";

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
  if (segments.length === 0) {
    return notFound("Route not found");
  }

  const [fileId, sub] = segments;

  if (sub === "download" && request.method === "GET") {
    const file = await env.DB.prepare(
      `SELECT id, storage_key, original_filename, content_type, size_bytes, created_at
       FROM task_files
       WHERE id = ?`
    )
      .bind(fileId)
      .first<TaskFileRow>();

    if (!file) {
      return notFound("File not found");
    }

    const bucketName = env.R2_TASK_FILES_BUCKET_NAME;
    const accountId = env.R2_ACCOUNT_ID;
    const accessKeyId = env.R2_ACCESS_KEY_ID;
    const secretAccessKey = env.R2_SECRET_ACCESS_KEY;

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
        bucketName,
        accountId,
        accessKeyId,
        secretAccessKey,
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
      `SELECT id, storage_key, original_filename, content_type
       FROM task_files
       WHERE id = ?`
    )
      .bind(fileId)
      .first<TaskFileRow>();

    if (!file) {
      return notFound("File not found");
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
      `SELECT id, storage_key
       FROM task_files
       WHERE id = ?`
    )
      .bind(fileId)
      .first<TaskFileRow>();

    if (!file) {
      return notFound("File not found");
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
