import { useEffect, useRef, useState } from "react";
import { buildUrl, fetchJson } from "../../lib/api";
import stylex from "~/lib/stylex";
import { styles } from "./styles";

type Plan = {
  width: number;
  depth: number;
  outline?: { x: number; z: number }[];
  elements: {
    x: number;
    z: number;
    width: number;
    depth: number;
    rotation: number;
    kind: string;
    material: string;
  }[];
};
type Design = { slug: string; updated_at: string; revision: number; preview: Plan | null };
type Lead = {
  request_id: string;
  sender_name: string;
  sender_email: string;
  sender_phone: string | null;
  room_slug: string;
  consent_at: string;
  lead_source: string;
};
type Report = {
  start: string;
  end: string;
  trackingStartedAt: string | null;
  totals: {
    visits: number;
    designs: number;
    shares: number;
    emails: number;
    prices: number;
    leads: number;
    leadSubmissions: number;
    convertedVisits: number;
  };
  daily: { date: string; visits: number }[];
  sources: {
    source: string;
    medium: string;
    campaign: string;
    visits: number;
    shares: number;
    convertedVisits: number;
  }[];
  designs: Design[];
  leads: Lead[];
  hasMoreDesigns: boolean;
  hasMoreLeads: boolean;
};
const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const number = (value: number) => value.toLocaleString();
function PlanPreview({
  plan,
  label,
  expanded = false,
}: {
  plan: Plan | null;
  label: string;
  expanded?: boolean;
}) {
  if (!plan) return <div className={stylex(styles.planEmpty)}>Preview unavailable</div>;
  return (
    <svg
      className={stylex(styles.plan, expanded && styles.dialogPlan)}
      viewBox={`-12 -12 ${plan.width + 24} ${plan.depth + 24}`}
      role="img"
      aria-label={label}
    >
      {plan.outline ? (
        <polygon
          points={plan.outline.map((p) => `${p.x},${p.z}`).join(" ")}
          fill="#f6f1e8"
          stroke="#706a5e"
          strokeWidth="2"
        />
      ) : (
        <rect
          width={plan.width}
          height={plan.depth}
          fill="#f6f1e8"
          stroke="#706a5e"
          strokeWidth="2"
        />
      )}
      {plan.elements.map((element, index) => (
        <rect
          key={index}
          x={element.x - element.width / 2}
          y={element.z - element.depth / 2}
          width={element.width}
          height={element.depth}
          transform={`rotate(${-element.rotation} ${element.x} ${element.z})`}
          fill={
            element.kind === "appliance"
              ? "#b6bdbc"
              : element.kind === "wall-cabinet"
                ? "#e1d2b8"
                : "#bda37b"
          }
          fillOpacity={element.kind === "wall-cabinet" ? 0.65 : 1}
          stroke="#6d604b"
          strokeWidth="0.8"
        />
      ))}
    </svg>
  );
}
export function ConfiguratorPanel() {
  const [days, setDays] = useState(30);
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Design | null>(null);
  const [designError, setDesignError] = useState("");
  const [designLoading, setDesignLoading] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const detailRequest = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setReport(null);
    void fetchJson<Report & { error?: string }>(buildUrl("/configurator", { days, page }), {
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result.ok || !result.data)
          throw new Error(
            result.data?.error === "configurator_not_connected"
              ? "The configurator connection hasn’t been set up yet. Once connected, saved designs and consenting leads will appear here."
              : "The configurator report couldn’t be loaded. Please try again."
          );
        setReport(result.data);
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : "Unable to load report.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [days, page, reload]);
  const inspect = async (slug: string, design?: Design) => {
    const request = ++detailRequest.current;
    setSelected(design || null);
    setDesignError("");
    setDesignLoading(!design);
    dialog.current?.showModal();
    if (design) return;
    try {
      const result = await fetchJson<Design>(buildUrl("/configurator/design", { slug }));
      if (!result.ok || !result.data) throw new Error("This design couldn’t be loaded.");
      if (request === detailRequest.current) setSelected(result.data);
    } catch {
      if (request === detailRequest.current)
        setDesignError("This design couldn’t be loaded. Close this window and try again.");
    } finally {
      if (request === detailRequest.current) setDesignLoading(false);
    }
  };
  const totals = report?.totals;
  const conversion = totals?.visits
    ? `${((100 * totals.convertedVisits) / totals.visits).toFixed(1)}%`
    : "—";
  const maxVisits = Math.max(1, ...(report?.daily.map((day) => day.visits) || []));
  return (
    <section className={stylex(styles.dashboard)}>
      <header className={stylex(styles.heading)}>
        <div>
          <p className={stylex(styles.eyebrow)}>FROM TREES · STOREFRONT</p>
          <h1 className={stylex(styles.title)}>Cabinet configurator</h1>
          <p className={stylex(styles.intro)}>
            See what people are designing—and what brings them here.
          </p>
        </div>
        <div className={stylex(styles.controls)}>
          <label className={stylex(styles.controlLabel)}>
            Period
            <select
              className={stylex(styles.formFont, styles.controlButton, styles.focus)}
              value={days}
              onChange={(event) => {
                setDays(Number(event.target.value));
                setPage(0);
              }}
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </label>
          <button
            className={stylex(styles.button, styles.controlButton, styles.focus)}
            onClick={() => setReload((value) => value + 1)}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </header>
      {loading && <p role="status">Loading configurator activity…</p>}
      {error && (
        <div className={stylex(styles.notice)} role="alert">
          <h2 className={stylex(styles.cardTitle)}>Report unavailable</h2>
          <p className={stylex(styles.intro)}>{error}</p>
          <button
            className={stylex(styles.button, styles.controlButton, styles.focus)}
            onClick={() => setReload((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      )}
      {report && totals && (
        <>
          <div className={stylex(styles.metrics)}>
            {[
              ["Visits", number(totals.visits), "Tracked sessions"],
              ["Designs created", number(totals.designs), "New saved rooms, including copies"],
              [
                "Shares",
                number(totals.shares),
                `${number(totals.emails)} emails accepted by provider*`,
              ],
              ["Price requests", number(totals.prices), "Successfully prepared estimates"],
              [
                "Leads",
                number(totals.leads),
                `${number(totals.leadSubmissions)} consenting submissions`,
              ],
              ["Visit → lead", conversion, "Tracked visits with a consenting lead"],
            ].map(([label, value, note]) => (
              <article key={label} className={stylex(styles.metric)}>
                <h2 className={stylex(styles.metricLabel)}>{label}</h2>
                <strong className={stylex(styles.metricValue)}>{value}</strong>
                <p className={stylex(styles.metricNote)}>{note}</p>
              </article>
            ))}
          </div>
          <p className={stylex(styles.coverage)}>
            {report.trackingStartedAt
              ? `Visit, new-design, and email acceptance tracking began ${date(report.trackingStartedAt)}. `
              : "Visit tracking coverage is unavailable. "}
            Visits represent sessions, not unique people. Earlier
            shares, price requests, and leads are included when available. *Email acceptance does
            not confirm inbox delivery.
          </p>
          <div className={stylex(styles.grid)}>
            <section className={stylex(styles.card)}>
              <div className={stylex(styles.cardHeading)}>
                <h2 className={stylex(styles.cardTitle)}>Visits over time</h2>
                <span className={stylex(styles.cardMeta)}>Daily · UTC</span>
              </div>
              {totals.visits === 0 ? (
                <p className={stylex(styles.empty)}>No tracked visits in this period.</p>
              ) : (
                <div
                  className={stylex(styles.chart)}
                  role="img"
                  aria-label={`${number(totals.visits)} visits over the last ${days} days`}
                >
                  {Array.from({ length: days + 1 }, (_, index) => {
                    const key = new Date(new Date(report.start).getTime() + index * 86400000)
                      .toISOString()
                      .slice(0, 10);
                    const count = report.daily.find((day) => day.date === key)?.visits || 0;
                    return (
                      <div key={key} className={stylex(styles.barColumn)}>
                        <div
                          className={stylex(styles.bar)}
                          style={{ height: `${(count / maxVisits) * 100}%` }}
                          title={`${key}: ${count} visits`}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
              <div className={stylex(styles.chartLabels)}>
                <span className={stylex(styles.cardMeta)}>{date(report.start)}</span>
                <span className={stylex(styles.cardMeta)}>{date(report.end)}</span>
              </div>
            </section>
            <section className={stylex(styles.card)}>
              <div className={stylex(styles.cardHeading)}>
                <h2 className={stylex(styles.cardTitle)}>Traffic sources</h2>
                <span className={stylex(styles.cardMeta)}>Top 50 · tracked visits</span>
              </div>
              <div className={stylex(styles.tableScroll)}>
                <table className={stylex(styles.table)}>
                  <thead>
                    <tr>
                      <th className={stylex(styles.th)}>Source / campaign</th>
                      <th className={stylex(styles.th)}>Visits</th>
                      <th className={stylex(styles.th)}>Shares</th>
                      <th className={stylex(styles.th)}>Lead visits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.sources.map((source, index) => (
                      <tr key={index}>
                        <td className={stylex(styles.td)}>
                          <strong className={stylex(styles.tableStrong)}>{source.source}</strong>
                          <small className={stylex(styles.tableSmall)}>
                            {source.medium}
                            {source.campaign ? ` · ${source.campaign}` : ""}
                          </small>
                        </td>
                        <td className={stylex(styles.td)}>{source.visits}</td>
                        <td className={stylex(styles.td)}>{source.shares}</td>
                        <td className={stylex(styles.td)}>{source.convertedVisits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!report.sources.length && (
                <p className={stylex(styles.empty)}>
                  Traffic sources will appear as tracked visits arrive.
                </p>
              )}
              <p className={stylex(styles.footnote)}>
                Source is the first referrer or campaign tag seen in that browser-tab session.
                Untagged and untracked activity cannot be attributed.
              </p>
            </section>
          </div>
          <section className={stylex(styles.card)}>
            <div className={stylex(styles.cardHeading)}>
              <div>
                <h2 className={stylex(styles.cardTitle)}>Recent designs</h2>
                <p className={stylex(styles.intro)}>
                  Rooms updated during this period. Share snapshots are excluded.
                </p>
              </div>
              <span className={stylex(styles.cardMeta)}>Page {page + 1}</span>
            </div>
            <div className={stylex(styles.designs)}>
              {report.designs.map((design) => (
                <button
                  key={design.slug}
                  className={stylex(styles.button, styles.focus, styles.design)}
                  data-button-layout="card"
                  onClick={() => void inspect(design.slug, design)}
                >
                  <PlanPreview
                    plan={design.preview}
                    label={`Plan of design ${design.slug.slice(0, 8)}`}
                  />
                  <div className={stylex(styles.designInfo)}>
                    <strong className={stylex(styles.designTitle)}>
                      Design {design.slug.slice(0, 8)}
                    </strong>
                    <span className={stylex(styles.designMeta)}>
                      {design.preview?.elements.length ?? "—"} elements · Updated{" "}
                      {date(design.updated_at)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
            {!report.designs.length && (
              <p className={stylex(styles.empty)}>
                No designs on this page for the selected period.
              </p>
            )}
          </section>
          <section className={stylex(styles.card)}>
            <div className={stylex(styles.cardHeading)}>
              <div>
                <h2 className={stylex(styles.cardTitle)}>Consenting leads</h2>
                <p className={stylex(styles.intro)}>
                  People who asked to be contacted. Share recipients are never included.
                </p>
              </div>
              <span className={stylex(styles.cardMeta)}>Page {page + 1}</span>
            </div>
            <div className={stylex(styles.tableScroll)}>
              <table className={stylex(styles.table)}>
                <thead>
                  <tr>
                    <th className={stylex(styles.th)}>Contact</th>
                    <th className={stylex(styles.th)}>Phone</th>
                    <th className={stylex(styles.th)}>Created through</th>
                    <th className={stylex(styles.th)}>Received</th>
                    <th className={stylex(styles.th)}>Design</th>
                  </tr>
                </thead>
                <tbody>
                  {report.leads.map((lead) => (
                    <tr key={lead.request_id}>
                      <td className={stylex(styles.td)}>
                        <strong className={stylex(styles.tableStrong)}>{lead.sender_name}</strong>
                        <small className={stylex(styles.tableSmall)}>{lead.sender_email}</small>
                      </td>
                      <td className={stylex(styles.td)}>{lead.sender_phone || "—"}</td>
                      <td className={stylex(styles.td)}>
                        {lead.lead_source === "price" ? "Price request" : "Share"}
                      </td>
                      <td className={stylex(styles.td)}>{date(lead.consent_at)}</td>
                      <td className={stylex(styles.td)}>
                        <button
                          className={stylex(styles.button, styles.focus, styles.textButton)}
                          onClick={() => void inspect(lead.room_slug)}
                        >
                          View design
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!report.leads.length && (
              <p className={stylex(styles.empty)}>
                No consenting leads on this page for the selected period.
              </p>
            )}
          </section>
          <footer className={stylex(styles.pagination)}>
            <button
              className={stylex(styles.button, styles.controlButton, styles.focus)}
              disabled={page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous page
            </button>
            <span className={stylex(styles.cardMeta, styles.paginationMeta)}>
              Designs and leads · Page {page + 1}
            </span>
            <button
              className={stylex(styles.button, styles.controlButton, styles.focus)}
              disabled={!report.hasMoreDesigns && !report.hasMoreLeads}
              onClick={() => setPage((value) => value + 1)}
            >
              Next page
            </button>
          </footer>
        </>
      )}
      <dialog
        ref={dialog}
        className={stylex(styles.dialog)}
        onClose={() => {
          detailRequest.current++;
        }}
      >
        <div className={stylex(styles.cardHeading)}>
          <h2 className={stylex(styles.cardTitle)}>Design preview</h2>
          <button
            className={stylex(styles.button, styles.controlButton, styles.focus)}
            aria-label="Close design preview"
            onClick={() => dialog.current?.close()}
          >
            Close
          </button>
        </div>
        {designLoading && <p role="status">Loading design…</p>}
        {designError && <p role="alert">{designError}</p>}
        {selected && (
          <>
            <PlanPreview plan={selected.preview} expanded label="Cabinet design floor plan" />
            <p className={stylex(styles.intro)}>
              Design {selected.slug.slice(0, 8)} · Revision {selected.revision} · Updated{" "}
              {date(selected.updated_at)}
            </p>
            <p className={stylex(styles.intro)}>
              {selected.preview
                ? `${selected.preview.width}″ × ${selected.preview.depth}″ · ${selected.preview.elements.length} elements`
                : "Preview unavailable"}
            </p>
            <p className={stylex(styles.footnote)}>
              Read-only plan of the saved design. Upper cabinets appear lighter.
            </p>
          </>
        )}
      </dialog>
    </section>
  );
}
