import type { Env } from "../lib/types";
import { nowISO } from "../lib/utils";
import type { WebhookEnvelope } from "@ftops/webhooks";

export async function processWebhookEnvelope(msg: WebhookEnvelope, env: Env): Promise<void> {
  const now = nowISO();
  const bodyJson = safeParseJson(msg.body ?? "");
  const headersJson = JSON.stringify(msg.headers ?? {});
  const externalAccountId = msg.externalAccountId ?? msg.realmId ?? null;

  try {
    await env.DB.prepare(
      `INSERT INTO raw_events
        (id, source, workspace_id, environment, external_account_id, integration_id,
         received_at, method, path, headers_json, body_text, body_json, content_type,
         signature, signature_verified, verify_error, processed_at, process_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        msg.id,
        msg.source,
        msg.workspaceId ?? null,
        msg.environment ?? null,
        externalAccountId,
        msg.integrationId ?? null,
        msg.receivedAt ?? now,
        msg.method,
        msg.path,
        headersJson,
        msg.body ?? "",
        bodyJson.ok ? JSON.stringify(bodyJson.value) : null,
        msg.contentType ?? null,
        msg.signature ?? null,
        msg.signatureVerified ? 1 : 0,
        msg.verifyError ?? null,
        null,
        null
      )
      .run();
  } catch (error) {
    if (isDuplicateError(error)) {
      return;
    }
    throw error;
  }

  try {
    await env.DB.prepare(
      `UPDATE raw_events
       SET processed_at = ?, process_error = NULL
       WHERE id = ?`
    )
      .bind(now, msg.id)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "processor_failed";
    await env.DB.prepare(
      `UPDATE raw_events
       SET process_error = ?
       WHERE id = ?`
    )
      .bind(message, msg.id)
      .run();
    throw error;
  }
}

function safeParseJson(input: string | null) {
  if (!input) return { ok: false, value: null as unknown };
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch {
    return { ok: false, value: null as unknown };
  }
}

function isDuplicateError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.toLowerCase().includes("unique") || message.includes("constraint failed");
}
