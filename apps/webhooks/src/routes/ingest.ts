import { badRequest, json, methodNotAllowed, notFound } from "../lib/http";
import type { Env } from "../lib/types";
import { verifyShopifyHmac } from "../ingest/verifyShopify";
import { verifyQboSignature } from "../ingest/verifyQbo";
import { findIntegration } from "../ingest/integrationLookup";
import {
  getQboVerifierToken,
  getShopifyWebhookSecret,
} from "../ingest/getIntegrationSecret";
import { nowISO } from "../lib/utils";
import { buildWebhookEnvelopeId, type WebhookEnvelope } from "@ftops/webhooks";

const PROVIDERS = ["shopify", "qbo"] as const;
const UNKNOWN_WORKSPACE_ID = "ws_unknown";
const MAX_BODY_BYTES = 1_000_000;

export async function handleIngest(
  segments: string[],
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  url: URL,
) {
  if (segments.length === 0) {
    return notFound("Route not found");
  }

  const [head, tail] = segments;

  if (request.method !== "POST" || tail !== "webhook") {
    return methodNotAllowed(["POST"]);
  }

  if (!PROVIDERS.includes(head as (typeof PROVIDERS)[number])) {
    return notFound("Route not found");
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
  const rawBody = await readBodyWithLimit(request);
  if (!rawBody.ok) {
    return rawBody.response;
  }
  const bodyText = decodeBody(rawBody.value);
  const parsed = safeParseJson(bodyText);

  const headers = pickHeaders(request.headers, [
    "x-shopify-topic",
    "x-shopify-shop-domain",
    "x-shopify-webhook-id",
    "x-shopify-hmac-sha256",
    "content-type",
    "user-agent",
  ]);

  const integration = await findIntegration(env, {
    provider: "shopify",
    environment: envParam.value,
    externalAccountId: shopDomain,
  });

  let verified = false;
  let verifyError: string | null = envParam.invalid
    ? "invalid_env_param"
    : null;
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
        rawBody.value,
        signatureHeader,
        webhookSecret,
      );
      verified = result.ok;
      verifyError = result.ok ? null : (result.error ?? "signature_mismatch");
    } catch (error) {
      verified = false;
      verifyError = error instanceof Error ? error.message : "verify_failed";
    }
  }

  const envelope = await buildEnvelope({
    source: "shopify",
    workspaceId,
    externalAccountId: shopDomain || null,
    integrationId,
    environment: envParam.value,
    request,
    url,
    headers,
    bodyText,
    parsedBody: parsed.ok ? parsed.value : undefined,
    signatureHeader,
    signatureVerified: verified,
    verifyError,
  });

  await env.QB_INGEST_QUEUE.send(envelope);

  console.log(
    JSON.stringify({
      source: "shopify",
      received_at: envelope.receivedAt,
      verified,
      topic: request.headers.get("X-Shopify-Topic") ?? undefined,
      shopDomain,
      webhookId: request.headers.get("X-Shopify-Webhook-Id") ?? undefined,
      error: verifyError ?? undefined,
      id: envelope.id,
    }),
  );

  if (!parsed.ok) {
    return badRequest("invalid_json_body");
  }

  return json({ ok: true, verified, routed, workspaceId });
}

async function handleQboWebhook(env: Env, request: Request, url: URL) {
  const envParam = parseEnvironment(url);
  const signatureHeader = request.headers.get("intuit-signature");
  const rawBody = await readBodyWithLimit(request);
  if (!rawBody.ok) {
    return rawBody.response;
  }
  const bodyText = decodeBody(rawBody.value);
  const parsed = safeParseJson(bodyText);
  const realmId = extractRealmId(parsed);

  const headers = pickHeaders(request.headers, [
    "intuit-signature",
    "content-type",
    "user-agent",
  ]);

  const integration =
    realmId && !envParam.invalid
      ? await findIntegration(env, {
          provider: "qbo",
          environment: envParam.value,
          externalAccountId: realmId,
        })
      : null;

  let verified = false;
  let verifyError: string | null = envParam.invalid
    ? "invalid_env_param"
    : null;
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
        rawBody.value,
        signatureHeader,
        verifierToken,
      );
      verified = result.ok;
      verifyError = result.ok ? null : (result.error ?? "signature_mismatch");
    } catch (error) {
      verified = false;
      verifyError = error instanceof Error ? error.message : "verify_failed";
    }
  }

  const envelope = await buildEnvelope({
    source: "quickbooks",
    workspaceId,
    realmId,
    externalAccountId: realmId,
    integrationId,
    environment: envParam.value,
    request,
    url,
    headers,
    bodyText,
    parsedBody: parsed.ok ? parsed.value : undefined,
    signatureHeader,
    signatureVerified: verified,
    verifyError,
  });

  await env.QB_INGEST_QUEUE.send(envelope);

  console.log(
    JSON.stringify({
      source: "quickbooks",
      received_at: envelope.receivedAt,
      verified,
      realmId: realmId ?? undefined,
      error: verifyError ?? undefined,
      id: envelope.id,
    }),
  );

  if (!parsed.ok) {
    return badRequest("invalid_json_body");
  }

  return json({ ok: true, verified, routed, workspaceId });
}

async function buildEnvelope(args: {
  source: WebhookEnvelope["source"];
  workspaceId: string;
  realmId?: string | null;
  externalAccountId?: string | null;
  integrationId: string | null;
  environment: string;
  request: Request;
  url: URL;
  headers: Record<string, string>;
  bodyText: string;
  parsedBody?: unknown;
  signatureHeader: string | null;
  signatureVerified: boolean;
  verifyError: string | null;
}) {
  const id = await buildWebhookEnvelopeId({
    source: args.source,
    parsedBody: args.parsedBody,
    body: args.bodyText,
    realmId: args.realmId ?? null,
    path: args.url.pathname,
    method: args.request.method,
  });

  return {
    id,
    source: args.source,
    workspaceId: args.workspaceId,
    realmId: args.realmId ?? null,
    externalAccountId: args.externalAccountId ?? null,
    integrationId: args.integrationId,
    environment: args.environment,
    receivedAt: nowISO(),
    path: args.url.pathname,
    method: args.request.method,
    headers: args.headers,
    body: args.bodyText,
    contentType: args.request.headers.get("content-type"),
    signature: args.signatureHeader,
    signatureVerified: args.signatureVerified,
    verifyError: args.verifyError,
  } satisfies WebhookEnvelope;
}

function parseEnvironment(url: URL): {
  value: "sandbox" | "production";
  invalid: boolean;
} {
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

async function readBodyWithLimit(request: Request) {
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader) {
    const declared = Number(lengthHeader);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return {
        ok: false as const,
        response: json({ error: "payload_too_large" }, 413),
      };
    }
  }

  const rawBody = await request.arrayBuffer();
  if (rawBody.byteLength > MAX_BODY_BYTES) {
    return {
      ok: false as const,
      response: json({ error: "payload_too_large" }, 413),
    };
  }

  return { ok: true as const, value: rawBody };
}
