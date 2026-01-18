import { useCallback, useEffect, useState } from "react";
import {
  getIngestRequest,
  listIngestRequests,
  type IngestRequestDetail,
  type IngestRequestSummary,
} from "./api";
import type { WorkspaceRow } from "../workspaces/api";

const PROVIDERS = ["shopify", "qbo"] as const;
const ENVIRONMENTS = ["production", "sandbox"] as const;

export function IngestPanel({
  workspaceId,
  workspaces,
}: {
  workspaceId: string | null;
  workspaces: WorkspaceRow[];
}) {
  const [provider, setProvider] = useState<string>("shopify");
  const [environment, setEnvironment] = useState<string>("production");
  const [requests, setRequests] = useState<IngestRequestSummary[]>([]);
  const [selected, setSelected] = useState<IngestRequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const workspaceMap = new Map(workspaces.map((ws) => [ws.id, ws.name]));

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await listIngestRequests({
      provider,
      environment,
      workspaceId: workspaceId ?? undefined,
      limit: 50,
    });
    if (result.ok) {
      setRequests(result.data?.requests ?? []);
      setSelected(null);
    } else {
      setError(result.text || "Failed to load ingest requests.");
    }
    setLoading(false);
  }, [environment, provider, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function loadDetail(id: string) {
    const result = await getIngestRequest(id);
    if (result.ok) {
      setSelected(result.data ?? null);
    } else {
      setError(result.text || "Failed to load detail.");
    }
  }

  return (
    <section className="panel">
      <h2>Ingest</h2>
      <div className="actions">
        <select value={provider} onChange={(event) => setProvider(event.target.value)}>
          {PROVIDERS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select value={environment} onChange={(event) => setEnvironment(event.target.value)}>
          {ENVIRONMENTS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select value={workspaceId ?? ""} onChange={() => undefined} disabled>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={refresh} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="ingest-layout">
        <div className="ingest-list">
          <table>
            <thead>
              <tr>
                <th>received_at</th>
                <th>workspace</th>
                <th>integration</th>
                <th>routed</th>
                <th>verified</th>
                <th>topic</th>
                <th>shop</th>
                <th>webhook_id</th>
                <th>error</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id} onClick={() => loadDetail(request.id)}>
                  <td>{request.received_at}</td>
                  <td>{workspaceMap.get(request.workspace_id) ?? request.workspace_id}</td>
                  <td>{request.integration_display_name ?? "-"}</td>
                  <td>{request.integration_id ? "yes" : "no"}</td>
                  <td>{request.signature_verified ? "yes" : "no"}</td>
                  <td>{request.topic ?? "-"}</td>
                  <td>{request.shop_domain ?? "-"}</td>
                  <td>{request.webhook_id ?? "-"}</td>
                  <td>{request.verify_error ?? "-"}</td>
                </tr>
              ))}
              {requests.length === 0 && (
                <tr>
                  <td colSpan={10} className="empty">
                    No requests.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="ingest-detail">
          {selected ? (
            <>
              <h3>Request Detail</h3>
              <pre>{JSON.stringify(selected, null, 2)}</pre>
            </>
          ) : (
            <p className="muted">Select a request to inspect.</p>
          )}
        </div>
      </div>
    </section>
  );
}
