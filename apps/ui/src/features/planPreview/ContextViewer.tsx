import { useMemo, useState } from "react";

type ProjectContext = {
  type: "project";
  key: string;
  record_uri: string;
  customer_display?: string | null;
  quoted_delivery_date?: string | null;
  quoted_install_date?: string | null;
  snapshot_hash?: string | null;
};

type DeliverableContext = {
  type: "deliverable";
  key: string;
  record_uri: string;
  line_item_uri: string;
  title?: string | null;
  category_key?: string | null;
  deliverable_key?: string | null;
  group_key?: string | null;
  quantity?: number | null;
  position?: number | null;
  config?: Record<string, unknown> | null;
  config_hash?: string | null;
  configParseError?: string;
};

type SharedContext = {
  type: "shared";
  key: string;
  record_uri: string;
  group_key: string;
  line_items: Array<{
    line_item_uri: string;
    title?: string | null;
    category_key?: string | null;
    deliverable_key?: string | null;
    position?: number | null;
  }>;
  derived?: {
    requiresSamples?: boolean;
    installRequired?: boolean;
    deliveryRequired?: boolean;
  };
};

type MatchedTemplate = {
  templateKey: string;
  title?: string | null;
  kind?: string;
  default_position?: number | null;
  rulePriority: number;
  ruleId: string;
};

type ContextViewerProps = {
  data: unknown;
};

export function ContextViewer({ data }: ContextViewerProps): JSX.Element | null {
  const [showRuleIds, setShowRuleIds] = useState(false);
  const [selectedDeliverable, setSelectedDeliverable] = useState<string | null>(null);
  const [deliverableQuery, setDeliverableQuery] = useState("");

  const contexts = useMemo(() => {
    return (data as { contexts?: unknown })?.contexts as
      | {
          project?: ProjectContext;
          shared?: SharedContext[];
          deliverables?: DeliverableContext[];
        }
      | undefined;
  }, [data]);

  const matchedTemplatesByContext = useMemo(() => {
    return (
      (data as { matchedTemplatesByContext?: Record<string, MatchedTemplate[]> })
        ?.matchedTemplatesByContext ?? {}
    );
  }, [data]);

  const shared = useMemo(
    () => (Array.isArray(contexts?.shared) ? (contexts?.shared ?? []) : []),
    [contexts]
  );
  const deliverables = useMemo(
    () => (Array.isArray(contexts?.deliverables) ? (contexts?.deliverables ?? []) : []),
    [contexts]
  );

  const filteredDeliverables = useMemo(() => {
    const query = deliverableQuery.trim().toLowerCase();
    if (!query) return deliverables;
    return deliverables.filter((deliverable) => {
      const matchKey = `deliverable::${deliverable.key}`;
      const matched = matchedTemplatesByContext[matchKey] ?? [];
      const templateText = matched
        .map((item) => `${item.templateKey} ${item.title ?? ""}`)
        .join(" ");
      const haystack = [
        deliverable.key,
        deliverable.title,
        deliverable.category_key,
        deliverable.deliverable_key,
        deliverable.group_key,
        templateText,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [deliverables, deliverableQuery, matchedTemplatesByContext]);

  const getMatches = (type: string, key: string) =>
    matchedTemplatesByContext[`${type}::${key}`] ?? [];

  if (!contexts || !contexts.project) {
    return null;
  }

  return (
    <div className="context-panel">
      <div className="context-panel-header">
        <div>
          <h3>Contexts</h3>
          <p>Derived contexts and rule matches for this record.</p>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={showRuleIds}
            onChange={(event) => setShowRuleIds(event.target.checked)}
          />
          Show rule IDs
        </label>
      </div>

      <div className="context-section">
        <h4>Project</h4>
        <details className="context-card" open>
          <summary className="context-summary">
            <span className="context-badge project">Project</span>
            <span className="context-key">{shorten(contexts.project.key)}</span>
            {contexts.project.customer_display && (
              <span className="context-title">{contexts.project.customer_display}</span>
            )}
          </summary>
          <div className="context-body">
            <div className="context-meta">
              <div>
                <strong>record_uri:</strong> {contexts.project.record_uri}
              </div>
              <div>
                <strong>quoted_delivery_date:</strong>{" "}
                {contexts.project.quoted_delivery_date ?? "n/a"}
              </div>
              <div>
                <strong>quoted_install_date:</strong>{" "}
                {contexts.project.quoted_install_date ?? "n/a"}
              </div>
              <div>
                <strong>snapshot_hash:</strong> {contexts.project.snapshot_hash ?? "n/a"}
              </div>
            </div>
            <MatchesList
              matches={getMatches("project", contexts.project.key)}
              showRuleIds={showRuleIds}
            />
          </div>
        </details>
      </div>

      <div className="context-section">
        <h4>Shared</h4>
        {shared.length === 0 && <p className="muted">No shared contexts.</p>}
        {shared.map((context) => (
          <details className="context-card" key={context.key}>
            <summary className="context-summary">
              <span className="context-badge shared">Shared</span>
              <span className="context-key">{shorten(context.key)}</span>
              <span className="context-title">{context.line_items.length} line items</span>
            </summary>
            <div className="context-body">
              <div className="context-meta">
                <div>
                  <strong>group_key:</strong> {context.group_key}
                </div>
                <div>
                  <strong>requiresSamples:</strong>{" "}
                  {String(context.derived?.requiresSamples ?? false)}
                </div>
                <div>
                  <strong>installRequired:</strong>{" "}
                  {String(context.derived?.installRequired ?? false)}
                </div>
                <div>
                  <strong>deliveryRequired:</strong>{" "}
                  {String(context.derived?.deliveryRequired ?? false)}
                </div>
              </div>
              <div className="context-list">
                {context.line_items.map((item) => (
                  <div key={item.line_item_uri}>
                    {shorten(item.line_item_uri)} — {item.title ?? "Untitled"} ({item.category_key}/
                    {item.deliverable_key})
                  </div>
                ))}
              </div>
              <MatchesList matches={getMatches("shared", context.key)} showRuleIds={showRuleIds} />
            </div>
          </details>
        ))}
      </div>

      <div className="context-section">
        <div className="context-section-header">
          <h4>Deliverables</h4>
          <div className="context-controls">
            <input
              type="text"
              placeholder="Search deliverables..."
              value={deliverableQuery}
              onChange={(event) => setDeliverableQuery(event.target.value)}
            />
            {selectedDeliverable && (
              <button
                type="button"
                className="secondary"
                onClick={() => setSelectedDeliverable(null)}
              >
                Clear selection
              </button>
            )}
          </div>
        </div>
        {filteredDeliverables.length === 0 && (
          <p className="muted">No deliverable contexts match.</p>
        )}
        {filteredDeliverables.map((context) => {
          const matches = getMatches("deliverable", context.key);
          const isSelected = selectedDeliverable === context.key;
          const showMatches = !selectedDeliverable || selectedDeliverable === context.key;
          return (
            <details
              className={`context-card ${isSelected ? "selected" : ""}`.trim()}
              key={context.key}
              onClick={() => setSelectedDeliverable(isSelected ? null : context.key)}
            >
              <summary className="context-summary">
                <span className="context-badge deliverable">Deliverable</span>
                <span className="context-key">{shorten(context.key)}</span>
                <span className="context-title">{context.title ?? "Untitled"}</span>
                <span className="context-meta-inline">
                  {context.category_key}/{context.deliverable_key}
                </span>
                {context.group_key && (
                  <span className="context-meta-inline">group: {context.group_key}</span>
                )}
              </summary>
              <div className="context-body">
                <div className="context-meta">
                  <div>
                    <strong>quantity:</strong> {context.quantity ?? 0}
                  </div>
                  <div>
                    <strong>position:</strong> {context.position ?? "n/a"}
                  </div>
                  <div>
                    <strong>config_hash:</strong> {context.config_hash ?? "n/a"}
                  </div>
                  {context.configParseError && (
                    <div className="error">
                      <strong>config error:</strong> {context.configParseError}
                    </div>
                  )}
                </div>
                {context.config && (
                  <pre className="context-json">{JSON.stringify(context.config, null, 2)}</pre>
                )}
                {showMatches && <MatchesList matches={matches} showRuleIds={showRuleIds} />}
                {!showMatches && <p className="muted">Select to view matches.</p>}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function MatchesList({
  matches,
  showRuleIds,
}: {
  matches: MatchedTemplate[];
  showRuleIds: boolean;
}) {
  if (!matches.length) {
    return <p className="muted">No matching templates.</p>;
  }
  return (
    <div className="context-matches">
      <strong>Matched templates</strong>
      <ul>
        {matches.map((match, index) => (
          <li key={`${match.templateKey}-${match.ruleId}-${index}`}>
            <span className="match-title">{match.title ?? match.templateKey}</span>
            <span className="match-key">{match.templateKey}</span>
            <span className="match-meta">priority {match.rulePriority}</span>
            {showRuleIds && <span className="match-meta">rule {match.ruleId}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function shorten(value: string, max = 36) {
  if (value.length <= max) return value;
  return `${value.slice(0, 18)}…${value.slice(-14)}`;
}
