"use client";

import { useCallback, useEffect, useState, type MouseEvent } from "react";
import stylex from "~/lib/stylex";
import { colors, radius } from "../../theme/tokens.stylex";
import {
  getIngestRequest,
  listEmailIngestions,
  listIngestRequests,
  replayIngestRequest,
  retryEmailIngestion,
  type EmailIngestionSummary,
  type IngestRequestDetail,
  type IngestRequestSummary,
} from "./api";
import type { WorkspaceRow } from "../workspaces/api";

const PROVIDERS = ["shopify", "qbo"] as const;
const ENVIRONMENTS = ["production", "sandbox"] as const;
const EMAIL_STATUSES = [
  "attention",
  "all",
  "failed",
  "needs_match",
  "ready",
  "applied",
  "dismissed",
] as const;

const styles = stylex.create({
  panel: {
    padding: "24px 32px",
  },
  actions: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    alignItems: "center",
  },
  error: {
    color: colors.errorText,
  },
  layout: {
    display: "grid",
    gridTemplateColumns: "2fr 1fr",
    gap: "16px",
    marginTop: "16px",
  },
  list: {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    overflowX: "auto",
    backgroundColor: colors.surface,
  },
  toast: {
    marginTop: "12px",
    padding: "10px 12px",
    borderRadius: radius.md,
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.surface,
    color: colors.text,
  },
  toastSuccess: {
    borderColor: colors.successText,
    color: colors.successText,
  },
  toastError: {
    borderColor: colors.errorText,
    color: colors.errorText,
  },
  detail: {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    padding: "12px",
    backgroundColor: colors.surface,
  },
  empty: {
    color: colors.textSubtle,
  },
  muted: {
    color: colors.textSubtle,
  },
  replayButton: {
    padding: "4px 8px",
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.surface,
    cursor: "pointer",
  },
  replayButtonDisabled: {
    cursor: "not-allowed",
    opacity: 0.6,
  },
  actionsCell: {
    whiteSpace: "nowrap",
  },
  viewButton: {
    padding: "7px 12px",
    borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.surface,
    cursor: "pointer",
  },
  viewButtonActive: {
    borderColor: colors.accent,
    color: colors.accent,
  },
  alert: {
    marginTop: "12px",
    padding: "12px",
    borderRadius: radius.md,
    border: `1px solid ${colors.errorText}`,
    color: colors.errorText,
    backgroundColor: colors.surface,
  },
  status: {
    fontWeight: 600,
  },
  failureReason: {
    color: colors.errorText,
    maxWidth: "360px",
    whiteSpace: "normal",
  },
});

export function IngestPanel({
  workspaceId,
  workspaces,
}: {
  workspaceId: string | null;
  workspaces: WorkspaceRow[];
}) {
  const [provider, setProvider] = useState<string>("shopify");
  const [environment, setEnvironment] = useState<string>("production");
  const [view, setView] = useState<"email" | "webhooks">("email");
  const [emailStatus, setEmailStatus] = useState<string>("attention");
  const [requests, setRequests] = useState<IngestRequestSummary[]>([]);
  const [emailIngestions, setEmailIngestions] = useState<EmailIngestionSummary[]>([]);
  const [selected, setSelected] = useState<IngestRequestDetail | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<EmailIngestionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [replayingIds, setReplayingIds] = useState<Set<string>>(new Set());
  const [retryingEmailIds, setRetryingEmailIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const workspaceMap = new Map(workspaces.map((ws) => [ws.id, ws.name]));
  const latestRetryableEmail = emailIngestions.find(
    (ingestion) => ingestion.status === "failed" && ingestion.customer_id
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setToast(null);
    if (view === "email") {
      if (!workspaceId) {
        setEmailIngestions([]);
        setLoading(false);
        return;
      }
      const result = await listEmailIngestions({
        workspaceId,
        status: emailStatus === "all" ? undefined : emailStatus,
      });
      if (result.ok) {
        setEmailIngestions(result.data ?? []);
        setSelectedEmail(null);
      } else setError(result.text || "Failed to load email processing activity.");
      setLoading(false);
      return;
    }
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
  }, [emailStatus, environment, provider, view, workspaceId]);

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

  async function handleReplay(event: MouseEvent<HTMLButtonElement>, id: string) {
    event.stopPropagation();
    const confirmed = window.confirm(
      "Replay this ingest request? This will re-enqueue the same event."
    );
    if (!confirmed) return;

    setReplayingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setToast(null);

    const result = await replayIngestRequest(id);

    setReplayingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    if (result.ok) {
      setToast({ type: "success", message: `Replayed ${id}` });
      await refresh();
      return;
    }

    if (result.status === 409 && result.data?.error === "already_emitted") {
      setToast({ type: "info", message: `Already emitted (skipped): ${id}` });
      return;
    }

    setToast({ type: "error", message: result.text || "Replay failed." });
  }

  async function handleEmailRetry(
    event: MouseEvent<HTMLButtonElement>,
    ingestion: EmailIngestionSummary
  ) {
    event.stopPropagation();
    setRetryingEmailIds((previous) => new Set(previous).add(ingestion.id));
    setToast(null);
    const result = await retryEmailIngestion(ingestion);
    setRetryingEmailIds((previous) => {
      const next = new Set(previous);
      next.delete(ingestion.id);
      return next;
    });
    if (result.ok) {
      setToast({
        type: "success",
        message: `Email processing queued again: ${ingestion.subject || ingestion.id}`,
      });
      await refresh();
    } else {
      setToast({ type: "error", message: result.text || "Email retry failed." });
    }
  }

  return (
    <section className={stylex(styles.panel)}>
      <h2>Ingest</h2>
      <div className={stylex(styles.actions)}>
        <button
          type="button"
          className={stylex(styles.viewButton, view === "email" && styles.viewButtonActive)}
          onClick={() => setView("email")}
        >
          Email processing
        </button>
        <button
          type="button"
          className={stylex(styles.viewButton, view === "webhooks" && styles.viewButtonActive)}
          onClick={() => setView("webhooks")}
        >
          Webhook requests
        </button>
      </div>
      <div className={stylex(styles.actions)}>
        {view === "email" ? (
          <select value={emailStatus} onChange={(event) => setEmailStatus(event.target.value)}>
            {EMAIL_STATUSES.map((item) => (
              <option key={item} value={item}>
                {item === "attention" ? "Needs attention" : item.replace("_", " ")}
              </option>
            ))}
          </select>
        ) : (
          <>
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
          </>
        )}
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

      {view === "email" && emailIngestions.length > 0 && emailStatus === "attention" && (
        <div className={stylex(styles.alert)}>
          {emailIngestions.length} email{emailIngestions.length === 1 ? "" : "s"} need attention.
          Select an email to inspect the recorded failure.
          {latestRetryableEmail && (
            <div className={stylex(styles.actions)}>
              <button
                type="button"
                className={stylex(styles.replayButton)}
                disabled={retryingEmailIds.has(latestRetryableEmail.id)}
                onClick={(event) => handleEmailRetry(event, latestRetryableEmail)}
              >
                {retryingEmailIds.has(latestRetryableEmail.id)
                  ? "Retrying latest email..."
                  : `Retry latest failed email: ${latestRetryableEmail.subject || "No subject"}`}
              </button>
            </div>
          )}
        </div>
      )}

      {error && <div className={stylex(styles.error)}>{error}</div>}
      {toast && (
        <div
          className={stylex(
            styles.toast,
            toast.type === "success" && styles.toastSuccess,
            toast.type === "error" && styles.toastError
          )}
        >
          {toast.message}
        </div>
      )}

      {view === "email" ? (
        <div className={stylex(styles.layout)}>
          <div className={stylex(styles.list)}>
            <table>
              <thead>
                <tr>
                  <th>received</th>
                  <th>status</th>
                  <th>actions</th>
                  <th>sender</th>
                  <th>customer</th>
                  <th>subject</th>
                  <th>messages</th>
                  <th>notes</th>
                  <th>attachments</th>
                  <th>failure reason</th>
                </tr>
              </thead>
              <tbody>
                {emailIngestions.map((ingestion) => (
                  <tr key={ingestion.id} onClick={() => setSelectedEmail(ingestion)}>
                    <td>{ingestion.received_at}</td>
                    <td className={stylex(styles.status)}>{ingestion.status.replace("_", " ")}</td>
                    <td className={stylex(styles.actionsCell)}>
                      {ingestion.status === "failed" && ingestion.customer_id ? (
                        <button
                          type="button"
                          className={stylex(styles.replayButton)}
                          disabled={retryingEmailIds.has(ingestion.id)}
                          onClick={(event) => handleEmailRetry(event, ingestion)}
                        >
                          {retryingEmailIds.has(ingestion.id) ? "Retrying..." : "Retry"}
                        </button>
                      ) : ingestion.status === "needs_match" ? (
                        "Match customer"
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>{ingestion.original_sender_email ?? ingestion.forwarding_email}</td>
                    <td>{ingestion.customer_display_name ?? "Not matched"}</td>
                    <td>{ingestion.subject ?? "-"}</td>
                    <td>{ingestion.message_count}</td>
                    <td>
                      {ingestion.applied_candidate_count}/{ingestion.candidate_count}
                    </td>
                    <td>{ingestion.attachment_count}</td>
                    <td className={stylex(styles.failureReason)}>
                      {ingestion.failure_reason ?? "-"}
                    </td>
                  </tr>
                ))}
                {emailIngestions.length === 0 && (
                  <tr>
                    <td colSpan={10} className={stylex(styles.empty)}>
                      No email processing records for this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className={stylex(styles.detail)}>
            {selectedEmail ? (
              <>
                <h3>Email processing detail</h3>
                {selectedEmail.status === "failed" && selectedEmail.customer_id && (
                  <button
                    type="button"
                    className={stylex(styles.replayButton)}
                    disabled={retryingEmailIds.has(selectedEmail.id)}
                    onClick={(event) => handleEmailRetry(event, selectedEmail)}
                  >
                    {retryingEmailIds.has(selectedEmail.id) ? "Retrying..." : "Retry processing"}
                  </button>
                )}
                <pre>{JSON.stringify(selectedEmail, null, 2)}</pre>
              </>
            ) : (
              <p className={stylex(styles.muted)}>
                Select an email to inspect its processing details.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className={stylex(styles.layout)}>
          <div className={stylex(styles.list)}>
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
                  <th>actions</th>
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
                    <td className={stylex(styles.actionsCell)}>
                      <button
                        type="button"
                        className={stylex(
                          styles.replayButton,
                          replayingIds.has(request.id) && styles.replayButtonDisabled
                        )}
                        onClick={(event) => handleReplay(event, request.id)}
                        disabled={replayingIds.has(request.id)}
                      >
                        {replayingIds.has(request.id) ? "Replaying..." : "Replay"}
                      </button>
                    </td>
                  </tr>
                ))}
                {requests.length === 0 && (
                  <tr>
                    <td colSpan={11} className={stylex(styles.empty)}>
                      No requests.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className={stylex(styles.detail)}>
            {selected ? (
              <>
                <h3>Request Detail</h3>
                <pre>{JSON.stringify(selected, null, 2)}</pre>
              </>
            ) : (
              <p className={stylex(styles.muted)}>Select a request to inspect.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
