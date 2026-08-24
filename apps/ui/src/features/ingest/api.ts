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

export async function replayIngestRequest(id: string) {
  return await fetchJson<{ ok: boolean; error?: string }>(
    buildUrl(`/admin/ingest-requests/${id}/replay`),
    {
      method: "POST",
    }
  );
}

export type EmailIngestionSummary = {
  id: string;
  workspace_id: string;
  forwarding_email: string;
  envelope_to: string;
  original_sender_email: string | null;
  original_sender_name: string | null;
  contact_id: string | null;
  contact_display_name: string | null;
  customer_id: string | null;
  customer_display_name: string | null;
  subject: string | null;
  status: "queued" | "processing" | "needs_match" | "ready" | "applied" | "dismissed" | "failed";
  failure_reason: string | null;
  received_at: string;
  processed_at: string | null;
  updated_at: string;
  attachment_count: number;
  candidate_count: number;
  pending_candidate_count: number;
  applied_candidate_count: number;
  message_count: number;
};

export async function listEmailIngestions(params: { workspaceId: string; status?: string }) {
  return await fetchJson<EmailIngestionSummary[]>(buildUrl("/customer-emails", params));
}

export async function retryEmailIngestion(ingestion: EmailIngestionSummary) {
  return await fetchJson<{ queued: boolean }>(
    buildUrl(`/customer-emails/ingestions/${ingestion.id}/match`),
    {
      method: "POST",
      body: JSON.stringify({
        customerId: ingestion.customer_id,
        contactId: ingestion.contact_id,
      }),
    }
  );
}
