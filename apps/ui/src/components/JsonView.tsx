import React from "react";

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
        <div className="json-children">
          {value.map((item, index) => (
            <div key={index} className="json-row">
              <span className="json-key">{index}</span>
              <span className="json-sep">:</span>
              <span className="json-value">{renderValue(item)}</span>
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
        <div className="json-children">
          {entries.map(([key, item]) => (
            <div key={key} className="json-row">
              <span className="json-key">{key}</span>
              <span className="json-sep">:</span>
              <span className="json-value">{renderValue(item)}</span>
            </div>
          ))}
        </div>
      </details>
    );
  }
  return String(value);
}

export function JsonView({ data }: { data: unknown }): JSX.Element {
  return <div className="json-view">{renderValue(data)}</div>;
}
