"use client";

import { useCallback, useEffect, useState } from "react";
import stylex from "~/lib/stylex";
import { colors, radius } from "../../theme/tokens.stylex";
import {
  createIntegration,
  deleteIntegration,
  listIntegrations,
  updateIntegration,
  type IntegrationRow,
  qboBootstrap,
  qboConnectUrl,
  qboDisconnect,
  qboStatus,
  syncQuoConversations,
  type QboConnectionStatus,
} from "./api";
import type { WorkspaceRow } from "../workspaces/api";

type IntegrationsPanelProps = {
  workspaceId: string | null;
  workspaces: WorkspaceRow[];
};

const PROVIDERS = [
  { value: "shopify", label: "Shopify" },
  { value: "qbo", label: "QuickBooks" },
  { value: "quo", label: "Quo" },
  { value: "website", label: "Website intake" },
];
const ENVIRONMENTS = ["sandbox", "production"];

const styles = stylex.create({
  panel: {
    padding: "24px 32px",
  },
  muted: {
    color: colors.textSubtle,
  },
  panelSub: {
    marginTop: "16px",
  },
  formGrid: {
    display: "grid",
    gap: "12px",
  },
  formRow: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  credentialInput: {
    width: "100%",
    boxSizing: "border-box",
    fontFamily: "monospace",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "10px",
  },
  error: {
    color: colors.errorText,
  },
  tableWrap: {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    overflowX: "auto",
  },
  secondaryButton: {
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.surface,
    color: colors.text,
    padding: "6px 10px",
    borderRadius: radius.sm,
    cursor: "pointer",
    marginLeft: "6px",
  },
  dangerButton: {
    border: `1px solid ${colors.errorText}`,
    backgroundColor: colors.errorBg,
    color: colors.errorText,
    padding: "6px 10px",
    borderRadius: radius.sm,
    cursor: "pointer",
    marginLeft: "6px",
  },
});

export function IntegrationsPanel({ workspaceId, workspaces }: IntegrationsPanelProps) {
  const [integrations, setIntegrations] = useState<IntegrationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [issuedCredential, setIssuedCredential] = useState<{
    id: string;
    domain: string;
    value: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [domainUpdate, setDomainUpdate] = useState<Record<string, string>>({});
  useEffect(() => {
    setIssuedCredential(null);
    setCopied(false);
  }, [workspaceId]);

  const [error, setError] = useState<string | null>(null);

  const [provider, setProvider] = useState<"shopify" | "qbo" | "quo" | "website">("shopify");
  const [environment, setEnvironment] = useState<"sandbox" | "production">("production");
  const [externalAccountId, setExternalAccountId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [quoWebhookSecret, setQuoWebhookSecret] = useState("");
  const [secretUpdate, setSecretUpdate] = useState<Record<string, string>>({});
  const [quoWebhookSecretUpdate, setQuoWebhookSecretUpdate] = useState<Record<string, string>>({});
  const [qboConnections, setQboConnections] = useState<QboConnectionStatus[]>([]);
  const [syncingQuoId, setSyncingQuoId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await listIntegrations(workspaceId);
    if (result.ok) {
      setIntegrations(result.data ?? []);
    } else {
      setError(result.text || "Failed to load integrations.");
    }
    if (workspaceId) {
      const status = await qboStatus(workspaceId);
      if (status.ok) setQboConnections(status.data ?? []);
    }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submitIntegration() {
    if (!workspaceId) {
      setError("Select a workspace first.");
      return;
    }
    const secrets =
      provider === "shopify"
        ? { webhookSecret: secretValue }
        : provider === "qbo"
          ? { webhookVerifierToken: secretValue }
          : provider === "website"
            ? undefined
            : { apiKey: secretValue, webhookSigningSecret: quoWebhookSecret };
    setSaving(true);
    setError(null);
    let result;
    try {
      result = await createIntegration({
        workspaceId,
        provider,
        environment: provider === "quo" ? "production" : environment,
        ...(provider === "website"
          ? { sourceDomain: externalAccountId }
          : { externalAccountId: provider === "quo" ? workspaceId : externalAccountId }),
        displayName,
        secrets,
      });
    } catch {
      setSaving(false);
      setError("Could not save the integration. Try again.");
      return;
    }
    setSaving(false);
    if (!result.ok) {
      setError(result.text || "Failed to create integration.");
      return;
    }
    if (result.data?.intakeCredential) {
      setIssuedCredential({
        id: result.data.id,
        domain: result.data.external_account_id,
        value: result.data.intakeCredential,
      });
      setCopied(false);
    }
    setExternalAccountId("");
    setDisplayName("");
    setSecretValue("");
    setQuoWebhookSecret("");
    await refresh();
  }

  async function regenerateCredential(integration: IntegrationRow) {
    setRotatingId(integration.id);
    setIssuedCredential(null);
    setError(null);
    try {
      const result = await updateIntegration(integration.id, { regenerateCredential: true });
      if (!result.ok || !result.data?.intakeCredential) {
        setError(result.text || "Could not generate a new credential.");
        return;
      }
      setIssuedCredential({
        id: integration.id,
        domain: result.data.external_account_id,
        value: result.data.intakeCredential,
      });
      setCopied(false);
    } catch {
      setError("Could not generate a new credential. Try again.");
    } finally {
      setRotatingId(null);
    }
  }
  async function saveDomain(integration: IntegrationRow) {
    const result = await updateIntegration(integration.id, {
      sourceDomain: domainUpdate[integration.id],
    });
    if (!result.ok) {
      setError(result.text || "Could not save the website domain.");
      return;
    }
    setDomainUpdate((prev) => {
      const next = { ...prev };
      delete next[integration.id];
      return next;
    });
    await refresh();
  }

  async function toggleActive(integration: IntegrationRow) {
    const result = await updateIntegration(integration.id, {
      is_active: integration.is_active ? 0 : 1,
    });
    if (!result.ok) setError(result.text || "Failed to update integration.");
    await refresh();
  }

  async function saveSecrets(integration: IntegrationRow) {
    if (integration.provider === "website") return;
    const next = secretUpdate[integration.id]?.trim();
    const nextQuoWebhookSecret = quoWebhookSecretUpdate[integration.id]?.trim();
    if (!next && !nextQuoWebhookSecret) return;
    const secrets =
      integration.provider === "shopify"
        ? { webhookSecret: next }
        : integration.provider === "qbo"
          ? { webhookVerifierToken: next }
          : {
              ...(next ? { apiKey: next } : {}),
              ...(nextQuoWebhookSecret ? { webhookSigningSecret: nextQuoWebhookSecret } : {}),
            };
    const result = await updateIntegration(integration.id, { secrets });
    if (!result.ok) {
      setError(result.text || "Failed to replace integration secret.");
      return;
    }
    setSecretUpdate((prev) => ({ ...prev, [integration.id]: "" }));
    setQuoWebhookSecretUpdate((prev) => ({ ...prev, [integration.id]: "" }));
    await refresh();
  }

  async function removeIntegration(id: string) {
    const result = await deleteIntegration(id);
    if (!result.ok) setError(result.text || "Failed to delete integration.");
    await refresh();
  }

  function connectQbo() {
    if (!workspaceId) return setError("Select a workspace first.");
    window.location.assign(qboConnectUrl(workspaceId, environment));
  }

  async function disconnectQbo(id: string) {
    if (!workspaceId) return;
    const result = await qboDisconnect(workspaceId, id);
    if (!result.ok) setError(result.text || "Failed to disconnect QuickBooks.");
    await refresh();
  }

  async function bootstrapQbo(id: string) {
    if (!workspaceId) return;
    const result = await qboBootstrap(workspaceId, id);
    if (!result.ok) setError(result.text || "Failed to start bootstrap import.");
    await refresh();
  }

  async function syncQuo(id: string) {
    setSyncingQuoId(id);
    setError(null);
    const result = await syncQuoConversations(id);
    if (!result.ok) setError(result.text || "Failed to sync Quo conversations.");
    setSyncingQuoId(null);
    await refresh();
  }

  return (
    <section className={stylex(styles.panel)}>
      <h2>Integrations</h2>
      <p className={stylex(styles.muted)}>
        Webhook endpoints:
        <br />
        Shopify: <code>https://api.from-trees.com/ingest/shopify/webhook?env=production</code>
        <br />
        QBO: <code>https://api.from-trees.com/ingest/qbo/webhook?env=production</code>
        <br />
        Quo: shown per integration below (the URL includes its non-secret integration ID)
      </p>

      <div className={stylex(styles.panelSub)}>
        <h3>QuickBooks connection</h3>
        <div className={stylex(styles.actions)}>
          <select
            value={environment}
            onChange={(event) => setEnvironment(event.target.value as "sandbox" | "production")}
          >
            {ENVIRONMENTS.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <button type="button" onClick={connectQbo}>
            Connect or reconnect QuickBooks
          </button>
        </div>
        {qboConnections.length === 0 && (
          <p className={stylex(styles.muted)}>QuickBooks is disconnected.</p>
        )}
        {qboConnections.map((connection) => (
          <div key={connection.id} className={stylex(styles.panelSub)}>
            <strong>{connection.connection_status}</strong> · {connection.environment} · realm{" "}
            {connection.external_account_id}
            <p>
              Token health: {connection.token_health} · Last sync:{" "}
              {connection.last_successful_sync_at ?? "Never"}
            </p>
            {connection.connection_error && (
              <p className={stylex(styles.error)}>{connection.connection_error}</p>
            )}
            {connection.bootstrap_status && (
              <p>
                Bootstrap: {connection.bootstrap_status} · {connection.entity_type} at{" "}
                {connection.start_position} · {connection.imported_count} imported
                {connection.bootstrap_error ? ` · ${connection.bootstrap_error}` : ""}
              </p>
            )}
            <div className={stylex(styles.actions)}>
              <button
                type="button"
                onClick={() => bootstrapQbo(connection.id)}
                disabled={!connection.is_active}
              >
                Start or resume bootstrap
              </button>
              <button
                type="button"
                className={stylex(styles.dangerButton)}
                onClick={() => disconnectQbo(connection.id)}
              >
                Disconnect
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className={stylex(styles.panelSub)}>
        <h3>Create Integration</h3>
        <div className={stylex(styles.formGrid)}>
          <div className={stylex(styles.formRow)}>
            <label>Workspace</label>
            <select value={workspaceId ?? ""} onChange={() => undefined} disabled>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </div>
          {provider === "quo" && (
            <div className={stylex(styles.formRow)}>
              <label>Quo webhook signing secret</label>
              <input
                type="password"
                value={quoWebhookSecret}
                onChange={(event) => setQuoWebhookSecret(event.target.value)}
                placeholder="Base64 signing secret from Quo"
              />
            </div>
          )}
          <div className={stylex(styles.formRow)}>
            <label>Provider</label>
            <select
              value={provider}
              onChange={(event) =>
                setProvider(event.target.value as "shopify" | "qbo" | "quo" | "website")
              }
            >
              {PROVIDERS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          {provider !== "quo" && (
            <>
              <div className={stylex(styles.formRow)}>
                <label>Environment</label>
                <select
                  value={environment}
                  onChange={(event) =>
                    setEnvironment(event.target.value as "sandbox" | "production")
                  }
                >
                  {ENVIRONMENTS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              <div className={stylex(styles.formRow)}>
                <label>
                  {provider === "website" ? "Source website domain" : "External account ID"}
                </label>
                <input
                  aria-label={
                    provider === "website" ? "Source website domain" : "External account ID"
                  }
                  value={externalAccountId}
                  onChange={(event) => setExternalAccountId(event.target.value)}
                  placeholder={
                    provider === "shopify"
                      ? "shop.myshopify.com"
                      : provider === "website"
                        ? "example.com"
                        : "realmId"
                  }
                />
              </div>
            </>
          )}
          <div className={stylex(styles.formRow)}>
            <label>Display name</label>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Optional label"
            />
          </div>
          {provider !== "website" && (
            <div className={stylex(styles.formRow)}>
              <label>
                {provider === "shopify"
                  ? "Webhook secret"
                  : provider === "qbo"
                    ? "Webhook verifier token"
                    : "Quo API key"}
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={secretValue}
                onChange={(event) => setSecretValue(event.target.value)}
                placeholder={provider === "quo" ? "Quo API key" : "Secret"}
              />
            </div>
          )}
        </div>
        <div className={stylex(styles.actions)}>
          <button
            type="button"
            onClick={submitIntegration}
            disabled={saving || rotatingId !== null}
          >
            {saving ? "Saving…" : "Save integration"}
          </button>
        </div>
        {error && <div className={stylex(styles.error)}>{error}</div>}
      </div>

      {issuedCredential && (
        <section className={stylex(styles.panelSub)} aria-label="Website intake credential">
          <h3>Credential for {issuedCredential.domain}</h3>
          <p>
            Copy this credential into your website’s server settings. It is shown only here; ftops
            does not display it again after you leave this page.
          </p>
          <input
            className={stylex(styles.credentialInput)}
            aria-label="Generated intake credential"
            readOnly
            value={issuedCredential.value}
          />
          <div className={stylex(styles.actions)}>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(issuedCredential.value);
                  setCopied(true);
                } catch {
                  setError("Could not copy automatically. Select and copy the credential above.");
                }
              }}
            >
              {copied ? "Copied" : "Copy credential"}
            </button>
            <button type="button" onClick={() => setIssuedCredential(null)}>
              Dismiss
            </button>
          </div>
          <p>
            Intake endpoint: <code>{`/website-intake/${issuedCredential.id}`}</code>
          </p>
        </section>
      )}
      <div className={stylex(styles.panelSub)}>
        <h3>Existing Integrations</h3>
        {loading && <p className={stylex(styles.muted)}>Loading...</p>}
        {integrations.length === 0 && !loading && <p className={stylex(styles.muted)}>None yet.</p>}
        <div className={stylex(styles.tableWrap)}>
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Env</th>
                <th>Account / website</th>
                <th>Name</th>
                <th>Active</th>
                <th>Secrets</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {integrations.map((integration) => (
                <tr key={integration.id}>
                  <td>{integration.provider}</td>
                  <td>{integration.environment}</td>
                  <td>
                    {integration.provider === "website" ? (
                      <>
                        <input
                          aria-label={`Source website domain for ${integration.external_account_id}`}
                          value={domainUpdate[integration.id] ?? integration.external_account_id}
                          onChange={(event) =>
                            setDomainUpdate((prev) => ({
                              ...prev,
                              [integration.id]: event.target.value,
                            }))
                          }
                        />
                        <button
                          type="button"
                          disabled={
                            domainUpdate[integration.id] === undefined ||
                            domainUpdate[integration.id] === integration.external_account_id
                          }
                          onClick={() => saveDomain(integration)}
                        >
                          Save domain
                        </button>
                      </>
                    ) : (
                      integration.external_account_id
                    )}
                  </td>
                  <td>{integration.display_name ?? "-"}</td>
                  <td>{integration.is_active ? "yes" : "no"}</td>
                  <td>
                    {integration.provider !== "website" && (
                      <input
                        value={secretUpdate[integration.id] ?? ""}
                        onChange={(event) =>
                          setSecretUpdate((prev) => ({
                            ...prev,
                            [integration.id]: event.target.value,
                          }))
                        }
                        placeholder={
                          integration.provider === "quo" ? "Replace API key" : "Replace secret"
                        }
                      />
                    )}
                    {integration.provider === "website" && (
                      <div>
                        <code>{`/website-intake/${integration.id}`}</code>
                      </div>
                    )}
                    {integration.provider === "quo" && (
                      <>
                        <br />
                        <input
                          type="password"
                          value={quoWebhookSecretUpdate[integration.id] ?? ""}
                          onChange={(event) =>
                            setQuoWebhookSecretUpdate((prev) => ({
                              ...prev,
                              [integration.id]: event.target.value,
                            }))
                          }
                          placeholder="Replace webhook signing secret"
                        />
                        <br />
                        <small>
                          <code>{`https://api.from-trees.com/ingest/quo/${integration.id}/webhook`}</code>
                        </small>
                        <br />
                        <small>
                          Conversation sync:{" "}
                          {integration.quo_conversations_sync_error
                            ? `Error: ${integration.quo_conversations_sync_error}`
                            : (integration.quo_conversations_last_synced_at ?? "Not run yet")}
                        </small>
                      </>
                    )}
                  </td>
                  <td>
                    {integration.provider === "website" ? (
                      <>
                        <button
                          type="button"
                          disabled={saving || rotatingId !== null}
                          onClick={() => regenerateCredential(integration)}
                        >
                          {rotatingId === integration.id
                            ? "Generating…"
                            : "Generate new credential"}
                        </button>
                        <small>
                          Replaces the current credential immediately. Update your website’s server
                          settings afterward.
                        </small>
                      </>
                    ) : (
                      <button type="button" onClick={() => saveSecrets(integration)}>
                        Save secret
                      </button>
                    )}
                    <button
                      type="button"
                      className={stylex(styles.secondaryButton)}
                      onClick={() => toggleActive(integration)}
                    >
                      {integration.is_active ? "Disable" : "Enable"}
                    </button>
                    {integration.provider === "quo" && (
                      <button
                        type="button"
                        className={stylex(styles.secondaryButton)}
                        disabled={!integration.is_active || syncingQuoId === integration.id}
                        onClick={() => syncQuo(integration.id)}
                      >
                        {syncingQuoId === integration.id ? "Syncing…" : "Sync conversations"}
                      </button>
                    )}
                    <button
                      type="button"
                      className={stylex(styles.dangerButton)}
                      onClick={() => removeIntegration(integration.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
