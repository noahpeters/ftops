import stylex from "~/lib/stylex";
import { useEffect, useState } from "react";
import { buildUrl, fetchJson } from "../../lib/api";
const styles = stylex.create({
  root: {
    padding: "30px",
    maxWidth: "1250px",
    color: "#283e34",
    "@media(max-width:760px)": { padding: "20px 14px" },
  },
  heading: { fontFamily: "Georgia,serif", fontWeight: 400, fontSize: "36px", margin: 0 },
  h2: { fontFamily: "Georgia,serif", fontWeight: 400, fontSize: "25px" },
  muted: { color: "#657368" },
  actions: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    marginTop: "20px",
    marginBottom: "20px",
  },
  button: {
    border: "1px solid #bccbbd",
    borderRadius: "5px",
    backgroundColor: "#fffef8",
    padding: "10px 16px",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "inherit",
    color: "#294738",
    textDecoration: "none",
    minHeight: "42px",
    ":disabled": { opacity: 0.5, cursor: "wait" },
  },
  primary: { backgroundColor: "#294c3a", color: "white", borderColor: "#294c3a" },
  navActive: { backgroundColor: "#e0e8dc", fontWeight: 600 },
  card: {
    backgroundColor: "#fffef8",
    border: "1px solid #d3ddcf",
    borderRadius: "8px",
    padding: "24px",
    marginTop: "20px",
    marginBottom: "20px",
    "@media(max-width:760px)": { padding: "18px" },
  },
  label: { display: "block", fontSize: "14px", fontWeight: 600 },
  field: {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #b9c9ba",
    borderRadius: "4px",
    backgroundColor: "white",
    padding: "10px",
    color: "#253f32",
    fontFamily: "inherit",
    fontSize: "inherit",
    marginTop: "6px",
    marginBottom: "16px",
  },
  textarea: {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    minHeight: "120px",
    border: "1px solid #b9c9ba",
    borderRadius: "4px",
    backgroundColor: "white",
    padding: "10px",
    color: "#253f32",
    fontFamily: "inherit",
    fontSize: "inherit",
    marginTop: "6px",
    marginBottom: "16px",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2,minmax(0,1fr))",
    columnGap: "18px",
    "@media(max-width:760px)": { gridTemplateColumns: "1fr" },
  },
  line: {
    display: "grid",
    gridTemplateColumns: "2fr repeat(3,1fr)",
    gap: "12px",
    "@media(max-width:760px)": { gridTemplateColumns: "1fr" },
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    "@media(max-width:760px)": { fontSize: "14px" },
  },
  cell: {
    padding: "12px 8px",
    textAlign: "left",
    borderBottom: "1px solid #dbe2d6",
    verticalAlign: "top",
  },
  editHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    position: "sticky",
    top: 0,
    backgroundColor: "#f5f4ed",
    padding: "15px 0",
    zIndex: 2,
    "@media(max-width:760px)": { alignItems: "flex-start" },
  },
  alert: { minHeight: "26px", color: "#854b30", whiteSpace: "pre-wrap" },
  stats: { display: "flex", gap: "25px", flexWrap: "wrap" },
  pre: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  link: { overflowWrap: "anywhere" },
  scroll: { overflowX: "auto" },
});
type Term = {
  id: string;
  version_label: string;
  title: string;
  content: string;
};
type Customer = {
  id: string;
  display_name: string;
};
type Contact = {
  id: string;
  display_name: string;
  email: string | null;
};
type Line = {
  id: string;
  description: string;
  quantityMillis: number;
  unitPriceCents: number;
  unitCostCents: number | null;
  discountCents: number;
  taxRatePpm: number;
};
type Form = {
  title: string;
  scope: string;
  customerId: string;
  contactId: string;
  projectId: string;
  termsId: string;
  expiresAt: string;
  deposit:
    | {
        kind: "fixed";
        amountCents: number;
      }
    | {
        kind: "percentage";
        bps: number;
      };
  lines: Line[];
  milestones: Array<{
    id: string;
    label: string;
    amount:
      | {
          kind: "fixed";
          amountCents: number;
        }
      | {
          kind: "percentage";
          bps: number;
        };
  }>;
};
type Estimate = {
  id: string;
  title: string;
  status: string;
  revision: number;
  public_json: string;
};
type Details = {
  financials: {
    netSellingCents: number;
    estimatedCostCents: number | null;
    estimatedProfitBeforeFeesCents: number | null;
    knownPaymentFeesCents: number;
    pendingFeeRecords: number;
    estimatedProfitAfterKnownFeesCents: number | null;
  };
  revision: Estimate & {
    snapshot_json: string;
  };
  documents: Array<{
    id: string;
    kind: string;
  }>;
  evidence: {
    signer_name: string;
    signer_email: string;
    signed_at: string;
  } | null;
  invoices: Array<{
    id: string;
    number: string;
    label: string;
    amount_cents: number;
    refunded_cents: number;
    status: string;
  }>;
};
type Ledger = {
  id: string;
  kind: string;
  amount_cents: number;
  fee_cents: number | null;
  status: string;
  available_at: string | null;
};
type Settings = {
  configured?: boolean;
  issuerName: string;
  replyEmail: string;
  disclosure: string;
  environment: "sandbox" | "production";
  hasSigning?: boolean;
  hasStripe?: boolean;
  hasWebhookSecret?: boolean;
  hasTimestamp?: boolean;
  webhookUrl?: string;
};
const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n / 100);
const blankLine = (): Line => ({
  id: crypto.randomUUID(),
  description: "",
  quantityMillis: 1000,
  unitPriceCents: 0,
  unitCostCents: null,
  discountCents: 0,
  taxRatePpm: 0,
});
const blankForm = (): Form => ({
  title: "",
  scope: "",
  customerId: "",
  contactId: "",
  projectId: "",
  termsId: "",
  expiresAt: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  deposit: {
    kind: "fixed",
    amountCents: 0,
  },
  lines: [blankLine()],
  milestones: [],
});
const blankSettings: Settings = {
  issuerName: "",
  replyEmail: "",
  disclosure: "",
  environment: "sandbox",
};
export function BillingPanel({ workspaceId }: { workspaceId: string }) {
  const [tab, setTab] = useState<"estimates" | "terms" | "settings" | "payments">("estimates");
  const [terms, setTerms] = useState<Term[]>([]),
    [estimates, setEstimates] = useState<Estimate[]>([]),
    [customers, setCustomers] = useState<Customer[]>([]),
    [contacts, setContacts] = useState<Contact[]>([]),
    [projects, setProjects] = useState<
      Array<{
        id: string;
        title: string;
      }>
    >([]);
  const [config, setConfig] = useState<Settings>(blankSettings),
    [secrets, setSecrets] = useState({
      stripeKey: "",
      stripeWebhookSecret: "",
      signingKeyPkcs8: "",
      signingCertificatePem: "",
      timestampUrl: "",
      timestampTrustPem: "",
    });
  const [term, setTerm] = useState({
    title: "Terms & conditions",
    versionLabel: "",
    content: "",
  });
  const [form, setForm] = useState<Form | null>(null),
    [editId, setEditId] = useState<string | null>(null),
    [details, setDetails] = useState<Details | null>(null),
    [ledger, setLedger] = useState<Ledger[]>([]);
  const [refundDraft, setRefundDraft] = useState<{
    invoiceId: string;
    amount: string;
    reason: string;
    requestId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [link, setLink] = useState("");
  async function api<T>(path: string, body?: unknown): Promise<T> {
    const r = await fetchJson<
      T & {
        error?: string;
      }
    >(
      buildUrl("/billing/" + path, {
        workspaceId,
      }),
      body
        ? {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          }
        : {}
    );
    if (!r.ok || !r.data) throw new Error(r.data?.error?.replace(/_/g, " ") || "Request failed");
    return r.data;
  }
  async function refresh() {
    const [a, b, c] = await Promise.all([
      api<Term[]>("terms"),
      api<Estimate[]>("estimates"),
      api<Settings>("settings"),
    ]);
    setTerms(a);
    setEstimates(b);
    setConfig(c.configured ? c : blankSettings);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let live = true;
    setDetails(null);
    setForm(null);
    setLink("");
    setSecrets({
      stripeKey: "",
      stripeWebhookSecret: "",
      signingKeyPkcs8: "",
      signingCertificatePem: "",
      timestampUrl: "",
      timestampTrustPem: "",
    });
    setEstimates([]);
    setTerms([]);
    setCustomers([]);
    setProjects([]);
    setLedger([]);
    setConfig(blankSettings);
    Promise.all([
      fetchJson<Term[]>(
        buildUrl("/billing/terms", {
          workspaceId,
        })
      ),
      fetchJson<Estimate[]>(
        buildUrl("/billing/estimates", {
          workspaceId,
        })
      ),
      fetchJson<Settings>(
        buildUrl("/billing/settings", {
          workspaceId,
        })
      ),
      fetchJson<Customer[]>(
        buildUrl("/customers", {
          workspaceId,
        })
      ),
      fetchJson<
        Array<{
          id: string;
          title: string;
        }>
      >(
        buildUrl("/projects", {
          workspaceId,
        })
      ),
    ])
      .then(([a, b, c, d, e]) => {
        if (!live) return;
        if (!a.ok || !b.ok || !c.ok) {
          setMessage("Billing is available to workspace administrators.");
          return;
        }
        setTerms(a.data ?? []);
        setEstimates(b.data ?? []);
        setConfig(c.data?.configured ? c.data : blankSettings);
        setCustomers(d.data ?? []);
        setProjects(e.data ?? []);
      })
      .catch(() => {
        if (live) setMessage("Could not load billing.");
      });
    return () => {
      live = false;
    };
  }, [workspaceId]);
  useEffect(() => {
    if (!form?.customerId) {
      setContacts([]);
      return;
    }
    let live = true;
    fetchJson<{
      contacts: Contact[];
    }>(buildUrl("/customers/" + form.customerId))
      .then((r) => {
        if (live) setContacts((r.data?.contacts ?? []).filter((c) => c.email));
      })
      .catch(() => {
        if (live) setContacts([]);
      });
    return () => {
      live = false;
    };
  }, [form?.customerId]);
  async function open(id: string) {
    setDetails(await api<Details>("estimates/" + id));
    setLink("");
  }
  function input(label: string, value: string, change: (value: string) => void, type = "text") {
    return (
      <label className={stylex(styles.label)}>
        {label}
        <input
          type={type}
          value={value}
          onChange={(e) => change(e.target.value)}
          className={stylex(styles.field)}
        />
      </label>
    );
  }
  const cost = form?.lines.some((l) => l.unitCostCents === null)
    ? null
    : form?.lines.reduce(
        (s, l) => s + Math.round(((l.unitCostCents ?? 0) * l.quantityMillis) / 1000),
        0
      );
  const price =
    form?.lines.reduce(
      (s, l) => s + Math.round((l.unitPriceCents * l.quantityMillis) / 1000) - l.discountCents,
      0
    ) ?? 0;
  function updateLine(index: number, patch: Partial<Line>) {
    if (form)
      setForm({
        ...form,
        lines: form.lines.map((l, i) =>
          i === index
            ? {
                ...l,
                ...patch,
              }
            : l
        ),
      });
  }
  return (
    <div className={stylex(styles.root)}>
      <h1 className={stylex(styles.heading)}>Estimates & billing</h1>
      <p className={stylex(styles.muted)}>Your projects, agreements and payments in one place.</p>
      <nav className={stylex(styles.actions)}>
        {(["estimates", "terms", "payments", "settings"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setDetails(null);
              setForm(null);
              if (t === "payments")
                void run(async () => setLedger(await api<Ledger[]>("payments")));
            }}
            className={stylex(styles.button, tab === t && styles.navActive)}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      <p role="status" className={stylex(styles.alert)}>
        {busy ? "Working…" : message}
      </p>
      {tab === "settings" && (
        <section className={stylex(styles.card)}>
          <h2 className={stylex(styles.h2)}>Business & payment settings</h2>
          <p className={stylex(styles.muted)}>
            Credentials are encrypted and are never shown again after saving. Leave credential
            fields empty to retain them.
          </p>
          <div className={stylex(styles.grid)}>
            {input("Business name", config.issuerName, (v) =>
              setConfig({
                ...config,
                issuerName: v,
              })
            )}
            {input(
              "Contact email",
              config.replyEmail,
              (v) =>
                setConfig({
                  ...config,
                  replyEmail: v,
                }),
              "email"
            )}
            <label className={stylex(styles.label)}>
              Payment environment
              <select
                value={config.environment}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    environment: e.target.value as Settings["environment"],
                  })
                }
                className={stylex(styles.field)}
              >
                <option value="sandbox">Stripe test mode</option>
                <option value="production">Stripe live mode</option>
              </select>
            </label>
            {input(
              "Stripe secret key",
              secrets.stripeKey,
              (v) =>
                setSecrets({
                  ...secrets,
                  stripeKey: v,
                }),
              "password"
            )}
            {input(
              "Stripe webhook signing secret",
              secrets.stripeWebhookSecret,
              (v) =>
                setSecrets({
                  ...secrets,
                  stripeWebhookSecret: v,
                }),
              "password"
            )}
            <label className={stylex(styles.label)}>
              Document signing private key (PKCS#8 PEM)
              <input
                type="file"
                accept=".pem,.key"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    void file.text().then((v) =>
                      setSecrets((s) => ({
                        ...s,
                        signingKeyPkcs8: v,
                      }))
                    );
                }}
                className={stylex(styles.field)}
              />
            </label>
            <label className={stylex(styles.label)}>
              Document signing certificate chain (PEM)
              <input
                type="file"
                accept=".pem,.crt"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    void file.text().then((v) =>
                      setSecrets((s) => ({
                        ...s,
                        signingCertificatePem: v,
                      }))
                    );
                }}
                className={stylex(styles.field)}
              />
            </label>
          </div>
          <div className={stylex(styles.grid)}>
            {input(
              "Trusted timestamp service URL (optional)",
              secrets.timestampUrl,
              (v) => setSecrets({ ...secrets, timestampUrl: v }),
              "url"
            )}
            <label className={stylex(styles.label)}>
              Timestamp authority trust certificates (PEM)
              <input
                className={stylex(styles.field)}
                type="file"
                accept=".pem,.crt"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    void file
                      .text()
                      .then((v) => setSecrets((s) => ({ ...s, timestampTrustPem: v })));
                }}
              />
            </label>
          </div>
          {config.webhookUrl && (
            <p className={stylex(styles.link)}>Stripe webhook endpoint: {config.webhookUrl}</p>
          )}
          <label className={stylex(styles.label)}>
            Electronic records & signatures disclosure
            <textarea
              value={config.disclosure}
              onChange={(e) =>
                setConfig({
                  ...config,
                  disclosure: e.target.value,
                })
              }
              className={stylex(styles.textarea)}
            />
          </label>
          <p>
            Stripe: {config.hasStripe ? "configured" : "not configured"} · Webhooks:{" "}
            {config.hasWebhookSecret ? "configured" : "not configured"} · PDF signing:{" "}
            {config.hasSigning ? "configured" : "not configured"} · Trusted timestamps:{" "}
            {config.hasTimestamp ? "configured" : "not configured"}
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api("settings", {
                  ...config,
                  ...Object.fromEntries(Object.entries(secrets).filter(([, v]) => v)),
                });
                setSecrets({
                  stripeKey: "",
                  stripeWebhookSecret: "",
                  signingKeyPkcs8: "",
                  signingCertificatePem: "",
                  timestampUrl: "",
                  timestampTrustPem: "",
                });
                await refresh();
                setMessage("Settings saved.");
              })
            }
            className={stylex(styles.button, styles.primary)}
          >
            Save settings
          </button>
        </section>
      )}
      {tab === "terms" && (
        <>
          <section className={stylex(styles.card)}>
            <h2 className={stylex(styles.h2)}>Publish a terms version</h2>
            <p className={stylex(styles.muted)}>
              Published terms are preserved. A new version applies to new proposals; existing
              agreements retain their accepted terms.
            </p>
            <div className={stylex(styles.grid)}>
              {input("Version label", term.versionLabel, (v) =>
                setTerm({
                  ...term,
                  versionLabel: v,
                })
              )}
              {input("Document title", term.title, (v) =>
                setTerm({
                  ...term,
                  title: v,
                })
              )}
            </div>
            <label className={stylex(styles.label)}>
              Complete terms & conditions
              <textarea
                value={term.content}
                onChange={(e) =>
                  setTerm({
                    ...term,
                    content: e.target.value,
                  })
                }
                className={stylex(styles.textarea)}
              />
            </label>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api("terms", term);
                  setTerm({
                    title: "Terms & conditions",
                    versionLabel: "",
                    content: "",
                  });
                  await refresh();
                  setMessage("Terms published with a signed PDF.");
                })
              }
              className={stylex(styles.button, styles.primary)}
            >
              Publish terms
            </button>
          </section>
          {terms.map((t) => (
            <details key={t.id} className={stylex(styles.card)}>
              <summary>
                {t.title} · {t.version_label}
              </summary>
              <pre className={stylex(styles.pre)}>{t.content}</pre>
            </details>
          ))}
        </>
      )}
      {tab === "estimates" && !form && !details && (
        <>
          <div className={stylex(styles.actions)}>
            <button
              disabled={busy}
              onClick={() => {
                setEditId(null);
                setForm(blankForm());
              }}
              className={stylex(styles.button, styles.primary)}
            >
              New estimate
            </button>
            <button
              disabled={busy}
              onClick={() => void run(refresh)}
              className={stylex(styles.button)}
            >
              Refresh
            </button>
          </div>
          {estimates.length === 0 ? (
            <section className={stylex(styles.card)}>
              <h2 className={stylex(styles.h2)}>Start with an estimate</h2>
              <p>
                Set up your business and publish your terms, then create an itemized estimate for a
                customer.
              </p>
            </section>
          ) : (
            <div className={stylex(styles.card, styles.scroll)}>
              <table className={stylex(styles.table)}>
                <thead>
                  <tr>
                    <th className={stylex(styles.cell)}>Estimate</th>
                    <th className={stylex(styles.cell)}>Revision</th>
                    <th className={stylex(styles.cell)}>Status</th>
                    <th className={stylex(styles.cell)}>Total</th>
                    <th className={stylex(styles.cell)}></th>
                  </tr>
                </thead>
                <tbody>
                  {estimates.map((e) => (
                    <tr key={e.id}>
                      <td className={stylex(styles.cell)}>{e.title}</td>
                      <td className={stylex(styles.cell)}>{e.revision}</td>
                      <td className={stylex(styles.cell)}>{e.status}</td>
                      <td className={stylex(styles.cell)}>
                        {money(JSON.parse(e.public_json).estimate.totalCents)}
                      </td>
                      <td className={stylex(styles.cell)}>
                        <button
                          onClick={() => void run(() => open(e.id))}
                          className={stylex(styles.button)}
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {tab === "estimates" && form && (
        <>
          <div className={stylex(styles.editHeader)}>
            <h2 className={stylex(styles.h2)}>{editId ? "Revise estimate" : "New estimate"}</h2>
            <div className={stylex(styles.actions)}>
              <button
                disabled={busy}
                onClick={() => setForm(null)}
                className={stylex(styles.button)}
              >
                Cancel
              </button>
              <button
                disabled={busy || !form.title || !form.contactId || !form.termsId}
                onClick={() =>
                  void run(async () => {
                    const r = await api<{
                      id: string;
                    }>(editId ? "estimates/" + editId + "/revise" : "estimates", {
                      ...form,
                      projectId: form.projectId || null,
                      expiresAt: new Date(form.expiresAt + "T23:59:59Z").toISOString(),
                    });
                    setForm(null);
                    await refresh();
                    await open(r.id);
                  })
                }
                className={stylex(styles.button, styles.primary)}
              >
                Save
              </button>
            </div>
          </div>
          <section className={stylex(styles.card)}>
            <div className={stylex(styles.grid)}>
              {input("Estimate title", form.title, (v) =>
                setForm({
                  ...form,
                  title: v,
                })
              )}
              <label className={stylex(styles.label)}>
                Customer
                <select
                  value={form.customerId}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      customerId: e.target.value,
                      contactId: "",
                    })
                  }
                  className={stylex(styles.field)}
                >
                  <option value="">Select a customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={stylex(styles.label)}>
                Signing contact
                <select
                  value={form.contactId}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      contactId: e.target.value,
                    })
                  }
                  className={stylex(styles.field)}
                >
                  <option value="">Select a contact with email</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.display_name} · {c.email}
                    </option>
                  ))}
                </select>
              </label>
              <label className={stylex(styles.label)}>
                Project
                <select
                  value={form.projectId}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      projectId: e.target.value,
                    })
                  }
                  className={stylex(styles.field)}
                >
                  <option value="">Create when signed</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className={stylex(styles.label)}>
                Terms version
                <select
                  value={form.termsId}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      termsId: e.target.value,
                    })
                  }
                  className={stylex(styles.field)}
                >
                  <option value="">Select published terms</option>
                  {terms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title} · {t.version_label}
                    </option>
                  ))}
                </select>
              </label>
              {input(
                "Valid through",
                form.expiresAt,
                (v) =>
                  setForm({
                    ...form,
                    expiresAt: v,
                  }),
                "date"
              )}
            </div>
            <label className={stylex(styles.label)}>
              Scope, materials & exclusions
              <textarea
                value={form.scope}
                onChange={(e) =>
                  setForm({
                    ...form,
                    scope: e.target.value,
                  })
                }
                className={stylex(styles.textarea)}
              />
            </label>
          </section>
          <section className={stylex(styles.card)}>
            <h2 className={stylex(styles.h2)}>Itemized estimate</h2>
            <p className={stylex(styles.muted)}>
              Costs and profit remain private. Enter the reviewed sales tax rate for each item.
            </p>
            {form.lines.map((l, i) => (
              <div key={l.id} className={stylex(styles.card)}>
                <div className={stylex(styles.line)}>
                  {input("Description", l.description, (v) =>
                    updateLine(i, {
                      description: v,
                    })
                  )}
                  {input(
                    "Quantity",
                    String(l.quantityMillis / 1000),
                    (v) =>
                      updateLine(i, {
                        quantityMillis: Math.round(Number(v) * 1000),
                      }),
                    "number"
                  )}
                  {input(
                    "Unit selling price ($)",
                    String(l.unitPriceCents / 100),
                    (v) =>
                      updateLine(i, {
                        unitPriceCents: Math.round(Number(v) * 100),
                      }),
                    "number"
                  )}
                  {input(
                    "Private unit cost ($)",
                    l.unitCostCents === null ? "" : String(l.unitCostCents / 100),
                    (v) =>
                      updateLine(i, {
                        unitCostCents: v === "" ? null : Math.round(Number(v) * 100),
                      }),
                    "number"
                  )}
                </div>
                <div className={stylex(styles.grid)}>
                  {input(
                    "Line discount ($)",
                    String(l.discountCents / 100),
                    (v) =>
                      updateLine(i, {
                        discountCents: Math.round(Number(v) * 100),
                      }),
                    "number"
                  )}
                  {input(
                    "Sales tax (%)",
                    String(l.taxRatePpm / 10000),
                    (v) =>
                      updateLine(i, {
                        taxRatePpm: Math.round(Number(v) * 10000),
                      }),
                    "number"
                  )}
                </div>
                <button
                  disabled={form.lines.length === 1}
                  onClick={() =>
                    setForm({
                      ...form,
                      lines: form.lines.filter((_, n) => n !== i),
                    })
                  }
                  className={stylex(styles.button)}
                >
                  Remove item
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                setForm({
                  ...form,
                  lines: [...form.lines, blankLine()],
                })
              }
              className={stylex(styles.button)}
            >
              Add item
            </button>
            <div className={stylex(styles.stats)}>
              <p>
                Selling price before tax
                <br />
                <strong>{money(price)}</strong>
              </p>
              <p>
                Private cost
                <br />
                <strong>{cost === null || cost === undefined ? "Incomplete" : money(cost)}</strong>
              </p>
              <p>
                Profit before payment fees
                <br />
                <strong>
                  {cost === null || cost === undefined ? "Incomplete" : money(price - cost)}
                </strong>
              </p>
              <p>
                Gross margin
                <br />
                <strong>
                  {cost === null || cost === undefined || price === 0
                    ? "—"
                    : (((price - cost) / price) * 100).toFixed(1) + "%"}
                </strong>
              </p>
            </div>
          </section>
          <section className={stylex(styles.card)}>
            <h2 className={stylex(styles.h2)}>Payment schedule</h2>
            <div className={stylex(styles.grid)}>
              <label className={stylex(styles.label)}>
                Deposit type
                <select
                  value={form.deposit.kind}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      deposit:
                        e.target.value === "fixed"
                          ? {
                              kind: "fixed",
                              amountCents: 0,
                            }
                          : {
                              kind: "percentage",
                              bps: 0,
                            },
                    })
                  }
                  className={stylex(styles.field)}
                >
                  <option value="fixed">Fixed amount</option>
                  <option value="percentage">Percentage of total</option>
                </select>
              </label>
              {input(
                form.deposit.kind === "fixed" ? "Deposit ($)" : "Deposit (%)",
                String(
                  form.deposit.kind === "fixed"
                    ? form.deposit.amountCents / 100
                    : form.deposit.bps / 100
                ),
                (v) =>
                  setForm({
                    ...form,
                    deposit:
                      form.deposit.kind === "fixed"
                        ? {
                            kind: "fixed",
                            amountCents: Math.round(Number(v) * 100),
                          }
                        : {
                            kind: "percentage",
                            bps: Math.round(Number(v) * 100),
                          },
                  }),
                "number"
              )}
            </div>
            {form.milestones.map((m, i) => (
              <div key={m.id} className={stylex(styles.grid)}>
                {input("Milestone / payment trigger", m.label, (v) =>
                  setForm({
                    ...form,
                    milestones: form.milestones.map((s, n) =>
                      n === i
                        ? {
                            ...s,
                            label: v,
                          }
                        : s
                    ),
                  })
                )}
                <label className={stylex(styles.label)}>
                  Milestone type
                  <select
                    value={m.amount.kind}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        milestones: form.milestones.map((s, n) =>
                          n === i
                            ? {
                                ...s,
                                amount:
                                  e.target.value === "fixed"
                                    ? {
                                        kind: "fixed",
                                        amountCents: 0,
                                      }
                                    : {
                                        kind: "percentage",
                                        bps: 0,
                                      },
                              }
                            : s
                        ),
                      })
                    }
                    className={stylex(styles.field)}
                  >
                    <option value="fixed">Fixed amount</option>
                    <option value="percentage">Percentage of total</option>
                  </select>
                </label>
                {input(
                  m.amount.kind === "fixed" ? "Milestone ($)" : "Milestone (%)",
                  String(
                    m.amount.kind === "fixed" ? m.amount.amountCents / 100 : m.amount.bps / 100
                  ),
                  (v) =>
                    setForm({
                      ...form,
                      milestones: form.milestones.map((s, n) =>
                        n === i
                          ? {
                              ...s,
                              amount:
                                m.amount.kind === "fixed"
                                  ? {
                                      kind: "fixed",
                                      amountCents: Math.round(Number(v) * 100),
                                    }
                                  : {
                                      kind: "percentage",
                                      bps: Math.round(Number(v) * 100),
                                    },
                            }
                          : s
                      ),
                    }),
                  "number"
                )}
                <button
                  onClick={() =>
                    setForm({
                      ...form,
                      milestones: form.milestones.filter((_, n) => n !== i),
                    })
                  }
                  className={stylex(styles.button)}
                >
                  Remove milestone
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                setForm({
                  ...form,
                  milestones: [
                    ...form.milestones,
                    {
                      id: crypto.randomUUID(),
                      label: "",
                      amount: {
                        kind: "fixed",
                        amountCents: 0,
                      },
                    },
                  ],
                })
              }
              className={stylex(styles.button)}
            >
              Add milestone
            </button>
            <p className={stylex(styles.muted)}>
              The final balance is the contract total less the deposit and milestones. No automatic
              legal deposit caps are applied.
            </p>
          </section>
        </>
      )}
      {tab === "estimates" && details && !form && (
        <>
          <div className={stylex(styles.actions)}>
            <button onClick={() => setDetails(null)} className={stylex(styles.button)}>
              Back to estimates
            </button>
            {details.revision.status === "signed" && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await api<{
                      url: string;
                    }>("estimates/" + details.revision.id + "/access", {});
                    setLink(result.url);
                    setMessage("Renewed access link ready for the original signing contact.");
                  })
                }
                className={stylex(styles.button)}
              >
                Renew customer access
              </button>
            )}

            {["draft", "issued", "withdrawn"].includes(details.revision.status) && (
              <button
                onClick={() => {
                  const f = JSON.parse(details.revision.snapshot_json) as Form;
                  setEditId(details.revision.id);
                  setForm({
                    ...f,
                    projectId: f.projectId || "",
                    expiresAt: f.expiresAt.slice(0, 10),
                  });
                }}
                className={stylex(styles.button)}
              >
                Revise
              </button>
            )}
            {["draft", "issued"].includes(details.revision.status) && (
              <>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await api<{
                        url: string;
                      }>("estimates/" + details.revision.id + "/issue", {});
                      await open(details.revision.id);
                      setLink(result.url);
                      setMessage(
                        "Secure link ready. Share it with the signing contact. No invitation email has been sent."
                      );
                    })
                  }
                  className={stylex(styles.button, styles.primary)}
                >
                  Issue & create customer link
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api("estimates/" + details.revision.id + "/withdraw", {});
                      await open(details.revision.id);
                      await refresh();
                    })
                  }
                  className={stylex(styles.button)}
                >
                  Withdraw
                </button>
              </>
            )}
          </div>
          <section className={stylex(styles.card)}>
            <h2 className={stylex(styles.h2)}>{details.revision.title}</h2>
            <p>
              Revision {details.revision.revision} · {details.revision.status}
            </p>
            {link && (
              <p className={stylex(styles.link)}>
                <a href={link} target="_blank" rel="noreferrer">
                  Open customer review
                </a>
                <br />
                {link}
                <br />
                <button
                  onClick={() => void navigator.clipboard.writeText(link)}
                  className={stylex(styles.button)}
                >
                  Copy secure link
                </button>
              </p>
            )}
            {details.evidence && (
              <p>
                Signed by {details.evidence.signer_name} ({details.evidence.signer_email}) on{" "}
                {new Date(details.evidence.signed_at).toLocaleString()}.
              </p>
            )}
            <h3>Private project economics</h3>
            <div className={stylex(styles.stats)}>
              <p>
                Selling revenue before tax
                <br />
                <strong>{money(details.financials.netSellingCents)}</strong>
              </p>
              <p>
                Estimated cost
                <br />
                <strong>
                  {details.financials.estimatedCostCents === null
                    ? "Incomplete"
                    : money(details.financials.estimatedCostCents)}
                </strong>
              </p>
              <p>
                Known payment fees
                <br />
                <strong>{money(details.financials.knownPaymentFeesCents)}</strong>
              </p>
              <p>
                Estimated profit after known fees
                <br />
                <strong>
                  {details.financials.estimatedProfitAfterKnownFeesCents === null
                    ? "Incomplete"
                    : money(details.financials.estimatedProfitAfterKnownFeesCents)}
                </strong>
              </p>
            </div>
            <p className={stylex(styles.muted)}>
              Costs remain estimates. Future payment fees are not yet known.{" "}
              {details.financials.pendingFeeRecords} fee records await reconciliation.
            </p>
            <h3>Documents</h3>
            {details.documents.map((d) => (
              <p key={d.id}>
                <a
                  href={buildUrl("/billing/documents/" + d.id, {
                    workspaceId,
                  })}
                >
                  {d.kind.replace(/_/g, " ")} (PDF)
                </a>
              </p>
            ))}
            <h3>Invoices</h3>
            {details.invoices.map((i) => (
              <div key={i.id} className={stylex(styles.card)}>
                <strong>
                  {i.label} · {money(i.amount_cents)}
                </strong>
                <p>
                  {i.number} · {i.status}
                  {i.refunded_cents > 0 ? " · Refunded " + money(i.refunded_cents) : ""}
                </p>
                {i.status === "paid" && i.amount_cents > 0 && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      setRefundDraft({
                        invoiceId: i.id,
                        amount: String(i.amount_cents / 100),
                        reason: "",
                        requestId: crypto.randomUUID(),
                      })
                    }
                    className={stylex(styles.button)}
                  >
                    Refund payment
                  </button>
                )}
                {refundDraft?.invoiceId === i.id && (
                  <div className={stylex(styles.grid)}>
                    {input(
                      "Refund amount ($)",
                      refundDraft.amount,
                      (v) =>
                        setRefundDraft({
                          ...refundDraft,
                          amount: v,
                        }),
                      "number"
                    )}
                    {input("Refund reason", refundDraft.reason, (v) =>
                      setRefundDraft({
                        ...refundDraft,
                        reason: v,
                      })
                    )}
                    <button onClick={() => setRefundDraft(null)} className={stylex(styles.button)}>
                      Cancel refund
                    </button>
                    <button
                      disabled={busy || !refundDraft.reason}
                      onClick={() =>
                        void run(async () => {
                          await api("invoices/" + i.id + "/refund", {
                            amountCents: Math.round(Number(refundDraft.amount) * 100),
                            reason: refundDraft.reason,
                            requestId: refundDraft.requestId,
                          });
                          setRefundDraft(null);
                          await open(details.revision.id);
                          setMessage(
                            "Refund submitted. Provider confirmation and retained fees are tracked separately."
                          );
                        })
                      }
                      className={stylex(styles.button)}
                    >
                      Submit refund
                    </button>
                  </div>
                )}
              </div>
            ))}
          </section>
        </>
      )}
      {tab === "payments" && (
        <section className={stylex(styles.card)}>
          <h2 className={stylex(styles.h2)}>Payments & settlement</h2>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api("reconcile", {});
                setLedger(await api<Ledger[]>("payments"));
                setMessage("Payment and payout records refreshed.");
              })
            }
            className={stylex(styles.button)}
          >
            Reconcile with Stripe
          </button>
          <p className={stylex(styles.muted)}>
            Payment confirmation and bank payout are tracked separately. Unknown fees remain
            pending.
          </p>
          <div className={stylex(styles.scroll)}>
            <table className={stylex(styles.table)}>
              <thead>
                <tr>
                  <th className={stylex(styles.cell)}>Type</th>
                  <th className={stylex(styles.cell)}>Amount</th>
                  <th className={stylex(styles.cell)}>Fee</th>
                  <th className={stylex(styles.cell)}>Status</th>
                  <th className={stylex(styles.cell)}>Available / expected arrival</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id}>
                    <td className={stylex(styles.cell)}>{l.kind.replace(/_/g, " ")}</td>
                    <td className={stylex(styles.cell)}>{money(l.amount_cents)}</td>
                    <td className={stylex(styles.cell)}>
                      {l.fee_cents === null ? "Pending" : money(l.fee_cents)}
                    </td>
                    <td className={stylex(styles.cell)}>{l.status}</td>
                    <td className={stylex(styles.cell)}>
                      {l.available_at ? new Date(l.available_at).toLocaleDateString() : "Pending"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
