import { buildUrl, fetchJson } from "../../lib/api";

export type IngestRequestSummary = {
  id: string;
  provider: "shopify" | "qbo";
  received_at: string;
  signature_verified: number;
  verify_error: string | null;
  workspace_id: string;
  environment: string;
  external_account_id: string | null;
  integration_id: string | null;
  integration_display_name?: string | null;
  topic?: string | null;
  shop_domain?: string | null;
  webhook_id?: string | null;
};

export type IngestListResponse = {
  requests: IngestRequestSummary[];
  limit: number;
};

export type IngestRequestDetail = Record<string, unknown>;

export async function listIngestRequests(params: {
  provider?: string;
  workspaceId?: string | null;
  environment?: string;
  limit?: number;
}) {
  return await fetchJson<IngestListResponse>(buildUrl("/ingest/requests", params));
}

export async function getIngestRequest(id: string) {
  return await fetchJson<IngestRequestDetail>(buildUrl(`/ingest/requests/${id}`));
}
