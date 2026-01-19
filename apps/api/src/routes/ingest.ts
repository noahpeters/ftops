import { json, methodNotAllowed, notFound } from "../lib/http";
import type { Env } from "../lib/types";

const PROVIDERS = ["shopify", "qbo"] as const;
const ENVIRONMENTS = ["sandbox", "production"] as const;

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

  const [head, tail] = segments;

  if (head !== "requests") {
    return notFound("Route not found");
  }

  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  if (tail) {
    return getIngestRequestById(env, tail);
  }
  return listIngestRequests(env, url);
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
    const source = provider === "qbo" ? "quickbooks" : provider;
    filters.push("req.source = ?");
    bindings.push(source);
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
    `SELECT req.id, req.source, req.received_at, req.signature_verified, req.verify_error,
            req.headers_json, req.workspace_id, req.environment, req.external_account_id,
            req.integration_id, integ.display_name AS integration_display_name
     FROM raw_events req
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
    const headers =
      headersParsed.ok && headersParsed.value
        ? (headersParsed.value as Record<string, unknown>)
        : {};
    const providerLabel = row.source === "quickbooks" ? "qbo" : row.source;
    return {
      id: row.id,
      provider: providerLabel,
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
  const row = await env.DB.prepare(`SELECT * FROM raw_events WHERE id = ?`).bind(id).first();

  if (!row) {
    return notFound("Ingest request not found");
  }

  return json(row);
}

function safeParseJson(input: string | null) {
  if (!input) return { ok: false, value: null as unknown };
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch {
    return { ok: false, value: null as unknown };
  }
}
