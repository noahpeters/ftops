import { canAdminWorkspace, type Actor } from "../lib/access";
import { badRequest, forbidden, json, methodNotAllowed, notFound } from "../lib/http";
import { decryptSecrets, encryptSecrets } from "../lib/crypto/secrets";
import type { Env, EventQueuePayload } from "../lib/types";
import { nowISO } from "../lib/utils";
import { isTrustedMutationOrigin, safeRedirect, sanitizeExternalError } from "../lib/security";
import {
  authorizationRedirect,
  consumeOAuthState,
  createOAuthState,
  exchangeAuthorizationCode,
  saveOAuthIntegration,
  type QboSecrets,
} from "../services/quickbooksOAuth";

const UI_STATUS_URL = "https://ops.from-trees.com/integrations";
const ALLOWED_UI_REDIRECTS = new Set([UI_STATUS_URL]);

export async function handleQboIntegration(
  segments: string[],
  request: Request,
  env: Env,
  url: URL,
  actor: Actor
) {
  const action = segments[0];
  const expectedMethod =
    action === "connect" || action === "callback" || action === "status"
      ? "GET"
      : action === "disconnect" || action === "bootstrap"
        ? "POST"
        : null;
  if (!expectedMethod) return notFound("Route not found");
  if (request.method !== expectedMethod) return methodNotAllowed([expectedMethod]);
  if (expectedMethod === "POST" && !isTrustedMutationOrigin(request))
    return forbidden("csrf_origin_invalid");
  if (action === "connect") {
    const workspaceId = url.searchParams.get("workspaceId")?.trim();
    const environment = url.searchParams.get("environment")?.trim() || "production";
    if (!workspaceId) return badRequest("missing_workspace_id");
    if (!canAdminWorkspace(actor, workspaceId)) return forbidden("forbidden");
    if (environment !== "sandbox" && environment !== "production")
      return badRequest("invalid_environment");
    try {
      const state = await createOAuthState(env, {
        workspaceId,
        requestedBy: actor.email,
        environment,
      });
      return authorizationRedirect(env, state);
    } catch (error) {
      return json({ error: sanitize(error) }, 503);
    }
  }
  if (action === "callback") {
    const clean = new URL(UI_STATUS_URL);
    const state = url.searchParams.get("state") || "";
    try {
      const stateRow = await consumeOAuthState(env, state);
      if (stateRow.requested_by !== actor.email) throw new Error("oauth_state_user_mismatch");
      const oauthError = url.searchParams.get("error");
      if (oauthError) throw new Error("quickbooks_authorization_denied");
      const code = url.searchParams.get("code") || "";
      const realmId = url.searchParams.get("realmId") || "";
      if (!code || !realmId) throw new Error("quickbooks_callback_missing_fields");
      const tokens = await exchangeAuthorizationCode(env, code);
      await saveOAuthIntegration(env, {
        workspaceId: stateRow.workspace_id,
        environment: stateRow.environment,
        realmId,
        tokens,
      });
      clean.searchParams.set("qbo", "connected");
    } catch (error) {
      clean.searchParams.set("qbo", "error");
      clean.searchParams.set("reason", sanitize(error));
    }
    return safeRedirect(clean.toString(), ALLOWED_UI_REDIRECTS);
  }
  const workspaceId = (
    request.method === "GET"
      ? url.searchParams.get("workspaceId")
      : string((await readBodyClone(request)).workspaceId)
  )?.trim();
  if (!workspaceId) return badRequest("missing_workspace_id");
  if (!canAdminWorkspace(actor, workspaceId)) return forbidden("forbidden");
  if (action === "status") return json(await connectionStatus(env, workspaceId));
  if (action === "disconnect") {
    const body = await readBody(request);
    const integration = await ownedIntegration(env, workspaceId, string(body.integrationId));
    if (!integration) return notFound("QuickBooks integration not found");
    let secrets = JSON.parse(
      await decryptSecrets(env, integration.secrets_key_id, integration.secrets_ciphertext)
    ) as QboSecrets;
    secrets = {
      webhookVerifierToken: secrets.webhookVerifierToken,
      apiBaseUrl: secrets.apiBaseUrl,
      minorVersion: secrets.minorVersion,
      realmId: secrets.realmId,
    };
    const encrypted = await encryptSecrets(env, JSON.stringify(secrets));
    await env.DB.prepare(
      `UPDATE integrations SET secrets_key_id=?,secrets_ciphertext=?,is_active=0,connection_status='disconnected',connection_error=NULL,token_version=token_version+1,updated_at=? WHERE id=?`
    )
      .bind(encrypted.keyId, encrypted.ciphertext, nowISO(), integration.id)
      .run();
    return json({ disconnected: true });
  }
  if (action === "bootstrap") {
    const body = await readBody(request);
    const integration = await ownedIntegration(env, workspaceId, string(body.integrationId));
    if (!integration || !integration.is_active)
      return notFound("Active QuickBooks integration not found");
    const now = nowISO();
    const existing = await env.DB.prepare(
      `SELECT id,status,entity_type,start_position,imported_count FROM qbo_bootstrap_jobs WHERE integration_id=?`
    )
      .bind(integration.id)
      .first<{
        id: string;
        status: string;
        entity_type: string;
        start_position: number;
        imported_count: number;
      }>();
    const id = existing?.id || crypto.randomUUID();
    const entityType = existing?.status === "failed" ? existing.entity_type : "customer";
    const position = existing?.status === "failed" ? existing.start_position : 1;
    const count = existing?.status === "failed" ? existing.imported_count : 0;
    await env.DB.prepare(
      `INSERT INTO qbo_bootstrap_jobs (id,workspace_id,integration_id,entity_type,start_position,imported_count,status,started_at,updated_at) VALUES (?,?,?,?,?,?,'queued',?,?) ON CONFLICT(integration_id) DO UPDATE SET entity_type=excluded.entity_type,start_position=excluded.start_position,imported_count=excluded.imported_count,status='queued',completed_at=NULL,last_error=NULL,updated_at=excluded.updated_at`
    )
      .bind(id, workspaceId, integration.id, entityType, position, count, now, now)
      .run();
    await env.EVENT_QUEUE.send(bootstrapMessage(id));
    return json({ jobId: id, status: "queued" }, 202);
  }
  return methodNotAllowed(action === "status" ? ["GET"] : ["POST"]);
}

export function bootstrapMessage(jobId: string): EventQueuePayload {
  return {
    source: "quickbooks",
    type: "quickbooks.bootstrap",
    externalId: jobId,
    idempotencyKey: `qbo-bootstrap:${jobId}:${crypto.randomUUID()}`,
    payload: { jobId },
    receivedAt: nowISO(),
  };
}
async function connectionStatus(env: Env, workspaceId: string) {
  const rows = await env.DB.prepare(
    `SELECT i.id,i.environment,i.external_account_id,i.is_active,i.connection_status,i.connection_error,i.last_successful_sync_at,i.secrets_key_id,i.secrets_ciphertext,j.entity_type,j.start_position,j.imported_count,j.status bootstrap_status,j.started_at,j.completed_at,j.last_error bootstrap_error FROM integrations i LEFT JOIN qbo_bootstrap_jobs j ON j.integration_id=i.id WHERE i.workspace_id=? AND i.provider='qbo' ORDER BY i.updated_at DESC`
  )
    .bind(workspaceId)
    .all<Record<string, unknown>>();
  const output = [];
  for (const row of rows.results ?? []) {
    let tokenHealth = "missing";
    try {
      const secret = JSON.parse(
        await decryptSecrets(env, String(row.secrets_key_id), String(row.secrets_ciphertext))
      ) as QboSecrets;
      tokenHealth = secret.refreshToken
        ? secret.refreshTokenExpiresAt && Date.parse(secret.refreshTokenExpiresAt) <= Date.now()
          ? "expired"
          : "healthy"
        : "reconnect_required";
    } catch {
      tokenHealth = "unreadable";
    }
    const safe = { ...row };
    delete safe.secrets_key_id;
    delete safe.secrets_ciphertext;
    output.push({ ...safe, token_health: tokenHealth });
  }
  return output;
}
async function ownedIntegration(env: Env, workspaceId: string, id: string) {
  if (!id) return null;
  return await env.DB.prepare(
    `SELECT id,workspace_id,is_active,secrets_key_id,secrets_ciphertext FROM integrations WHERE id=? AND workspace_id=? AND provider='qbo'`
  )
    .bind(id, workspaceId)
    .first<{
      id: string;
      workspace_id: string;
      is_active: number;
      secrets_key_id: string;
      secrets_ciphertext: string;
    }>();
}
async function readBody(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}
async function readBodyClone(request: Request) {
  try {
    return (await request.clone().json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}
function string(value: unknown) {
  return typeof value === "string" ? value : "";
}
function sanitize(error: unknown) {
  return sanitizeExternalError(error, "quickbooks_oauth_failed");
}
