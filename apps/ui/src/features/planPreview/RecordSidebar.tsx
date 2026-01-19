"use client";

import { useEffect, useState } from "react";
import stylex from "~/lib/stylex";
import { colors, radius } from "../../theme/tokens.stylex";
import { listCommercialRecords } from "../api/commercialRecords";
import type { CommercialRecordListItem } from "../api/commercialRecords";

const styles = stylex.create({
  sidebar: {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    padding: "12px",
    backgroundColor: colors.surface,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  search: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    fontSize: "12px",
  },
  empty: {
    color: colors.textSubtle,
  },
  error: {
    color: colors.errorText,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  listItem: {
    textAlign: "left",
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    padding: "10px",
    backgroundColor: colors.surfaceAlt,
    cursor: "pointer",
  },
  listItemActive: {
    borderColor: colors.accent,
    backgroundColor: colors.neutralBg,
  },
  recordUri: {
    fontWeight: 600,
    fontSize: "12px",
  },
  recordMeta: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    fontSize: "11px",
    color: colors.textMuted,
  },
});

type RecordSidebarProps = {
  selectedUri: string;
  onSelect: (uri: string) => void;
};

export function RecordSidebar({ selectedUri, onSelect }: RecordSidebarProps): JSX.Element {
  const [records, setRecords] = useState<CommercialRecordListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      void fetchRecords(query);
    }, 300);

    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    void fetchRecords("");
  }, []);

  async function fetchRecords(nextQuery: string): Promise<void> {
    setLoading(true);
    setError(null);
    const result = await listCommercialRecords({
      limit: 50,
      offset: 0,
      query: nextQuery || undefined,
    });

    if (!result.ok) {
      const apiError =
        result.data && typeof result.data === "object"
          ? (result.data as { error?: string }).error
          : undefined;
      if (apiError === "commercial_schema_not_installed") {
        setError("Commercial schema is not installed in this environment yet.");
      } else {
        setError(result.text || "Failed to load commercial records.");
      }
      setRecords([]);
      setLoading(false);
      return;
    }

    setRecords(result.data?.records ?? []);
    setLoading(false);
  }

  return (
    <aside className={stylex(styles.sidebar)}>
      <div className={stylex(styles.header)}>
        <h3>Commercial Records</h3>
        <button type="button" onClick={() => fetchRecords(query)}>
          Refresh
        </button>
      </div>
      <label className={stylex(styles.search)}>
        Search
        <input
          type="text"
          placeholder="uri, customer, external_id"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {loading && <div className={stylex(styles.empty)}>Loading records...</div>}
      {error && <div className={stylex(styles.error)}>{error}</div>}

      {!loading && !error && records.length === 0 && (
        <div className={stylex(styles.empty)}>No records found.</div>
      )}

      <div className={stylex(styles.list)}>
        {records.map((record) => {
          const isSelected = record.uri === selectedUri;
          return (
            <button
              key={record.uri}
              type="button"
              className={stylex(styles.listItem, isSelected && styles.listItemActive)}
              onClick={() => onSelect(record.uri)}
            >
              <div className={stylex(styles.recordUri)}>{shorten(record.uri)}</div>
              <div className={stylex(styles.recordMeta)}>
                <span>
                  {record.source}/{record.kind}
                </span>
                {record.customer_display && <span>{record.customer_display}</span>}
                <span>{record.last_seen_at || "no last_seen_at"}</span>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function shorten(uri: string) {
  if (uri.length <= 48) return uri;
  return `${uri.slice(0, 24)}…${uri.slice(-16)}`;
}
