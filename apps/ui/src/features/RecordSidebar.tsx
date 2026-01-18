import { useEffect, useMemo, useState } from "react";
import { listCommercialRecords } from "./commercialRecords";
import type { CommercialRecordListItem } from "./commercialRecords";

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

  const filteredRecords = useMemo(() => records, [records]);

  return (
    <aside className="record-sidebar">
      <div className="record-sidebar-header">
        <h3>Commercial Records</h3>
        <button type="button" onClick={() => fetchRecords(query)}>
          Refresh
        </button>
      </div>
      <label className="record-search">
        Search
        <input
          type="text"
          placeholder="uri, customer, external_id"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {loading && <div className="empty">Loading records...</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && filteredRecords.length === 0 && (
        <div className="empty">No records found.</div>
      )}

      <div className="record-list">
        {filteredRecords.map((record) => {
          const isSelected = record.uri === selectedUri;
          return (
            <button
              key={record.uri}
              type="button"
              className={isSelected ? "active" : ""}
              onClick={() => onSelect(record.uri)}
            >
              <div className="record-uri">{shorten(record.uri)}</div>
              <div className="record-meta">
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
