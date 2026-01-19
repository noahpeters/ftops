import React from "react";
import stylex from "~/lib/stylex";

const styles = stylex.create({
  jsonView: {
    fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: "12px",
    color: "#0f172a",
  },
  jsonChildren: {
    paddingLeft: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  jsonRow: {
    display: "flex",
    gap: "6px",
    alignItems: "baseline",
  },
  jsonKey: {
    color: "#334155",
    fontWeight: 600,
  },
  jsonSep: {
    color: "#94a3b8",
  },
  jsonValue: {
    color: "#0f172a",
  },
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function renderValue(value: unknown): React.ReactNode {
  if (value === null) return "null";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return (
      <details open>
        <summary>[{value.length}]</summary>
        <div className={stylex(styles.jsonChildren)}>
          {value.map((item, index) => (
            <div key={index} className={stylex(styles.jsonRow)}>
              <span className={stylex(styles.jsonKey)}>{index}</span>
              <span className={stylex(styles.jsonSep)}>:</span>
              <span className={stylex(styles.jsonValue)}>{renderValue(item)}</span>
            </div>
          ))}
        </div>
      </details>
    );
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    return (
      <details open>
        <summary>
          {"{...}"} {entries.length} keys
        </summary>
        <div className={stylex(styles.jsonChildren)}>
          {entries.map(([key, item]) => (
            <div key={key} className={stylex(styles.jsonRow)}>
              <span className={stylex(styles.jsonKey)}>{key}</span>
              <span className={stylex(styles.jsonSep)}>:</span>
              <span className={stylex(styles.jsonValue)}>{renderValue(item)}</span>
            </div>
          ))}
        </div>
      </details>
    );
  }
  return String(value);
}

export function JsonView({ data }: { data: unknown }): JSX.Element {
  return <div className={stylex(styles.jsonView)}>{renderValue(data)}</div>;
}
