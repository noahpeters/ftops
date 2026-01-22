import { badRequest, forbidden, json, methodNotAllowed, notFound, serverError } from "../lib/http";
import type { Env } from "../lib/types";
import { encryptSecrets } from "../lib/crypto/secrets";
import { nowISO } from "../lib/utils";
import { canAdminWorkspace, requireActor } from "../lib/access";

const PROVIDERS = ["shopify", "qbo"] as const;
const ENVIRONMENTS = ["sandbox", "production"] as const;

export async function handleIntegrations(
  segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  url: URL
) {
  const actorResult = await requireActor(env, request);
  if ("response" in actorResult) {
    return actorResult.response;
  }
  const { actor } = actorResult;

  if (segments.length === 0) {
    if (request.method === "GET") {
      const workspaceId = url.searchParams.get("workspaceId");
      if (workspaceId && !canAdminWorkspace(actor, workspaceId)) {
        return forbidden("forbidden");
      }
      if (!workspaceId && !actor.isSystemAdmin) {
        return forbidden("forbidden");
      }
      const filters: string[] = [];
      const bindings: string[] = [];
      if (workspaceId) {
        filters.push("workspace_id = ?");
        bindings.push(workspaceId);
      }
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const result = await env.DB.prepare(
        `SELECT id, workspace_id, provider, environment, external_account_id,
                display_name, secrets_key_id, is_active, created_at, updated_at
         FROM integrations
         ${where}
         ORDER BY created_at DESC`
      )
        .bind(...bindings)
        .all();
      return json(result.results ?? []);
    }

    if (request.method === "POST") {
      let body: {
        workspaceId?: string;
        provider?: string;
        environment?: string;
        externalAccountId?: string;
        displayName?: string;
        secrets?: Record<string, unknown>;
      } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        body = {};
      }

      const workspaceId = body.workspaceId?.trim();
      const provider = body.provider?.trim();
      const environment = body.environment?.trim();
      const externalAccountId = body.externalAccountId?.trim();
      if (!workspaceId || !provider || !environment || !externalAccountId) {
        return badRequest("missing_required_fields");
      }
      if (!canAdminWorkspace(actor, workspaceId)) {
        return forbidden("forbidden");
      }
      if (!PROVIDERS.includes(provider as (typeof PROVIDERS)[number])) {
        return badRequest("invalid_provider");
      }
      if (!ENVIRONMENTS.includes(environment as (typeof ENVIRONMENTS)[number])) {
        return badRequest("invalid_environment");
      }

      const secrets = body.secrets ?? {};
      const secretsValid = validateSecrets(provider, secrets);
      if (!secretsValid.ok) {
        return badRequest(secretsValid.error);
      }

      let encrypted;
      try {
        encrypted = await encryptSecrets(env, JSON.stringify(secrets));
      } catch (error) {
        const message = error instanceof Error ? error.message : "secrets_encrypt_failed";
        return serverError(message);
      }
      const now = nowISO();
      const id = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO integrations
          (id, workspace_id, provider, environment, external_account_id, display_name,
           secrets_key_id, secrets_ciphertext, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          id,
          workspaceId,
          provider,
          environment,
          externalAccountId,
          body.displayName ?? null,
          encrypted.keyId,
          encrypted.ciphertext,
          1,
          now,
          now
        )
        .run();

      const integration = await env.DB.prepare(
        `SELECT id, workspace_id, provider, environment, external_account_id,
                display_name, secrets_key_id, is_active, created_at, updated_at
         FROM integrations WHERE id = ?`
      )
        .bind(id)
        .first();

      return json(integration, 201);
    }

    return methodNotAllowed(["GET", "POST"]);
  }

  if (segments.length === 1) {
    const integrationId = segments[0];

    if (request.method === "PATCH") {
      let body: {
        displayName?: string | null;
        is_active?: number;
        secrets?: Record<string, unknown>;
      } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        body = {};
      }

      const existing = await env.DB.prepare(`SELECT * FROM integrations WHERE id = ?`)
        .bind(integrationId)
        .first();
      if (!existing) {
        return notFound("Integration not found");
      }
      if (!canAdminWorkspace(actor, (existing as { workspace_id: string }).workspace_id)) {
        return forbidden("forbidden");
      }

      const updates: string[] = [];
      const bindings: unknown[] = [];

      if (body.displayName !== undefined) {
        updates.push("display_name = ?");
        bindings.push(body.displayName);
      }
      if (body.is_active !== undefined) {
        updates.push("is_active = ?");
        bindings.push(body.is_active ? 1 : 0);
      }
      if (body.secrets) {
        const provider = (existing as { provider: string }).provider;
        const secretsValid = validateSecrets(provider, body.secrets);
        if (!secretsValid.ok) {
          return badRequest(secretsValid.error);
        }
        let encrypted;
        try {
          encrypted = await encryptSecrets(env, JSON.stringify(body.secrets));
        } catch (error) {
          const message = error instanceof Error ? error.message : "secrets_encrypt_failed";
          return serverError(message);
        }
        updates.push("secrets_key_id = ?", "secrets_ciphertext = ?");
        bindings.push(encrypted.keyId, encrypted.ciphertext);
      }

      if (updates.length === 0) {
        return badRequest("no_updates");
      }

      updates.push("updated_at = ?");
      bindings.push(nowISO());

      bindings.push(integrationId);

      await env.DB.prepare(
        `UPDATE integrations
         SET ${updates.join(", ")}
         WHERE id = ?`
      )
        .bind(...bindings)
        .run();

      const integration = await env.DB.prepare(
        `SELECT id, workspace_id, provider, environment, external_account_id,
                display_name, secrets_key_id, is_active, created_at, updated_at
         FROM integrations WHERE id = ?`
      )
        .bind(integrationId)
        .first();

      return json(integration);
    }

    if (request.method === "DELETE") {
      const existing = await env.DB.prepare(`SELECT workspace_id FROM integrations WHERE id = ?`)
        .bind(integrationId)
        .first<{ workspace_id: string }>();
      if (!existing) {
        return notFound("Integration not found");
      }
      if (!canAdminWorkspace(actor, existing.workspace_id)) {
        return forbidden("forbidden");
      }

      const result = await env.DB.prepare("DELETE FROM integrations WHERE id = ?")
        .bind(integrationId)
        .run();

      if (!result.success) {
        return notFound("Integration not found");
      }

      return json({ deleted: true });
    }

    if (request.method === "GET") {
      const integration = await env.DB.prepare(
        `SELECT id, workspace_id, provider, environment, external_account_id,
                display_name, secrets_key_id, is_active, created_at, updated_at
         FROM integrations WHERE id = ?`
      )
        .bind(integrationId)
        .first();
      if (!integration) {
        return notFound("Integration not found");
      }
      return json(integration);
    }
  }

  return notFound("Route not found");
}

function validateSecrets(provider: string, secrets: Record<string, unknown>) {
  if (provider === "shopify") {
    if (typeof secrets.webhookSecret !== "string" || !secrets.webhookSecret.trim()) {
      return { ok: false, error: "missing_webhook_secret" };
    }
  }
  if (provider === "qbo") {
    if (typeof secrets.webhookVerifierToken !== "string" || !secrets.webhookVerifierToken.trim()) {
      return { ok: false, error: "missing_webhook_verifier_token" };
    }
  }
  return { ok: true as const };
}
