import { useEffect, useRef, useState } from "react";
import { buildUrl, fetchJson } from "../../lib/api";
import stylex from "~/lib/stylex";
import { styles } from "./styles";
type Totals = { cost: number; price: number; profit: number; profitMargin: number | null };
type Bundle = {
  filename: string;
  csv: string;
  ratesUpdatedAt: string;
  error?: string;
  report: { totals: Totals; cabinets: (Totals & { id: string; kind: string })[] };
};
const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const margin = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(2)}%`);
export function CostReport({ slug, revision }: { slug: string; revision: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const download = async () => {
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError("");
    setBundle(null);
    try {
      const result = await fetchJson<Bundle>(
        buildUrl("/configurator/cost-report", { slug, revision }),
        { signal: current.signal }
      );
      if (current.signal.aborted) return;
      if (!result.ok || !result.data)
        throw new Error(
          result.data?.error === "design_revision_changed"
            ? "This design has changed. Refresh the configurator view and reopen it before downloading."
            : "The cost / price report is unavailable. Check the pricing configuration or try again."
        );
      const data = result.data;
      const url = URL.createObjectURL(new Blob([data.csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = data.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setBundle(data);
    } catch (err) {
      if (!current.signal.aborted)
        setError(err instanceof Error ? err.message : "Unable to download report.");
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  };
  return (
    <section className={stylex(styles.card)}>
      <h3 className={stylex(styles.cardTitle)}>Cost / price report</h3>
      <p className={stylex(styles.footnote)}>
        Internal estimate in USD using current rates. Includes selected option costs, cabinet
        prices, costs, profit and profit margin. Shared material purchases and overhead are
        allocated; exclusions and assumptions are included in the CSV.
      </p>
      <button
        className={stylex(styles.button, styles.controlButton, styles.focus)}
        disabled={busy}
        onClick={() => void download()}
      >
        {busy ? "Preparing report…" : "Download cost / price report (CSV)"}
      </button>
      {error && <p role="alert">{error}</p>}
      {bundle && (
        <>
          <p role="status">
            Report downloaded · Rates updated {new Date(bundle.ratesUpdatedAt).toLocaleString()}
          </p>
          <div className={stylex(styles.tableScroll)}>
            <table className={stylex(styles.table)}>
              <thead>
                <tr>
                  {["Cabinet", "Cost", "Price", "Profit", "Profit margin"].map((label) => (
                    <th key={label} className={stylex(styles.th)}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bundle.report.cabinets.map((cabinet) => (
                  <tr key={cabinet.id}>
                    <td className={stylex(styles.td)}>
                      {cabinet.kind} · {cabinet.id}
                    </td>
                    <td className={stylex(styles.td)}>{money(cabinet.cost)}</td>
                    <td className={stylex(styles.td)}>{money(cabinet.price)}</td>
                    <td className={stylex(styles.td)}>{money(cabinet.profit)}</td>
                    <td className={stylex(styles.td)}>{margin(cabinet.profitMargin)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th className={stylex(styles.th)}>Project total</th>
                  <td className={stylex(styles.td)}>{money(bundle.report.totals.cost)}</td>
                  <td className={stylex(styles.td)}>{money(bundle.report.totals.price)}</td>
                  <td className={stylex(styles.td)}>{money(bundle.report.totals.profit)}</td>
                  <td className={stylex(styles.td)}>{margin(bundle.report.totals.profitMargin)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
