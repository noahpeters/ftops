"use client";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import Markdown from "react-markdown";
import stylex from "~/lib/stylex";
import { buildUrl } from "@/lib/api";
import { colors, radius } from "../../theme/tokens.stylex";
import {
  addContact,
  addNote,
  addOpportunity,
  archiveContact,
  createCustomer,
  getCustomer,
  getCustomerFileDownload,
  initCustomerFileUpload,
  listCustomers,
  completeCustomerFileUpload,
  qboAction,
  qboSearch,
  updateContact,
  updateCustomer,
  updateOpportunity,
  setCustomerFileDeprecated,
  type Contact,
  type CustomerDetail,
  type CustomerSummary,
  type Opportunity,
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
  form: { display: "grid", gap: "8px", padding: "12px 0" },
  check: { display: "flex", gap: "6px", alignItems: "center" },
  contact: { borderBottom: `1px solid ${colors.border}`, padding: "10px 0" },
  textarea: { minHeight: "120px", resize: "vertical", font: "inherit" },
  note: { borderBottom: `1px solid ${colors.border}`, padding: "10px 0" },
  markdown: { lineHeight: 1.5 },
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
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [creatingContact, setCreatingContact] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [creatingNote, setCreatingNote] = useState(false);
  const [creatingOpportunity, setCreatingOpportunity] = useState(false);
  const [editingOpportunityId, setEditingOpportunityId] = useState<string | null>(null);
  const [uploadingActivityId, setUploadingActivityId] = useState<string | null>(null);
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
  async function saveCustomer(input: CustomerInput) {
    if (!customerId) return;
    const r = await updateCustomer(customerId, input);
    if (r.ok && r.data) {
      setDetail(r.data);
      setEditingCustomer(false);
      await refresh();
    } else setError((r.data as { error?: string } | null)?.error || r.text);
  }
  async function saveNote(input: {
    subject: string;
    body: string;
    followUpAt?: string;
    followUpDescription?: string;
  }) {
    if (!customerId) return;
    const r = await addNote(customerId, input);
    if (r.ok) {
      const loaded = await getCustomer(customerId);
      if (loaded.ok) {
        setDetail(loaded.data);
        setCreatingNote(false);
      }
    } else setError(r.text);
  }
  async function uploadNoteFile(activityId: string, file: File) {
    if (!customerId) return;
    if (file.size > 100 * 1024 * 1024) return setError("Files must be 100 MB or smaller.");
    setUploadingActivityId(activityId);
    setError(null);
    const contentType = file.type || "application/octet-stream";
    const initialized = await initCustomerFileUpload(customerId, {
      activityId,
      filename: file.name,
      contentType,
      sizeBytes: file.size,
    });
    if (!initialized.ok || !initialized.data) {
      setUploadingActivityId(null);
      return setError(initialized.text || "Could not start file upload.");
    }
    const uploadUrl = initialized.data.uploadUrl.startsWith("/")
      ? buildUrl(initialized.data.uploadUrl)
      : initialized.data.uploadUrl;
    const uploaded = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: file,
    });
    if (!uploaded.ok) {
      setUploadingActivityId(null);
      return setError("File upload failed.");
    }
    const completed = await completeCustomerFileUpload(customerId, {
      activityId,
      storageKey: initialized.data.storageKey,
      filename: file.name,
      contentType,
      sizeBytes: file.size,
    });
    setUploadingActivityId(null);
    if (!completed.ok) return setError(completed.text || "Could not finalize file upload.");
    await reloadDetail();
  }
  async function downloadCustomerFile(fileId: string) {
    const result = await getCustomerFileDownload(fileId);
    if (!result.ok || !result.data?.downloadUrl)
      return setError(result.text || "Could not prepare download.");
    window.location.assign(
      result.data.downloadUrl.startsWith("/")
        ? buildUrl(result.data.downloadUrl)
        : result.data.downloadUrl
    );
  }
  async function toggleFileDeprecated(fileId: string, deprecated: boolean) {
    const result = await setCustomerFileDeprecated(fileId, deprecated);
    if (!result.ok) return setError(result.text || "Could not update file.");
    await reloadDetail();
  }
  async function reloadDetail() {
    if (!customerId) return;
    const loaded = await getCustomer(customerId);
    if (loaded.ok) setDetail(loaded.data);
    else setError(loaded.text);
  }
  async function saveOpportunity(input: OpportunityInput, opportunityId?: string) {
    if (!customerId) return;
    const payload = { ...input, budgetCents: Math.round(input.budget * 100) };
    const r = opportunityId
      ? await updateOpportunity(customerId, opportunityId, payload)
      : await addOpportunity(customerId, payload);
    if (r.ok && r.data) {
      setDetail(r.data);
      setCreatingOpportunity(false);
      setEditingOpportunityId(null);
    } else setError((r.data as { error?: string } | null)?.error || r.text);
  }
  async function saveContact(input: ContactInput, contactId?: string) {
    if (!customerId) return;
    const r = contactId
      ? await updateContact(customerId, contactId, input)
      : await addContact(customerId, input);
    if (r.ok && r.data) {
      setDetail(r.data);
      setEditingContactId(null);
      setCreatingContact(false);
      await refresh();
    } else setError((r.data as { error?: string } | null)?.error || r.text);
  }
  async function removeContact(contact: Contact) {
    if (!customerId || !confirm(`Archive ${contact.display_name}?`)) return;
    const r = await archiveContact(customerId, contact.id);
    if (!r.ok) return setError(r.text);
    const loaded = await getCustomer(customerId);
    if (loaded.ok) setDetail(loaded.data);
    await refresh();
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
                  <div className={stylex(styles.muted)}>{followUpLabel(row.next_follow_up_at)}</div>
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
              <div className={stylex(styles.actions)}>
                <h3>{detail.customer.display_name}</h3>
                {!editingCustomer && (
                  <button onClick={() => setEditingCustomer(true)}>Edit customer</button>
                )}
              </div>
              <div className={stylex(styles.grid)}>
                <div>
                  <b>ftops-owned</b>
                  {editingCustomer ? (
                    <CustomerForm
                      customer={detail.customer}
                      onSave={saveCustomer}
                      onCancel={() => setEditingCustomer(false)}
                    />
                  ) : (
                    <>
                      <p>Status: {detail.customer.status}</p>
                      <p>Lead source: {detail.customer.lead_source || "—"}</p>
                      <p>{followUpLabel(detail.customer.next_follow_up_at)}</p>
                    </>
                  )}
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
                {!creatingContact && (
                  <button onClick={() => setCreatingContact(true)}>Add contact</button>
                )}
                {creatingContact && (
                  <ContactForm
                    onSave={(input) => saveContact(input)}
                    onCancel={() => setCreatingContact(false)}
                  />
                )}
                {detail.contacts.map((contact) =>
                  editingContactId === contact.id ? (
                    <ContactForm
                      key={contact.id}
                      contact={contact}
                      onSave={(input) => saveContact(input, contact.id)}
                      onCancel={() => setEditingContactId(null)}
                    />
                  ) : (
                    <div key={contact.id} className={stylex(styles.contact)}>
                      <b>{contact.display_name}</b>
                      {contact.is_primary ? " · Primary" : ""}
                      <div>
                        {contact.role || "Contact"} · {contact.status}
                      </div>
                      <div>
                        {contact.email || "No email"} · {contact.phone || "No phone"}
                      </div>
                      <div className={stylex(styles.actions)}>
                        <button onClick={() => setEditingContactId(contact.id)}>Edit</button>
                        {contact.status !== "archived" && (
                          <button onClick={() => removeContact(contact)}>Archive</button>
                        )}
                      </div>
                    </div>
                  )
                )}
              </div>
              <div className={stylex(styles.section)}>
                <h4>Opportunities</h4>
                {!creatingOpportunity && (
                  <button onClick={() => setCreatingOpportunity(true)}>Add opportunity</button>
                )}
                {creatingOpportunity && (
                  <OpportunityForm
                    onSave={(input) => saveOpportunity(input)}
                    onCancel={() => setCreatingOpportunity(false)}
                  />
                )}
                {detail.opportunities.map((opportunity) =>
                  editingOpportunityId === opportunity.id ? (
                    <OpportunityForm
                      key={opportunity.id}
                      opportunity={opportunity}
                      onSave={(input) => saveOpportunity(input, opportunity.id)}
                      onCancel={() => setEditingOpportunityId(null)}
                    />
                  ) : (
                    <article key={opportunity.id} className={stylex(styles.contact)}>
                      <b>{opportunity.description}</b>
                      <div>
                        {opportunity.opportunity_type} · {opportunity.status} ·{" "}
                        {formatBudget(opportunity.budget_cents)}
                      </div>
                      <button onClick={() => setEditingOpportunityId(opportunity.id)}>Edit</button>
                    </article>
                  )
                )}
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
                <h4>Follow-up tasks</h4>
                {detail.tasks.length === 0 && (
                  <p className={stylex(styles.muted)}>No customer tasks.</p>
                )}
                {detail.tasks.map((task) => (
                  <article key={task.id} className={stylex(styles.note)}>
                    <b>{task.title}</b>
                    <div className={stylex(styles.muted)}>
                      {task.status} · {task.due_at ? formatDateTime(task.due_at) : "No due date"}
                      {task.project_id ? " · Linked to project" : " · Customer-only"}
                    </div>
                    {task.description && <div>{task.description}</div>}
                  </article>
                ))}
              </div>
              <div className={stylex(styles.section)}>
                <h4>Files</h4>
                {detail.files.filter((file) => !file.deprecated_at).length === 0 && (
                  <p className={stylex(styles.muted)}>No current files.</p>
                )}
                {detail.files
                  .filter((file) => !file.deprecated_at)
                  .map((file) => (
                    <CustomerFileRow
                      key={file.id}
                      file={file}
                      onDownload={() => downloadCustomerFile(file.id)}
                      onDeprecated={() => toggleFileDeprecated(file.id, true)}
                    />
                  ))}
                {detail.files.some((file) => file.deprecated_at) && (
                  <details>
                    <summary>Deprecated files</summary>
                    {detail.files
                      .filter((file) => file.deprecated_at)
                      .map((file) => (
                        <CustomerFileRow
                          key={file.id}
                          file={file}
                          onDownload={() => downloadCustomerFile(file.id)}
                          onDeprecated={() => toggleFileDeprecated(file.id, false)}
                          deprecated
                        />
                      ))}
                  </details>
                )}
              </div>
              <div className={stylex(styles.section)}>
                <h4>Activity</h4>
                {!creatingNote && <button onClick={() => setCreatingNote(true)}>Add note</button>}
                {creatingNote && (
                  <NoteForm onSave={saveNote} onCancel={() => setCreatingNote(false)} />
                )}
                {detail.activities.map((activity) => (
                  <article key={activity.id} className={stylex(styles.note)}>
                    <b>{activity.subject}</b>{" "}
                    <span className={stylex(styles.muted)}>
                      {activity.created_by ? `by ${activity.created_by} · ` : ""}
                      {activity.occurred_at}
                    </span>
                    {activity.body && (
                      <div className={stylex(styles.markdown)}>
                        <Markdown>{activity.body}</Markdown>
                      </div>
                    )}
                    {activity.activity_type === "note" && (
                      <div className={stylex(styles.actions)}>
                        <label>
                          <span className={stylex(styles.muted)}>
                            {uploadingActivityId === activity.id ? "Uploading…" : "Attach file"}
                          </span>
                          <input
                            type="file"
                            disabled={uploadingActivityId !== null}
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) void uploadNoteFile(activity.id, file);
                              event.target.value = "";
                            }}
                          />
                        </label>
                        {detail.files
                          .filter((file) => file.activity_id === activity.id && !file.deprecated_at)
                          .map((file) => (
                            <button key={file.id} onClick={() => downloadCustomerFile(file.id)}>
                              {file.original_filename}
                            </button>
                          ))}
                      </div>
                    )}
                  </article>
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
function CustomerFileRow({
  file,
  onDownload,
  onDeprecated,
  deprecated = false,
}: {
  file: CustomerDetail["files"][number];
  onDownload: () => void;
  onDeprecated: () => void;
  deprecated?: boolean;
}) {
  return (
    <article className={stylex(styles.note)}>
      <b>{file.original_filename}</b>
      <div className={stylex(styles.muted)}>
        {formatFileSize(file.size_bytes)} · attached to “{file.note_subject}” · {file.created_at}
      </div>
      <div className={stylex(styles.actions)}>
        <button onClick={onDownload}>Download</button>
        <button onClick={onDeprecated}>{deprecated ? "Restore" : "Mark deprecated"}</button>
      </div>
    </article>
  );
}
function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
type OpportunityInput = {
  description: string;
  type: string;
  budget: number;
  status: string;
};
function OpportunityForm({
  opportunity,
  onSave,
  onCancel,
}: {
  opportunity?: Opportunity;
  onSave: (input: OpportunityInput) => void;
  onCancel: () => void;
}) {
  const [description, setDescription] = useState(opportunity?.description || "");
  const [type, setType] = useState<string>(opportunity?.opportunity_type || "furniture");
  const [budget, setBudget] = useState(opportunity ? String(opportunity.budget_cents / 100) : "");
  const [status, setStatus] = useState<string>(opportunity?.status || "scoping");
  return (
    <form
      className={stylex(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ description, type, budget: Number(budget), status });
      }}
    >
      <textarea
        aria-label="Opportunity description"
        className={stylex(styles.textarea)}
        placeholder="Describe the opportunity"
        required
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <select aria-label="Opportunity type" value={type} onChange={(e) => setType(e.target.value)}>
        <option value="furniture">furniture</option>
        <option value="cabinets">cabinets</option>
        <option value="other">other</option>
      </select>
      <input
        aria-label="Opportunity budget"
        type="number"
        min="0"
        step="0.01"
        placeholder="Budget"
        required
        value={budget}
        onChange={(e) => setBudget(e.target.value)}
      />
      <select
        aria-label="Opportunity status"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="scoping">scoping</option>
        <option value="quoted">quoted</option>
        <option value="accepted">accepted</option>
        <option value="lost">lost</option>
      </select>
      <div className={stylex(styles.actions)}>
        <button type="submit">Save opportunity</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
function formatBudget(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
type CustomerInput = { displayName: string; status: string; leadSource: string };
function CustomerForm({
  customer,
  onSave,
  onCancel,
}: {
  customer: CustomerDetail["customer"];
  onSave: (input: CustomerInput) => void;
  onCancel: () => void;
}) {
  const [displayName, setDisplayName] = useState(customer.display_name);
  const [status, setStatus] = useState(customer.status);
  const [leadSource, setLeadSource] = useState(customer.lead_source || "");
  return (
    <form
      className={stylex(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ displayName, status, leadSource });
      }}
    >
      <label>
        Name
        <input
          aria-label="Customer name"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </label>
      <label>
        Status
        <select
          aria-label="Edit customer status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {["lead", "prospect", "active", "past", "archived"].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label>
        Lead source
        <input
          aria-label="Lead source"
          value={leadSource}
          onChange={(e) => setLeadSource(e.target.value)}
        />
      </label>
      <div className={stylex(styles.actions)}>
        <button type="submit">Save customer</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
function NoteForm({
  onSave,
  onCancel,
}: {
  onSave: (input: {
    subject: string;
    body: string;
    followUpAt?: string;
    followUpDescription?: string;
  }) => void;
  onCancel: () => void;
}) {
  const [subject, setSubject] = useState("Note");
  const [body, setBody] = useState("");
  const [scheduleFollowUp, setScheduleFollowUp] = useState(false);
  const [followUpAt, setFollowUpAt] = useState("");
  const [followUpDescription, setFollowUpDescription] = useState("");
  return (
    <form
      className={stylex(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim())
          onSave({
            subject,
            body,
            followUpAt: scheduleFollowUp ? new Date(followUpAt).toISOString() : undefined,
            followUpDescription: scheduleFollowUp ? followUpDescription : undefined,
          });
      }}
    >
      <input
        aria-label="Note title"
        placeholder="Note title"
        required
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
      />
      <textarea
        aria-label="Note body"
        className={stylex(styles.textarea)}
        placeholder="Write a note… Markdown is supported."
        required
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <span className={stylex(styles.muted)}>
        Markdown supported: headings, lists, links, bold, italic, and code.
      </span>
      <label className={stylex(styles.check)}>
        <input
          type="checkbox"
          checked={scheduleFollowUp}
          onChange={(e) => setScheduleFollowUp(e.target.checked)}
        />
        Schedule follow-up
      </label>
      {scheduleFollowUp && (
        <>
          <label>
            Follow-up date and time
            <input
              aria-label="Follow-up date and time"
              type="datetime-local"
              required
              value={followUpAt}
              onChange={(e) => setFollowUpAt(e.target.value)}
            />
          </label>
          <label>
            Follow-up description
            <input
              aria-label="Follow-up description"
              required
              placeholder="Call about the proposal"
              value={followUpDescription}
              onChange={(e) => setFollowUpDescription(e.target.value)}
            />
          </label>
        </>
      )}
      <div className={stylex(styles.actions)}>
        <button type="submit">Save note</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
function followUpLabel(value: string | null) {
  if (!value) return "No follow-up scheduled";
  const overdue = new Date(value).getTime() < Date.now();
  return `${overdue ? "Follow-up overdue" : "Next follow-up"}: ${formatDateTime(value)}`;
}
type ContactInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: string;
  status: string;
  isPrimary: boolean;
};
function ContactForm({
  contact,
  onSave,
  onCancel,
}: {
  contact?: Contact;
  onSave: (input: ContactInput) => void;
  onCancel: () => void;
}) {
  const [firstName, setFirstName] = useState(contact?.first_name || "");
  const [lastName, setLastName] = useState(contact?.last_name || "");
  const [email, setEmail] = useState(contact?.email || "");
  const [phone, setPhone] = useState(contact?.phone || "");
  const [role, setRole] = useState(contact?.role || "");
  const [status, setStatus] = useState<string>(contact?.status || "active");
  const [isPrimary, setIsPrimary] = useState(Boolean(contact?.is_primary));
  return (
    <form
      className={stylex(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ firstName, lastName, email, phone, role, status, isPrimary });
      }}
    >
      <input
        aria-label="First name"
        placeholder="First name"
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
      />
      <input
        aria-label="Last name"
        placeholder="Last name"
        value={lastName}
        onChange={(e) => setLastName(e.target.value)}
      />
      <input
        aria-label="Email"
        placeholder="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        aria-label="Phone"
        placeholder="Phone"
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <input
        aria-label="Role"
        placeholder="Role"
        value={role}
        onChange={(e) => setRole(e.target.value)}
      />
      <select
        aria-label="Contact status"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="active">active</option>
        <option value="inactive">inactive</option>
        {contact && <option value="archived">archived</option>}
      </select>
      <label className={stylex(styles.check)}>
        <input
          type="checkbox"
          checked={isPrimary}
          onChange={(e) => setIsPrimary(e.target.checked)}
        />{" "}
        Primary contact
      </label>
      <div className={stylex(styles.actions)}>
        <button type="submit">Save contact</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
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
