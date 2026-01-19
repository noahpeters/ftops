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
} from "./api";
import type { WorkspaceRow } from "../workspaces/api";

type IntegrationsPanelProps = {
  workspaceId: string | null;
  workspaces: WorkspaceRow[];
};

const PROVIDERS = [
  { value: "shopify", label: "Shopify" },
  { value: "qbo", label: "QuickBooks" },
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
  const [error, setError] = useState<string | null>(null);

  const [provider, setProvider] = useState<"shopify" | "qbo">("shopify");
  const [environment, setEnvironment] = useState<"sandbox" | "production">("production");
  const [externalAccountId, setExternalAccountId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [secretUpdate, setSecretUpdate] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await listIntegrations(workspaceId);
    if (result.ok) {
      setIntegrations(result.data ?? []);
    } else {
      setError(result.text || "Failed to load integrations.");
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
        : { webhookVerifierToken: secretValue };
    const result = await createIntegration({
      workspaceId,
      provider,
      environment,
      externalAccountId,
      displayName,
      secrets,
    });
    if (!result.ok) {
      setError(result.text || "Failed to create integration.");
      return;
    }
    setExternalAccountId("");
    setDisplayName("");
    setSecretValue("");
    await refresh();
  }

  async function toggleActive(integration: IntegrationRow) {
    await updateIntegration(integration.id, { is_active: integration.is_active ? 0 : 1 });
    await refresh();
  }

  async function saveSecrets(integration: IntegrationRow) {
    const next = secretUpdate[integration.id]?.trim();
    if (!next) return;
    const secrets =
      integration.provider === "shopify" ? { webhookSecret: next } : { webhookVerifierToken: next };
    await updateIntegration(integration.id, { secrets });
    setSecretUpdate((prev) => ({ ...prev, [integration.id]: "" }));
    await refresh();
  }

  async function removeIntegration(id: string) {
    await deleteIntegration(id);
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
      </p>

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
          <div className={stylex(styles.formRow)}>
            <label>Provider</label>
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value as "shopify" | "qbo")}
            >
              {PROVIDERS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className={stylex(styles.formRow)}>
            <label>Environment</label>
            <select
              value={environment}
              onChange={(event) => setEnvironment(event.target.value as "sandbox" | "production")}
            >
              {ENVIRONMENTS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div className={stylex(styles.formRow)}>
            <label>External account ID</label>
            <input
              value={externalAccountId}
              onChange={(event) => setExternalAccountId(event.target.value)}
              placeholder={provider === "shopify" ? "shop.myshopify.com" : "realmId"}
            />
          </div>
          <div className={stylex(styles.formRow)}>
            <label>Display name</label>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Optional label"
            />
          </div>
          <div className={stylex(styles.formRow)}>
            <label>{provider === "shopify" ? "Webhook secret" : "Webhook verifier token"}</label>
            <input
              value={secretValue}
              onChange={(event) => setSecretValue(event.target.value)}
              placeholder="Secret"
            />
          </div>
        </div>
        <div className={stylex(styles.actions)}>
          <button type="button" onClick={submitIntegration}>
            Save integration
          </button>
        </div>
        {error && <div className={stylex(styles.error)}>{error}</div>}
      </div>

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
                <th>Account</th>
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
                  <td>{integration.external_account_id}</td>
                  <td>{integration.display_name ?? "-"}</td>
                  <td>{integration.is_active ? "yes" : "no"}</td>
                  <td>
                    <input
                      value={secretUpdate[integration.id] ?? ""}
                      onChange={(event) =>
                        setSecretUpdate((prev) => ({
                          ...prev,
                          [integration.id]: event.target.value,
                        }))
                      }
                      placeholder="Replace secret"
                    />
                  </td>
                  <td>
                    <button type="button" onClick={() => saveSecrets(integration)}>
                      Save secret
                    </button>
                    <button
                      type="button"
                      className={stylex(styles.secondaryButton)}
                      onClick={() => toggleActive(integration)}
                    >
                      {integration.is_active ? "Disable" : "Enable"}
                    </button>
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
