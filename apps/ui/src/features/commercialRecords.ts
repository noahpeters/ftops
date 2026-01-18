import { buildUrl, fetchJson } from "../lib/api";

export type CommercialRecordListItem = {
  uri: string;
  source: string;
  kind: string;
  external_id: string | null;
  customer_display: string | null;
  quoted_delivery_date: string | null;
  quoted_install_date: string | null;
  last_seen_at: string | null;
  snapshot_hash: string | null;
};

export type CommercialRecordsResponse = {
  records: CommercialRecordListItem[];
  limit: number;
  offset: number;
};

export type CommercialRecordDetail = {
  record: Record<string, unknown>;
  line_items: Record<string, unknown>[];
};

export function listCommercialRecords(params: { limit?: number; offset?: number; query?: string }) {
  return fetchJson<CommercialRecordsResponse>(
    buildUrl("/commercial-records", {
      limit: params.limit,
      offset: params.offset,
      query: params.query,
    }),
    { method: "GET" }
  );
}

export function getCommercialRecordDetail(uri: string) {
  return fetchJson<CommercialRecordDetail>(
    buildUrl(`/commercial-records/${encodeURIComponent(uri)}`),
    { method: "GET" }
  );
}
