import { useEffect, useRef, useState } from "react";
import {
  sketchupContext,
  importMessage,
  matchingImportResult,
  type SketchupHost,
} from "./sketchupBridge";
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
  const [bridge, setBridge] = useState<ReturnType<typeof sketchupContext>>(null);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [installing, setInstalling] = useState(false);
  const pending = useRef<{ nonce: string; requestId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const host = (window as Window & { sketchup?: SketchupHost }).sketchup;
    setBridge(sketchupContext(window.location.search, host));
    const receive = (event: Event) => {
      if (!pending.current) return;
      const result = matchingImportResult(
        (event as CustomEvent).detail,
        pending.current.nonce,
        pending.current.requestId
      );
      if (!result) return;
      pending.current = null;
      setImporting(false);
      if (result.ok) setImportStatus(result.message);
      else setErrors([result.message]);
    };
    window.addEventListener("from-trees:import-result", receive);
    return () => {
      controller.current?.abort();
      window.removeEventListener("from-trees:import-result", receive);
    };
  }, []);
  const generate = async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setErrors([]);
    setBundle(null);
    setImportStatus("");
    try {
      const result = await fetchJson<Bundle>(
        buildUrl("/configurator/export", { slug, revision, ...values }),
        { signal: current.signal }
      );
      if (current.signal.aborted) return;
      if (
        !result.ok ||
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
  const install = async () => {
    setInstalling(true);
    setErrors([]);
    try {
      const result = await fetchJson<{ filename: string; data: string; sha256: string }>(
        buildUrl("/configurator/extension")
      );
      if (
        !result.ok ||
        !result.data ||
        !/^from-trees-cabinet-designer-[0-9.]+\.rbz$/.test(result.data.filename)
      )
        throw new Error("Could not download the extension.");
      const bytes = Uint8Array.from(atob(result.data.data), (c) => c.charCodeAt(0));
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (v) =>
        v.toString(16).padStart(2, "0")
      ).join("");
      if (hash !== result.data.sha256)
        throw new Error("The extension download was incomplete. Try again.");
      saveBlob(new Blob([bytes], { type: "application/zip" }), result.data.filename);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Could not download the extension."]);
    } finally {
      setInstalling(false);
    }
  };
  const importDesign = () => {
    if (!bridge || !bundle || importing) return;
    const requestId = crypto.randomUUID();
    pending.current = { nonce: bridge.nonce, requestId };
    setImporting(true);
    setErrors([]);
    setImportStatus("");
    try {
      bridge.send(importMessage(bridge.nonce, requestId, bundle.manifest));
    } catch {
      pending.current = null;
      setImporting(false);
      setErrors(["The SketchUp connection was lost. Reopen From Trees → Cabinet Designer."]);
    }
  };
  const saveBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const download = (kind: "csv" | "manifest") => {
    if (!bundle) return;
    const extensions = { csv: "csv", manifest: "json" };
    const content = kind === "manifest" ? JSON.stringify(bundle.manifest, null, 2) : bundle[kind];
    saveBlob(
      new Blob([content], {
        type: kind === "manifest" ? "application/json" : "text/csv;charset=utf-8",
      }),
      `${bundle.filename}.${extensions[kind]}`
    );
  };
  return (
    <section aria-label="SketchUp export" className={stylex(styles.card)}>
      <h3 className={stylex(styles.cardTitle)}>SketchUp model and parts</h3>
      <p className={stylex(styles.intro)}>
        Build this saved revision as individual solid components. From Trees construction uses dados
        and rabbets, 3/4″ carcasses and 5/8″ drawer boxes. Review the first-pass settings before
        cutting.
      </p>
      {!bridge && (
        <>
          <button
            type="button"
            className={stylex(styles.button, styles.controlButton, styles.focus)}
            onClick={() => void install()}
            disabled={installing}
          >
            {installing ? "Downloading extension…" : "Download SketchUp extension (.rbz)"}
          </button>
          <p className={stylex(styles.footnote)}>
            Install once using SketchUp’s Extension Manager. Then open Extensions → From Trees →
            Cabinet Designer, sign into FTOPS and select a design. Requires SketchUp Desktop 2022 or
            newer.
          </p>
        </>
      )}
      {bridge && (
        <p className={stylex(styles.intro)}>
          Connected to SketchUp. Import adds this design to your current model and can be undone.
          Open a new model first if you want a separate cabinet file.
        </p>
      )}
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
                disabled={busy || importing}
                onChange={(e) => {
                  setBundle(null);
                  setImportStatus("");
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
        disabled={busy || importing}
      >
        {busy ? "Preparing model…" : "Generate SketchUp export"}
      </button>
      {importStatus && <p role="status">{importStatus}</p>}
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
              onClick={importDesign}
              disabled={!bridge || importing}
            >
              {importing ? "Building components…" : "Import into SketchUp"}
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
            {bridge
              ? "After importing, save your SketchUp model as .skp. Each stock part is a solid component with grain and machining data."
              : "Direct import is available when you open this page from the From Trees extension inside SketchUp."}
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
