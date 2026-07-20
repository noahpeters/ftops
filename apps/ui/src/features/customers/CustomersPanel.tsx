"use client";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import stylex from "~/lib/stylex";
import { colors, radius } from "../../theme/tokens.stylex";
import {
  addNote,
  createCustomer,
  getCustomer,
  listCustomers,
  qboAction,
  qboSearch,
  type CustomerDetail,
  type CustomerSummary,
} from "./api";

const styles = stylex.create({
  panel: { padding: "24px 32px" },
  toolbar: { display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" },
  layout: { display: "grid", gridTemplateColumns: "minmax(280px, 35%) 1fr", gap: "16px" },
  card: {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: "14px",
  },
  list: { listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "8px" },
  item: {
    width: "100%",
    textAlign: "left",
    padding: "10px",
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    cursor: "pointer",
  },
  active: { borderColor: colors.accent },
  muted: { color: colors.textSubtle, fontSize: "13px" },
  error: { color: colors.errorText },
  badge: {
    display: "inline-block",
    padding: "2px 7px",
    borderRadius: "999px",
    backgroundColor: colors.neutralBg,
    fontSize: "12px",
    marginRight: "6px",
  },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "12px" },
  section: { borderTop: `1px solid ${colors.border}`, paddingTop: "12px", marginTop: "16px" },
  table: { width: "100%", borderCollapse: "collapse" },
  cell: { padding: "7px", borderBottom: `1px solid ${colors.border}`, textAlign: "left" },
  actions: { display: "flex", gap: "8px", flexWrap: "wrap" },
});

export function CustomersPanel({
  workspaceId,
  customerId,
}: {
  workspaceId: string | null;
  customerId?: string;
}) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<CustomerSummary[]>([]);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sync, setSync] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [integrationId, setIntegrationId] = useState("");
  const [matches, setMatches] = useState<Array<{ id: string; displayName: string }>>([]);
  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    const result = await listCustomers(workspaceId, { search, status, sync });
    if (result.ok) setRows(result.data ?? []);
    else setError(result.text);
  }, [workspaceId, search, status, sync]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!customerId) {
      setDetail(null);
      return;
    }
    void getCustomer(customerId).then((r) => {
      if (r.ok) setDetail(r.data);
      else setError(r.text);
    });
  }, [customerId]);
  async function create() {
    if (!workspaceId) return;
    const displayName = prompt("Customer display name");
    if (!displayName) return;
    const r = await createCustomer({ workspaceId, displayName, status: "lead" });
    if (r.ok && r.data) {
      await refresh();
      navigate(`/customers/${r.data.customer.id}`);
    } else setError(r.text);
  }
  async function note() {
    if (!customerId) return;
    const body = prompt("Internal note");
    if (!body) return;
    const r = await addNote(customerId, { subject: "Note", body });
    if (r.ok) {
      const loaded = await getCustomer(customerId);
      if (loaded.ok) setDetail(loaded.data);
    } else setError(r.text);
  }
  async function action(name: string, extra: Record<string, unknown> = {}) {
    if (!customerId || !integrationId) return setError("Enter the QuickBooks integration ID.");
    const r = await qboAction(customerId, name, { integrationId, ...extra });
    if (r.ok) setDetail(r.data);
    else setError((r.data as { error?: string } | null)?.error || r.text);
  }
  async function findMatches() {
    if (!customerId || !integrationId) return setError("Enter the QuickBooks integration ID.");
    const r = await qboSearch(customerId, integrationId, detail?.customer.display_name || "");
    if (r.ok) setMatches((r.data ?? []) as Array<{ id: string; displayName: string }>);
    else setError(r.text);
  }
  return (
    <section className={stylex(styles.panel)}>
      <h2>Customers</h2>
      <div className={stylex(styles.toolbar)}>
        <input
          aria-label="Search customers"
          placeholder="Search name, email, company, phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Customer status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {["lead", "prospect", "active", "past", "archived"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select
          aria-label="QuickBooks sync state"
          value={sync}
          onChange={(e) => setSync(e.target.value)}
        >
          <option value="">All sync states</option>
          {["not_linked", "linked", "error", "conflict", "pending_refresh"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <button onClick={create}>Create customer</button>
      </div>
      {error && <p className={stylex(styles.error)}>{error}</p>}
      <div className={stylex(styles.layout)}>
        <div className={stylex(styles.card)}>
          <ul className={stylex(styles.list)}>
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  className={stylex(styles.item, row.id === customerId && styles.active)}
                  onClick={() => navigate(`/customers/${row.id}`)}
                >
                  <strong>{row.display_name}</strong>
                  <div>{row.company_name}</div>
                  <div className={stylex(styles.muted)}>
                    {row.primary_contact} · {row.email || row.phone}
                  </div>
                  <span className={stylex(styles.badge)}>{row.status}</span>
                  <span className={stylex(styles.badge)}>QBO: {row.quickbooks_sync_status}</span>
                  <div className={stylex(styles.muted)}>
                    {row.open_estimate_count} open estimates · $
                    {Number(row.open_invoice_balance || 0).toFixed(2)} due
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className={stylex(styles.card)}>
          {!detail ? (
            <p className={stylex(styles.muted)}>Select a customer.</p>
          ) : (
            <>
              <h3>{detail.customer.display_name}</h3>
              <div className={stylex(styles.grid)}>
                <div>
                  <b>ftops-owned</b>
                  <p>Status: {detail.customer.status}</p>
                  <p>Company: {detail.customer.company_name || "—"}</p>
                  <p>Lead source: {detail.customer.lead_source || "—"}</p>
                  <p>Notes: {detail.customer.notes || "—"}</p>
                </div>
                <div>
                  <b>QuickBooks-sourced</b>
                  <p>State: {detail.customer.quickbooks_sync_status}</p>
                  <p>Last sync: {detail.customer.last_synced_at || "Never"}</p>
                  {detail.customer.last_error && (
                    <p className={stylex(styles.error)}>{detail.customer.last_error}</p>
                  )}
                </div>
              </div>
              <div className={stylex(styles.section)}>
                <h4>Contacts</h4>
                {detail.contacts.map((x) => (
                  <p key={String(x.id)}>
                    {String(x.display_name)} · {String(x.email || "")} · {String(x.phone || "")}
                  </p>
                ))}
              </div>
              <div className={stylex(styles.section)}>
                <h4>Addresses</h4>
                {detail.addresses.map((x) => (
                  <p key={String(x.id)}>
                    {String(x.address_type)}: {String(x.line1 || "")}, {String(x.city || "")}
                  </p>
                ))}
              </div>
              <div className={stylex(styles.section)}>
                <h4>Activity</h4>
                <button onClick={note}>Add note</button>
                {detail.activities.map((x) => (
                  <p key={x.id}>
                    <b>{x.subject}</b>{" "}
                    <span className={stylex(styles.muted)}>
                      {x.created_by ? `by ${x.created_by} · ` : ""}
                      {x.occurred_at}
                    </span>
                    <br />
                    {x.body || ""}
                  </p>
                ))}
              </div>
              <Financial title="Estimates" rows={detail.estimates} />
              <Financial title="Invoices" rows={detail.invoices} />
              <div className={stylex(styles.section)}>
                <h4>QuickBooks synchronization</h4>
                <input
                  placeholder="Integration ID"
                  value={integrationId}
                  onChange={(e) => setIntegrationId(e.target.value)}
                />
                <div className={stylex(styles.actions)}>
                  <button onClick={findMatches}>Find matches</button>
                  <button onClick={() => action("create")}>Create in QuickBooks</button>
                  <button onClick={() => action("refresh")}>Refresh</button>
                  <button onClick={() => action("retry")}>Retry failed sync</button>
                </div>
                {matches.map((m) => (
                  <p key={m.id}>
                    {m.displayName}{" "}
                    <button onClick={() => action("link", { externalId: m.id })}>
                      Confirm link
                    </button>
                  </p>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
function Financial({ title, rows }: { title: string; rows: Array<Record<string, unknown>> }) {
  return (
    <div className={stylex(styles.section)}>
      <h4>
        {title} <small>(read-only from QuickBooks)</small>
      </h4>
      <table className={stylex(styles.table)}>
        <thead>
          <tr>
            <th className={stylex(styles.cell)}>Number</th>
            <th className={stylex(styles.cell)}>Status</th>
            <th className={stylex(styles.cell)}>Total</th>
            <th className={stylex(styles.cell)}>Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={String(x.id)}>
              <td className={stylex(styles.cell)}>{String(x.doc_number || "—")}</td>
              <td className={stylex(styles.cell)}>{String(x.status || "—")}</td>
              <td className={stylex(styles.cell)}>${Number(x.total || 0).toFixed(2)}</td>
              <td className={stylex(styles.cell)}>
                {x.balance == null ? "—" : `$${Number(x.balance).toFixed(2)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
