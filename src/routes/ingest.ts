import { json, methodNotAllowed, notFound } from "../lib/http";
import type { Env } from "../lib/types";
import { verifyShopifyHmac } from "../ingest/verifyShopify";
import { verifyQboSignature } from "../ingest/verifyQbo";
import { findIntegration } from "../ingest/integrationLookup";
import { getQboVerifierToken, getShopifyWebhookSecret } from "../ingest/getIntegrationSecret";
import { nowISO } from "../lib/utils";

const PROVIDERS = ["shopify", "qbo"] as const;
const ENVIRONMENTS = ["sandbox", "production"] as const;
const UNKNOWN_WORKSPACE_ID = "ws_unknown";

export async function handleIngest(
  segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  url: URL
) {
  if (segments.length === 0) {
    return notFound("Route not found");
  }

  const [head, tail, third] = segments;

  if (head === "requests" && request.method === "GET") {
    if (tail) {
      return getIngestRequestById(env, tail);
    }
    return listIngestRequests(env, url);
  }

  if (request.method !== "POST" || tail !== "webhook") {
    return methodNotAllowed(["POST"]);
  }

  if (head === "shopify") {
    return handleShopifyWebhook(env, request, url);
  }
  if (head === "qbo") {
    return handleQboWebhook(env, request, url);
  }

  return notFound("Route not found");
}

async function handleShopifyWebhook(env: Env, request: Request, url: URL) {
  const envParam = parseEnvironment(url);
  const shopDomain = request.headers.get("X-Shopify-Shop-Domain") ?? "";
  const signatureHeader = request.headers.get("X-Shopify-Hmac-SHA256");
  const rawBody = await request.arrayBuffer();
  const bodyText = decodeBody(rawBody);
  const parsed = safeParseJson(bodyText);

  const headersJson = JSON.stringify(
    pickHeaders(request.headers, [
      "x-shopify-topic",
      "x-shopify-shop-domain",
      "x-shopify-webhook-id",
      "x-shopify-hmac-sha256",
      "content-type",
      "user-agent",
    ])
  );

  const integration = await findIntegration(env, {
    provider: "shopify",
    environment: envParam.value,
    externalAccountId: shopDomain,
  });

  let verified = false;
  let verifyError: string | null = envParam.invalid ? "invalid_env_param" : null;
  let workspaceId = UNKNOWN_WORKSPACE_ID;
  let integrationId: string | null = null;
  let routed = false;

  if (!integration) {
    verifyError = verifyError ?? "no_integration_for_account";
  } else {
    routed = true;
    workspaceId = integration.workspace_id;
    integrationId = integration.id;
    try {
      const webhookSecret = await getShopifyWebhookSecret(env, integration);
      const result = await verifyShopifyHmac(
        rawBody,
        signatureHeader,
        webhookSecret
      );
      verified = result.ok;
      verifyError = result.ok ? null : result.error ?? "signature_mismatch";
    } catch (error) {
      verified = false;
      verifyError = error instanceof Error ? error.message : "verify_failed";
    }
  }

  await insertIngestRequest(env, {
    provider: "shopify",
    workspace_id: workspaceId,
    environment: envParam.value,
    external_account_id: shopDomain || null,
    integration_id: integrationId,
    method: request.method,
    url: `${url.pathname}${url.search}`,
    headers_json: headersJson,
    body_text: bodyText,
    body_json: parsed.ok ? JSON.stringify(parsed.value) : null,
    signature_header: signatureHeader,
    signature_verified: verified,
    verify_error: verifyError,
  });

  console.log(
    JSON.stringify({
      provider: "shopify",
      received_at: nowISO(),
      verified,
      topic: request.headers.get("X-Shopify-Topic") ?? undefined,
      shopDomain,
      webhookId: request.headers.get("X-Shopify-Webhook-Id") ?? undefined,
      error: verifyError ?? undefined,
    })
  );

  return json({ ok: true, verified, routed, workspaceId });
}

async function handleQboWebhook(env: Env, request: Request, url: URL) {
  const envParam = parseEnvironment(url);
  const signatureHeader = request.headers.get("intuit-signature");
  const rawBody = await request.arrayBuffer();
  const bodyText = decodeBody(rawBody);
  const parsed = safeParseJson(bodyText);
  const realmId = extractRealmId(parsed);

  const headersJson = JSON.stringify(
    pickHeaders(request.headers, ["intuit-signature", "content-type", "user-agent"])
  );

  const integration =
    realmId && !envParam.invalid
      ? await findIntegration(env, {
          provider: "qbo",
          environment: envParam.value,
          externalAccountId: realmId,
        })
      : null;

  let verified = false;
  let verifyError: string | null = envParam.invalid ? "invalid_env_param" : null;
  let workspaceId = UNKNOWN_WORKSPACE_ID;
  let integrationId: string | null = null;
  let routed = false;

  if (!parsed.ok) {
    verifyError = "invalid_json_body";
  } else if (!realmId) {
    verifyError = "missing_realm_id";
  } else if (!integration) {
    verifyError = verifyError ?? "no_integration_for_account";
  } else {
    routed = true;
    workspaceId = integration.workspace_id;
    integrationId = integration.id;
    try {
      const verifierToken = await getQboVerifierToken(env, integration);
      const result = await verifyQboSignature(
        rawBody,
        signatureHeader,
        verifierToken
      );
      verified = result.ok;
      verifyError = result.ok ? null : result.error ?? "signature_mismatch";
    } catch (error) {
      verified = false;
      verifyError = error instanceof Error ? error.message : "verify_failed";
    }
  }

  await insertIngestRequest(env, {
    provider: "qbo",
    workspace_id: workspaceId,
    environment: envParam.value,
    external_account_id: realmId ?? null,
    integration_id: integrationId,
    method: request.method,
    url: `${url.pathname}${url.search}`,
    headers_json: headersJson,
    body_text: bodyText,
    body_json: parsed.ok ? JSON.stringify(parsed.value) : null,
    signature_header: signatureHeader,
    signature_verified: verified,
    verify_error: verifyError,
  });

  console.log(
    JSON.stringify({
      provider: "qbo",
      received_at: nowISO(),
      verified,
      realmId: realmId ?? undefined,
      error: verifyError ?? undefined,
    })
  );

  return json({ ok: true, verified, routed, workspaceId });
}

async function listIngestRequests(env: Env, url: URL) {
  const provider = url.searchParams.get("provider");
  const workspaceId = url.searchParams.get("workspaceId");
  const environment = url.searchParams.get("environment");
  const routedOnly = url.searchParams.get("routedOnly");
  const limitParam = Number(url.searchParams.get("limit") ?? 50);
  const limit = Math.min(Number.isFinite(limitParam) ? limitParam : 50, 200);

  const filters: string[] = [];
  const bindings: string[] = [];

  if (provider && PROVIDERS.includes(provider as (typeof PROVIDERS)[number])) {
    filters.push("req.provider = ?");
    bindings.push(provider);
  }
  if (workspaceId) {
    filters.push("req.workspace_id = ?");
    bindings.push(workspaceId);
  }
  if (environment && ENVIRONMENTS.includes(environment as (typeof ENVIRONMENTS)[number])) {
    filters.push("req.environment = ?");
    bindings.push(environment);
  }
  if (routedOnly === "true") {
    filters.push("req.integration_id IS NOT NULL");
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const result = await env.DB.prepare(
    `SELECT req.id, req.provider, req.received_at, req.signature_verified, req.verify_error,
            req.headers_json, req.workspace_id, req.environment, req.external_account_id,
            req.integration_id, integ.display_name AS integration_display_name
     FROM ingest_requests req
     LEFT JOIN integrations integ ON integ.id = req.integration_id
     ${where}
     ORDER BY req.received_at DESC
     LIMIT ?`
  )
    .bind(...bindings, limit)
    .all();

  const rows = (result.results ?? []) as Array<Record<string, unknown>>;
  const summaries = rows.map((row) => {
    const headersParsed = safeParseJson(String(row.headers_json ?? "{}"));
    const headers = headersParsed.ok && headersParsed.value
      ? (headersParsed.value as Record<string, unknown>)
      : {};
    return {
      id: row.id,
      provider: row.provider,
      received_at: row.received_at,
      signature_verified: row.signature_verified,
      verify_error: row.verify_error,
      workspace_id: row.workspace_id,
      environment: row.environment,
      external_account_id: row.external_account_id,
      integration_id: row.integration_id,
      integration_display_name: row.integration_display_name,
      topic: headers["x-shopify-topic"],
      shop_domain: headers["x-shopify-shop-domain"],
      webhook_id: headers["x-shopify-webhook-id"],
    };
  });

  return json({ requests: summaries, limit });
}

async function getIngestRequestById(env: Env, id: string) {
  const row = await env.DB.prepare(
    `SELECT * FROM ingest_requests WHERE id = ?`
  )
    .bind(id)
    .first();

  if (!row) {
    return notFound("Ingest request not found");
  }

  return json(row);
}

async function insertIngestRequest(
  env: Env,
  args: {
    provider: "shopify" | "qbo";
    workspace_id: string;
    environment: string;
    external_account_id: string | null;
    integration_id: string | null;
    method: string;
    url: string;
    headers_json: string;
    body_text: string;
    body_json: string | null;
    signature_header: string | null;
    signature_verified: boolean;
    verify_error: string | null;
  }
) {
  await env.DB.prepare(
    `INSERT INTO ingest_requests
      (id, workspace_id, provider, received_at, method, url, headers_json, body_text, body_json,
       signature_header, signature_verified, verify_error, environment, external_account_id, integration_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      args.workspace_id,
      args.provider,
      nowISO(),
      args.method,
      args.url,
      args.headers_json,
      args.body_text,
      args.body_json,
      args.signature_header,
      args.signature_verified ? 1 : 0,
      args.verify_error,
      args.environment,
      args.external_account_id,
      args.integration_id
    )
    .run();
}

function parseEnvironment(url: URL) {
  const envParam = url.searchParams.get("env")?.toLowerCase();
  if (envParam === "sandbox" || envParam === "production") {
    return { value: envParam, invalid: false };
  }
  return { value: "production", invalid: Boolean(envParam) };
}

function decodeBody(rawBody: ArrayBuffer) {
  return new TextDecoder().decode(rawBody);
}

function safeParseJson(input: string | null) {
  if (!input) return { ok: false, value: null as unknown };
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch {
    return { ok: false, value: null as unknown };
  }
}

function pickHeaders(headers: Headers, keys: string[]) {
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = headers.get(key);
    if (value) {
      result[key.toLowerCase()] = value;
    }
  }
  return result;
}

function extractRealmId(payload: { ok: boolean; value: unknown }) {
  if (!payload.ok || !payload.value || typeof payload.value !== "object") {
    return null;
  }
  const record = payload.value as Record<string, unknown>;
  if (typeof record.realmId === "string") {
    return record.realmId;
  }
  const notifications = record.eventNotifications;
  if (Array.isArray(notifications) && notifications[0]) {
    const realm = (notifications[0] as Record<string, unknown>).realmId;
    if (typeof realm === "string") {
      return realm;
    }
  }
  return null;
}
