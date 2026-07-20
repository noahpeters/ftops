import { buildUrl, fetchJson, getApiBase } from "../../lib/api";

export type IntegrationRow = {
  id: string;
  workspace_id: string;
  provider: "shopify" | "qbo";
  environment: "sandbox" | "production";
  external_account_id: string;
  display_name: string | null;
  secrets_key_id: string;
  is_active: number;
  created_at: string;
  updated_at: string;
};

export async function listIntegrations(workspaceId?: string | null) {
  return await fetchJson<IntegrationRow[]>(
    buildUrl("/integrations", workspaceId ? { workspaceId } : undefined)
  );
}

export async function createIntegration(body: {
  workspaceId: string;
  provider: "shopify" | "qbo";
  environment: "sandbox" | "production";
  externalAccountId: string;
  displayName?: string;
  secrets: Record<string, unknown>;
}) {
  return await fetchJson<IntegrationRow>(buildUrl("/integrations"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function updateIntegration(
  id: string,
  body: {
    displayName?: string | null;
    is_active?: number;
    secrets?: Record<string, unknown>;
  }
) {
  return await fetchJson<IntegrationRow>(buildUrl(`/integrations/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteIntegration(id: string) {
  return await fetchJson(buildUrl(`/integrations/${id}`), { method: "DELETE" });
}

export type QboConnectionStatus = {
  id: string;
  environment: string;
  external_account_id: string;
  is_active: number;
  connection_status: string;
  connection_error: string | null;
  last_successful_sync_at: string | null;
  token_health: string;
  entity_type: string | null;
  start_position: number | null;
  imported_count: number | null;
  bootstrap_status: string | null;
  started_at: string | null;
  completed_at: string | null;
  bootstrap_error: string | null;
};
export async function qboStatus(workspaceId: string) {
  return await fetchJson<QboConnectionStatus[]>(
    buildUrl("/integrations/qbo/status", { workspaceId })
  );
}
export function qboConnectUrl(workspaceId: string, environment: string) {
  const path = `/integrations/qbo/connect?${new URLSearchParams({ workspaceId, environment })}`;
  const base = getApiBase();
  return base === "/api"
    ? `https://api.from-trees.com${path}`
    : `${base.replace(/\/$/, "")}${path}`;
}
export async function qboDisconnect(workspaceId: string, integrationId: string) {
  return await fetchJson(buildUrl("/integrations/qbo/disconnect"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, integrationId }),
  });
}
export async function qboBootstrap(workspaceId: string, integrationId: string) {
  return await fetchJson<{ jobId: string; status: string }>(
    buildUrl("/integrations/qbo/bootstrap"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, integrationId }),
    }
  );
}
