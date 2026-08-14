import { canAccessWorkspace, requireActor } from "../lib/access";
import { badRequest, forbidden, json, methodNotAllowed, notFound, serverError } from "../lib/http";
import { presignR2S3Url, tryCreatePresignedUrl } from "../lib/r2";
import type { Env } from "../lib/types";
import { nowISO } from "../lib/utils";

type CustomerFileRow = {
  id: string;
  workspace_id: string;
  customer_id: string;
  activity_id: string;
  storage_key: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  deprecated_at: string | null;
};

export async function handleCustomerFiles(
  segments: string[],
  request: Request,
  env: Env
): Promise<Response> {
  const auth = await requireActor(env, request);
  if (!auth.ok) return auth.response;
  const [fileId, action] = segments;
  if (!fileId) return notFound("Route not found");

  const file = await env.DB.prepare(`SELECT * FROM customer_note_files WHERE id=?`)
    .bind(fileId)
    .first<CustomerFileRow>();
  if (!file) return notFound("File not found");
  if (!canAccessWorkspace(auth.actor, file.workspace_id)) return forbidden("forbidden");

  if (action === "download" && request.method === "GET") {
    const signed = await signedUrl(env, file.storage_key, "GET");
    if (signed) return json({ downloadUrl: signed });
    if (env.ALLOW_R2_FALLBACK_UPLOADS === "true") {
      return json({ downloadUrl: `/customer-files/${fileId}/blob` });
    }
    return serverError("Failed to sign download URL", { detail: "presigned_url_unsupported" });
  }

  if (action === "blob" && request.method === "GET") {
    const object = await env.R2_TASK_FILES_BUCKET.get(file.storage_key);
    if (!object) return notFound("File not found");
    return new Response(object.body, {
      headers: {
        "content-type": file.content_type,
        "content-disposition": `attachment; filename="${safeDispositionName(file.original_filename)}"`,
        "cache-control": "private, no-store",
      },
    });
  }

  if (!action && request.method === "PATCH") {
    const body = await readBody(request);
    if (typeof body.deprecated !== "boolean") return badRequest("deprecated_required");
    const deprecatedAt = body.deprecated ? nowISO() : null;
    const deprecatedBy = body.deprecated ? auth.actor.email : null;
    await env.DB.prepare(
      `UPDATE customer_note_files SET deprecated_at=?,deprecated_by_email=? WHERE id=?`
    )
      .bind(deprecatedAt, deprecatedBy, fileId)
      .run();
    return json(
      await env.DB.prepare(`SELECT * FROM customer_note_files WHERE id=?`).bind(fileId).first()
    );
  }

  return methodNotAllowed(["GET", "PATCH"]);
}

export async function signedUrl(
  env: Env,
  storageKey: string,
  method: "GET" | "PUT"
): Promise<string | null> {
  const native = await tryCreatePresignedUrl(env.R2_TASK_FILES_BUCKET, storageKey, {
    method,
    expiresIn: 900,
  });
  if (native) return native;
  if (
    !env.R2_TASK_FILES_BUCKET_NAME ||
    !env.R2_ACCOUNT_ID ||
    !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY
  ) {
    return null;
  }
  return await presignR2S3Url({
    method,
    key: storageKey,
    bucketName: env.R2_TASK_FILES_BUCKET_NAME,
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    expiresIn: 900,
  });
}

function safeDispositionName(value: string) {
  return value.replace(/["\\\r\n]/g, "_");
}

async function readBody(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}
