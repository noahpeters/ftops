import { buildUrl, fetchJson } from "../../lib/api";

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
