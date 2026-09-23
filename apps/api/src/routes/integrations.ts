import { badRequest, forbidden, json, methodNotAllowed, notFound, serverError } from "../lib/http";
import type { Env } from "../lib/types";
import { decryptSecrets, encryptSecrets } from "../lib/crypto/secrets";
import { nowISO } from "../lib/utils";
import { canAdminWorkspace, requireActor } from "../lib/access";
import { handleQboIntegration } from "./qboIntegration";
import { isTrustedMutationOrigin } from "../lib/security";
import { enqueueWorkspaceQuoSync } from "../services/quo";
import { syncQuoIntegrationConversations } from "../services/quoConversationSync";

const PROVIDERS = ["shopify", "qbo", "quo", "website"] as const;
const ENVIRONMENTS = ["sandbox", "production"] as const;

export async function handleIntegrations(
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

  if (segments[0] === "qbo" && segments.length === 2) {
    return await handleQboIntegration(segments.slice(1), request, env, url, actor);
  }

  if (["POST", "PATCH", "DELETE"].includes(request.method) && !isTrustedMutationOrigin(request)) {
    return forbidden("csrf_origin_invalid");
  }

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
        filters.push("integrations.workspace_id = ?");
        bindings.push(workspaceId);
      }
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const result = await env.DB.prepare(
        `SELECT integrations.id, integrations.workspace_id, integrations.provider,
                integrations.environment, integrations.external_account_id,
                integrations.display_name, integrations.secrets_key_id, integrations.is_active,
                integrations.created_at, integrations.updated_at,
                sync.last_successful_sync_at AS quo_conversations_last_synced_at,
                sync.last_attempt_at AS quo_conversations_last_attempt_at,
                sync.last_error AS quo_conversations_sync_error
         FROM integrations
         LEFT JOIN quo_conversation_sync_state sync ON sync.integration_id=integrations.id
         ${where}
         ORDER BY integrations.created_at DESC`
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
        sourceDomain?: string;
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
      const environment = provider === "quo" ? "production" : body.environment?.trim();
      const externalAccountId =
        provider === "quo"
          ? workspaceId
          : provider === "website"
            ? normalizeWebsiteDomain(body.sourceDomain)
            : body.externalAccountId?.trim();
      if (provider === "website" && !externalAccountId) return badRequest("invalid_source_domain");
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

      if (provider === "website" && body.secrets !== undefined)
        return badRequest("website_credential_is_generated");
      const intakeCredential = provider === "website" ? generateIntakeCredential() : undefined;
      const secrets = intakeCredential ? { intakeToken: intakeCredential } : (body.secrets ?? {});
      if (
        provider === "website" &&
        (await websiteDomainExists(env, environment, externalAccountId))
      )
        return json({ error: "source_domain_already_configured" }, 409);
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
      try {
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
      } catch (error) {
        if (
          provider === "website" &&
          error instanceof Error &&
          error.message.includes("UNIQUE constraint failed: integrations.provider")
        )
          return json({ error: "source_domain_already_configured" }, 409);
        throw error;
      }

      const integration = await env.DB.prepare(
        `SELECT id, workspace_id, provider, environment, external_account_id,
                display_name, secrets_key_id, is_active, created_at, updated_at
         FROM integrations WHERE id = ?`
      )
        .bind(id)
        .first();

      if (provider === "quo") await enqueueWorkspaceQuoSync(env, workspaceId);

      return json({ ...integration, ...(intakeCredential ? { intakeCredential } : {}) }, 201, {
        "Cache-Control": "no-store",
      });
    }

    return methodNotAllowed(["GET", "POST"]);
  }

  if (segments.length === 2 && segments[1] === "sync" && request.method === "POST") {
    const integration = await env.DB.prepare(
      `SELECT id,workspace_id,secrets_key_id,secrets_ciphertext,provider,is_active
       FROM integrations WHERE id=?`
    )
      .bind(segments[0])
      .first<{
        id: string;
        workspace_id: string;
        secrets_key_id: string;
        secrets_ciphertext: string;
        provider: string;
        is_active: number;
      }>();
    if (!integration) return notFound("Integration not found");
    if (!canAdminWorkspace(actor, integration.workspace_id)) return forbidden("forbidden");
    if (integration.provider !== "quo") return badRequest("not_quo_integration");
    if (!integration.is_active) return badRequest("integration_inactive");
    await syncQuoIntegrationConversations(env, integration, new Date(), { forceBackfill: true });
    const state = await env.DB.prepare(
      `SELECT last_successful_sync_at,last_attempt_at,last_error
       FROM quo_conversation_sync_state WHERE integration_id=?`
    )
      .bind(integration.id)
      .first();
    return json({ ok: true, state });
  }

  if (segments.length === 1) {
    const integrationId = segments[0];

    if (request.method === "PATCH") {
      let body: {
        displayName?: string | null;
        is_active?: number;
        regenerateCredential?: boolean;
        sourceDomain?: string;
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

      const provider = (existing as { provider: string }).provider;
      if (provider === "website" && body.secrets !== undefined)
        return badRequest("website_credential_is_generated");
      if (
        body.regenerateCredential !== undefined &&
        (provider !== "website" || body.regenerateCredential !== true)
      )
        return badRequest("invalid_credential_regeneration");
      const intakeCredential = body.regenerateCredential ? generateIntakeCredential() : undefined;
      const updates: string[] = [];
      const bindings: unknown[] = [];

      if (body.sourceDomain !== undefined) {
        if (provider !== "website") return badRequest("source_domain_only_for_website");
        const domain = normalizeWebsiteDomain(body.sourceDomain);
        if (!domain) return badRequest("invalid_source_domain");
        if (
          await websiteDomainExists(
            env,
            (existing as { environment: string }).environment,
            domain,
            integrationId
          )
        )
          return json({ error: "source_domain_already_configured" }, 409);
        updates.push("external_account_id = ?");
        bindings.push(domain);
      }
      if (body.displayName !== undefined) {
        updates.push("display_name = ?");
        bindings.push(body.displayName);
      }
      if (body.is_active !== undefined) {
        updates.push("is_active = ?");
        bindings.push(body.is_active ? 1 : 0);
      }
      if (body.secrets || intakeCredential) {
        let mergedSecrets: Record<string, unknown> = intakeCredential
          ? { intakeToken: intakeCredential }
          : body.secrets!;
        if (!intakeCredential)
          try {
            const previous = JSON.parse(
              await decryptSecrets(
                env,
                (existing as { secrets_key_id: string }).secrets_key_id,
                (existing as { secrets_ciphertext: string }).secrets_ciphertext
              )
            ) as Record<string, unknown>;
            mergedSecrets = { ...previous, ...body.secrets };
          } catch {
            return serverError("secrets_decrypt_failed");
          }
        const secretsValid = validateSecrets(provider, mergedSecrets);
        if (!secretsValid.ok) {
          return badRequest(secretsValid.error);
        }
        let encrypted;
        try {
          encrypted = await encryptSecrets(env, JSON.stringify(mergedSecrets));
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

      try {
        await env.DB.prepare(
          `UPDATE integrations
         SET ${updates.join(", ")}
         WHERE id = ?`
        )
          .bind(...bindings)
          .run();
      } catch (error) {
        if (
          provider === "website" &&
          error instanceof Error &&
          error.message.includes("UNIQUE constraint failed: integrations.provider")
        )
          return json({ error: "source_domain_already_configured" }, 409);
        throw error;
      }

      const integration = await env.DB.prepare(
        `SELECT id, workspace_id, provider, environment, external_account_id,
                display_name, secrets_key_id, is_active, created_at, updated_at
         FROM integrations WHERE id = ?`
      )
        .bind(integrationId)
        .first();

      if ((existing as { provider: string }).provider === "quo") {
        await enqueueWorkspaceQuoSync(env, (existing as { workspace_id: string }).workspace_id);
      }

      return json({ ...integration, ...(intakeCredential ? { intakeCredential } : {}) }, 200, {
        "Cache-Control": "no-store",
      });
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
      if (!canAdminWorkspace(actor, (integration as { workspace_id: string }).workspace_id))
        return forbidden("forbidden");
      return json(integration);
    }
  }

  return notFound("Route not found");
}

function validateSecrets(provider: string, secrets: Record<string, unknown>) {
  if (
    provider === "website" &&
    (typeof secrets.intakeToken !== "string" ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(secrets.intakeToken))
  ) {
    return { ok: false, error: "invalid_intake_token" };
  }
  if (provider === "shopify") {
    if (typeof secrets.webhookSecret !== "string" || !secrets.webhookSecret.trim()) {
      return { ok: false, error: "missing_webhook_secret" };
    }
  }
  if (provider === "qbo") {
    if (typeof secrets.webhookVerifierToken !== "string" || !secrets.webhookVerifierToken.trim()) {
      return { ok: false, error: "missing_webhook_verifier_token" };
    }
    if (secrets.accessToken !== undefined && typeof secrets.accessToken !== "string") {
      return { ok: false, error: "invalid_access_token" };
    }
  }
  if (provider === "quo") {
    if (typeof secrets.apiKey !== "string" || !secrets.apiKey.trim()) {
      return { ok: false, error: "missing_quo_api_key" };
    }
    if (
      secrets.webhookSigningSecret !== undefined &&
      (typeof secrets.webhookSigningSecret !== "string" || !secrets.webhookSigningSecret.trim())
    ) {
      return { ok: false, error: "invalid_quo_webhook_signing_secret" };
    }
  }
  return { ok: true as const };
}

function generateIntakeCredential() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
function normalizeWebsiteDomain(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || /\s/.test(value.trim())) return null;
  try {
    const url = new URL(value.includes("://") ? value.trim() : `https://${value.trim()}`);
    const domain = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      domain.length > 253 ||
      !domain.includes(".") ||
      /^[\d.]+$/.test(domain)
    )
      return null;
    if (!domain.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))
      return null;
    return domain;
  } catch {
    return null;
  }
}
async function websiteDomainExists(env: Env, environment: string, domain: string, exceptId = "") {
  return Boolean(
    await env.DB.prepare(
      `SELECT id FROM integrations WHERE provider='website' AND environment=? AND external_account_id=? AND id!=?`
    )
      .bind(environment, domain, exceptId)
      .first()
  );
}
