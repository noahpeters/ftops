"use client";

import { useMemo, useState } from "react";
import stylex from "~/lib/stylex";
import { colors, radius } from "../../theme/tokens.stylex";

const styles = stylex.create({
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    padding: "16px",
    backgroundColor: colors.surface,
  },
  panelHeader: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: "12px",
  },
  checkbox: {
    display: "inline-flex",
    gap: "6px",
    alignItems: "center",
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  controls: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },
  secondaryButton: {
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.surface,
    color: colors.text,
    padding: "6px 10px",
    borderRadius: radius.sm,
    cursor: "pointer",
  },
  muted: {
    color: colors.textSubtle,
  },
  card: {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    padding: "12px",
    backgroundColor: colors.surfaceAlt,
  },
  cardSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.neutralBg,
  },
  summary: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    alignItems: "center",
    cursor: "pointer",
  },
  badge: {
    padding: "2px 8px",
    borderRadius: "8px",
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    backgroundColor: colors.neutralBg,
    color: colors.neutralText,
  },
  badgeProject: {
    backgroundColor: colors.infoBg,
    color: colors.infoText,
  },
  badgeShared: {
    backgroundColor: colors.successBg,
    color: colors.successText,
  },
  badgeDeliverable: {
    backgroundColor: colors.errorBg,
    color: colors.errorText,
  },
  key: {
    fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: "12px",
  },
  title: {
    fontWeight: 600,
  },
  metaInline: {
    fontSize: "12px",
    color: colors.textSubtle,
  },
  body: {
    marginTop: "8px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  meta: {
    display: "grid",
    gap: "6px",
    fontSize: "12px",
    color: colors.textMuted,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  error: {
    color: colors.errorText,
  },
  json: {
    backgroundColor: colors.surfaceStrong,
    color: colors.text,
    padding: "10px",
    borderRadius: radius.sm,
    fontSize: "11px",
    overflowX: "auto",
  },
  matches: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    fontSize: "12px",
  },
  matchTitle: {
    fontWeight: 600,
  },
  matchKey: {
    color: colors.textMuted,
    marginLeft: "6px",
  },
  matchMeta: {
    color: colors.textSubtle,
    marginLeft: "6px",
  },
});

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
    <div className={stylex(styles.panel)}>
      <div className={stylex(styles.panelHeader)}>
        <div>
          <h3>Contexts</h3>
          <p>Derived contexts and rule matches for this record.</p>
        </div>
        <label className={stylex(styles.checkbox)}>
          <input
            type="checkbox"
            checked={showRuleIds}
            onChange={(event) => setShowRuleIds(event.target.checked)}
          />
          Show rule IDs
        </label>
      </div>

      <div className={stylex(styles.section)}>
        <h4>Project</h4>
        <details className={stylex(styles.card)} open>
          <summary className={stylex(styles.summary)}>
            <span className={stylex(styles.badge, styles.badgeProject)}>Project</span>
            <span className={stylex(styles.key)}>{shorten(contexts.project.key)}</span>
            {contexts.project.customer_display && (
              <span className={stylex(styles.title)}>{contexts.project.customer_display}</span>
            )}
          </summary>
          <div className={stylex(styles.body)}>
            <div className={stylex(styles.meta)}>
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

      <div className={stylex(styles.section)}>
        <h4>Shared</h4>
        {shared.length === 0 && <p className={stylex(styles.muted)}>No shared contexts.</p>}
        {shared.map((context) => (
          <details className={stylex(styles.card)} key={context.key}>
            <summary className={stylex(styles.summary)}>
              <span className={stylex(styles.badge, styles.badgeShared)}>Shared</span>
              <span className={stylex(styles.key)}>{shorten(context.key)}</span>
              <span className={stylex(styles.title)}>{context.line_items.length} line items</span>
            </summary>
            <div className={stylex(styles.body)}>
              <div className={stylex(styles.meta)}>
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
              <div className={stylex(styles.list)}>
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

      <div className={stylex(styles.section)}>
        <div className={stylex(styles.sectionHeader)}>
          <h4>Deliverables</h4>
          <div className={stylex(styles.controls)}>
            <input
              type="text"
              placeholder="Search deliverables..."
              value={deliverableQuery}
              onChange={(event) => setDeliverableQuery(event.target.value)}
            />
            {selectedDeliverable && (
              <button
                type="button"
                className={stylex(styles.secondaryButton)}
                onClick={() => setSelectedDeliverable(null)}
              >
                Clear selection
              </button>
            )}
          </div>
        </div>
        {filteredDeliverables.length === 0 && (
          <p className={stylex(styles.muted)}>No deliverable contexts match.</p>
        )}
        {filteredDeliverables.map((context) => {
          const matches = getMatches("deliverable", context.key);
          const isSelected = selectedDeliverable === context.key;
          const showMatches = !selectedDeliverable || selectedDeliverable === context.key;
          return (
            <details
              className={stylex(styles.card, isSelected && styles.cardSelected)}
              key={context.key}
              onClick={() => setSelectedDeliverable(isSelected ? null : context.key)}
            >
              <summary className={stylex(styles.summary)}>
                <span className={stylex(styles.badge, styles.badgeDeliverable)}>Deliverable</span>
                <span className={stylex(styles.key)}>{shorten(context.key)}</span>
                <span className={stylex(styles.title)}>{context.title ?? "Untitled"}</span>
                <span className={stylex(styles.metaInline)}>
                  {context.category_key}/{context.deliverable_key}
                </span>
                {context.group_key && (
                  <span className={stylex(styles.metaInline)}>group: {context.group_key}</span>
                )}
              </summary>
              <div className={stylex(styles.body)}>
                <div className={stylex(styles.meta)}>
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
                    <div className={stylex(styles.error)}>
                      <strong>config error:</strong> {context.configParseError}
                    </div>
                  )}
                </div>
                {context.config && (
                  <pre className={stylex(styles.json)}>
                    {JSON.stringify(context.config, null, 2)}
                  </pre>
                )}
                {showMatches && <MatchesList matches={matches} showRuleIds={showRuleIds} />}
                {!showMatches && <p className={stylex(styles.muted)}>Select to view matches.</p>}
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
    return <p className={stylex(styles.muted)}>No matching templates.</p>;
  }
  return (
    <div className={stylex(styles.matches)}>
      <strong>Matched templates</strong>
      <ul>
        {matches.map((match, index) => (
          <li key={`${match.templateKey}-${match.ruleId}-${index}`}>
            <span className={stylex(styles.matchTitle)}>{match.title ?? match.templateKey}</span>
            <span className={stylex(styles.matchKey)}>{match.templateKey}</span>
            <span className={stylex(styles.matchMeta)}>priority {match.rulePriority}</span>
            {showRuleIds && <span className={stylex(styles.matchMeta)}>rule {match.ruleId}</span>}
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
