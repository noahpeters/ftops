import { useEffect, useRef, useState } from "react";
import { buildUrl, fetchJson } from "../../lib/api";
import stylex from "~/lib/stylex";
import { styles } from "./styles";
const SETTINGS = {
  carcassThickness: { label: "Carcass stock thickness", value: 0.75 },
  dadoDepth: { label: "Carcass dado / rabbet depth", value: 0.375 },
  backThickness: { label: "Back thickness", value: 0.25 },
  backGrooveDepth: { label: "Back groove depth", value: 0.25 },
  stretcherWidth: { label: "Top stretcher / back nailer width", value: 3 },
  drawerThickness: { label: "Drawer stock thickness", value: 0.625 },
  drawerRabbetDepth: { label: "Drawer rabbet depth", value: 0.3125 },
  drawerBottomThickness: { label: "Drawer bottom thickness", value: 0.375 },
  drawerGrooveDepth: { label: "Drawer bottom groove depth", value: 0.25 },
  drawerBottomInset: { label: "Drawer bottom height above box bottom", value: 0.5 },
  drawerSideHeight: { label: "Maximum drawer side height", value: 6 },
  drawerWidthDeduction: { label: "Drawer width deduction from clear opening", value: 1.25 },
  drawerDepthDeduction: { label: "Drawer depth deduction from cabinet depth", value: 3 },
  shakerRailWidth: { label: "Shaker rail / stile width", value: 2.25 },
  shakerPanelThickness: { label: "Shaker panel thickness", value: 0.25 },
  shakerGrooveDepth: { label: "Shaker groove / stub-tenon depth", value: 0.25 },
} as const;
type Setting = keyof typeof SETTINGS;
type Bundle = {
  filename: string;
  ruby: string;
  csv: string;
  manifest: { parts: unknown[]; assumptions: string[]; excluded: string[] };
  error?: string;
  issues?: string[];
};
export function SketchupExport({ slug, revision }: { slug: string; revision: number }) {
  const [values, setValues] = useState(
    () =>
      Object.fromEntries(
        Object.entries(SETTINGS).map(([key, v]) => [key, String(v.value)])
      ) as Record<Setting, string>
  );
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const generate = async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setErrors([]);
    setBundle(null);
    try {
      const result = await fetchJson<Bundle>(
        buildUrl("/configurator/export", { slug, revision, ...values }),
        { signal: current.signal }
      );
      if (current.signal.aborted) return;
      if (
        !result.ok ||
        !result.data?.ruby ||
        !result.data?.csv ||
        !/^From-Trees-[a-f0-9]{8}-r[1-9][0-9]*$/.test(result.data.filename)
      ) {
        const message =
          result.status === 409
            ? "The saved design changed. Refresh the dashboard and reopen this design before exporting."
            : result.status === 403
              ? "SketchUp export is available only to system administrators."
              : result.status === 422
                ? "This design needs fabrication review before it can be exported."
                : "The export could not be generated. Check the construction settings and try again.";
        setErrors([message, ...(result.data?.issues ?? [])]);
        return;
      }
      setBundle(result.data);
    } catch {
      if (!current.signal.aborted) setErrors(["The export could not be loaded. Please try again."]);
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  };
  const download = (kind: "ruby" | "csv" | "manifest") => {
    if (!bundle) return;
    const extensions = { ruby: "rb", csv: "csv", manifest: "json" };
    const content = kind === "manifest" ? JSON.stringify(bundle.manifest, null, 2) : bundle[kind];
    const url = URL.createObjectURL(
      new Blob([content], {
        type: kind === "manifest" ? "application/json" : "text/plain;charset=utf-8",
      })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${bundle.filename}.${extensions[kind]}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section aria-label="SketchUp export" className={stylex(styles.card)}>
      <h3 className={stylex(styles.cardTitle)}>SketchUp model and parts</h3>
      <p className={stylex(styles.intro)}>
        Build this saved revision as individual solid components. From Trees construction uses dados
        and rabbets, 3/4″ carcasses and 5/8″ drawer boxes. Review the first-pass settings before
        cutting.
      </p>
      <details>
        <summary>Construction settings · inches</summary>
        <div className={stylex(styles.controls)}>
          {(Object.keys(SETTINGS) as Setting[]).map((key) => (
            <label key={key} className={stylex(styles.controlLabel)}>
              {SETTINGS[key].label}
              <input
                type="number"
                min="0.001"
                max="12"
                step="0.0625"
                value={values[key]}
                disabled={busy}
                onChange={(e) => {
                  setBundle(null);
                  setValues((v) => ({ ...v, [key]: e.target.value }));
                }}
                className={stylex(styles.formFont, styles.controlButton, styles.focus)}
              />
            </label>
          ))}
        </div>
      </details>
      <button
        type="button"
        className={stylex(styles.button, styles.controlButton, styles.focus)}
        onClick={() => void generate()}
        disabled={busy}
      >
        {busy ? "Preparing model…" : "Generate SketchUp export"}
      </button>
      {errors.length > 0 && (
        <div role="alert">
          <ul>
            {errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}
      {bundle && (
        <>
          <p role="status">
            {bundle.manifest.parts.length} solid parts prepared for revision {revision}.
          </p>
          <div className={stylex(styles.controls)}>
            <button
              type="button"
              className={stylex(styles.button, styles.controlButton, styles.focus)}
              onClick={() => download("ruby")}
            >
              Download SketchUp script
            </button>
            <button
              type="button"
              className={stylex(styles.button, styles.controlButton, styles.focus)}
              onClick={() => download("csv")}
            >
              Download parts CSV
            </button>
            <button
              type="button"
              className={stylex(styles.button, styles.controlButton, styles.focus)}
              onClick={() => download("manifest")}
            >
              Download construction specification
            </button>
          </div>
          <p className={stylex(styles.footnote)}>
            Open a new model in SketchUp Desktop 2022 or newer. In the Ruby Console, run{" "}
            <code>{`load '/full/path/to/${bundle.filename}.rb'`}</code>. The script builds the model
            and offers to save a .skp file. Existing model content is preserved; import can be
            undone.
          </p>
          <details>
            <summary>Assumptions and exclusions</summary>
            <ul>
              {[...bundle.manifest.assumptions, ...bundle.manifest.excluded].map((value) => (
                <li key={value}>{value}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
