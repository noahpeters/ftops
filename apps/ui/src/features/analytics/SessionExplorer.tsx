import * as sx from "@stylexjs/stylex";
import { Badge, Button, Panel, Select, Status } from "@from-trees/ui";
import { color, metrics } from "@from-trees/ui/tokens.stylex";
import { useState } from "react";
import { Link } from "react-router";
import {
  date,
  number,
  sourceName,
  time,
  useAnalytics,
  type Session,
  type SessionPage,
  type Stage,
  type Timeline,
  type TimelineEvent,
} from "./model";

const styles = sx.create({
  controls: { display: "flex", alignItems: "end", flexWrap: "wrap", gap: 12 },
  columns: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr) minmax(0, 1.7fr)",
      "@media (max-width: 760px)": "minmax(0, 1fr)",
    },
    gap: 16,
    alignItems: "start",
  },
  list: { display: "grid", gap: 0, margin: 0, padding: 0, listStyle: "none" },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    minWidth: 0,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.border,
    paddingBlock: 8,
  },
  rowSelected: { backgroundColor: color.subtle },
  details: { minWidth: 0, overflowWrap: "anywhere" },
  heading: { margin: 0, fontSize: metrics.font, fontWeight: 650 },
  meta: { margin: 0, color: color.muted, fontSize: metrics.small, overflowWrap: "anywhere" },
  pagination: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
  facts: { display: "flex", flexWrap: "wrap", gap: 14, margin: 0 },
  value: { margin: 0, overflowWrap: "anywhere" },
  timeline: { listStyle: "none", margin: 0, padding: 0 },
  timelineRow: {
    display: "grid",
    gridTemplateColumns: "5.7em 8px minmax(0,1fr)",
    gap: 8,
    paddingBlock: 5,
  },
  marker: { marginTop: 6, borderRadius: 8, width: 7, height: 7, backgroundColor: color.accent },
  event: { overflowWrap: "anywhere", fontSize: metrics.font },
  linked: { color: color.accent },
});

const titles: Record<string, string> = {
  view: "Browser view",
  inquiry_cta: "Inquiry link clicked",
  configurator_cta: "Configurator link clicked",
  inquiry_accepted: "Inquiry accepted",
  ad_attribution: "Ad attribution recorded",
};

function TimelineRow({ event }: { event: TimelineEvent }) {
  const details = [
    event.source && `Source ${event.source}`,
    event.medium && `Medium ${event.medium}`,
    event.campaign && `Campaign ${event.campaign}`,
    event.referrer,
    event.google_click ? "Google ad click recorded" : null,
    event.meta_click ? "Meta click recorded" : null,
    event.experience,
    event.version,
  ].filter(Boolean);
  return (
    <li {...sx.props(styles.timelineRow)}>
      <time dateTime={event.occurred_at} {...sx.props(styles.meta)}>
        {time.format(Date.parse(event.occurred_at))}
      </time>
      <span aria-hidden="true" {...sx.props(styles.marker)} />
      <div {...sx.props(styles.event)}>
        <strong>{titles[event.kind] ?? event.kind}</strong> <code>{event.path}</code>
        {details.length > 0 && <p {...sx.props(styles.meta)}>{details.join(" · ")}</p>}
        {event.arrival_at && (
          <p {...sx.props(styles.meta)}>
            Linked server arrival at {time.format(Date.parse(event.arrival_at))}
          </p>
        )}
        {event.submission_id && (
          <p {...sx.props(styles.meta)}>
            Inquiry receipt <code>{event.submission_id}</code>
          </p>
        )}
        {event.customer_id && (
          <Link
            to={`/customers/${encodeURIComponent(event.customer_id)}`}
            {...sx.props(styles.linked)}
          >
            Open matched FTOPS customer
          </Link>
        )}
        {event.receipt === "needs_review" && <Badge tone="warning">CRM match needs review</Badge>}
        {event.submission_id && !event.receipt && (
          <p {...sx.props(styles.meta)}>No matching FTOPS receipt yet.</p>
        )}
      </div>
    </li>
  );
}

function Inspector({
  integrationId,
  session,
  onBrowser,
}: {
  integrationId: string;
  session?: Session;
  onBrowser: (visitor: string) => void;
}) {
  const [cursors, setCursors] = useState<string[]>([]);
  const report = useAnalytics<Timeline>(
    integrationId,
    { mode: "timeline", session: session?.id, cursor: cursors.at(-1) },
    Boolean(session)
  );
  const timeline = report.data;
  if (!session)
    return (
      <Panel title="Session inspection">
        <Status>Select a session to inspect its activity.</Status>
      </Panel>
    );
  return (
    <Panel
      title={`Session ${session.id.slice(0, 8)}`}
      actions={session.accepted_at ? <Badge tone="success">Inquiry accepted</Badge> : undefined}
    >
      <p {...sx.props(styles.meta)}>
        {date.format(Date.parse(session.started_at))} ·{" "}
        {time.format(Date.parse(session.started_at))} PT
      </p>
      <dl {...sx.props(styles.facts)}>
        <div>
          <dt {...sx.props(styles.meta)}>Entry source</dt>
          <dd {...sx.props(styles.value)}>{sourceName(session.source)}</dd>
        </div>
        <div>
          <dt {...sx.props(styles.meta)}>Landing page</dt>
          <dd {...sx.props(styles.value)}>
            <code>{session.landing}</code>
          </dd>
        </div>
        {session.campaign && (
          <div>
            <dt {...sx.props(styles.meta)}>Campaign</dt>
            <dd {...sx.props(styles.value)}>{session.campaign}</dd>
          </div>
        )}
        {session.medium && (
          <div>
            <dt {...sx.props(styles.meta)}>Medium</dt>
            <dd {...sx.props(styles.value)}>{session.medium}</dd>
          </div>
        )}
      </dl>
      <h3 {...sx.props(styles.heading)}>Event timeline</h3>
      {!timeline && !report.error && <Status>Loading session events…</Status>}
      {report.error && (
        <Status tone="danger">
          Session events are unavailable. <Button onPress={report.retry}>Retry</Button>
        </Status>
      )}
      {timeline && (
        <>
          <ol aria-label="Session event timeline" {...sx.props(styles.timeline)}>
            {timeline.items.map((event) => (
              <TimelineRow key={`${event.kind}:${event.id}`} event={event} />
            ))}
          </ol>
          {(cursors.length > 0 || timeline.next) && (
            <div {...sx.props(styles.pagination)}>
              <Button
                isDisabled={cursors.length === 0}
                onPress={() => setCursors((list) => list.slice(0, -1))}
              >
                Previous events
              </Button>
              <Button
                isDisabled={!timeline.next}
                onPress={() => {
                  if (timeline.next) setCursors([...cursors, timeline.next]);
                }}
              >
                Next events
              </Button>
            </div>
          )}
          <h3 {...sx.props(styles.heading)}>Correlation evidence</h3>
          {session.referrer && (
            <p {...sx.props(styles.meta)}>Entry referrer · {session.referrer}</p>
          )}
          <p {...sx.props(styles.meta)}>
            First-party browser <code>{timeline.session.visitor}</code>
          </p>
          {timeline.relatedCount > 1 && (
            <div>
              <Button icon="history" onPress={() => onBrowser(timeline.session.visitor)}>
                View {number.format(timeline.relatedCount)} sessions from this browser
              </Button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

export function SessionExplorer({
  integrationId,
  days,
  source,
  stage,
  landing,
  visitor,
  onStage,
  onLanding,
  onBrowser,
}: {
  integrationId: string;
  days: string;
  source: string;
  stage: Stage;
  landing: string;
  visitor: string;
  onStage: (value: Stage) => void;
  onLanding: (value: string) => void;
  onBrowser: (value: string) => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [cursors, setCursors] = useState<string[]>([]);
  const report = useAnalytics<SessionPage>(integrationId, {
    days,
    source,
    stage,
    landing,
    visitor,
    mode: "sessions",
    history: visitor ? "all" : undefined,
    cursor: cursors.at(-1),
  });
  const matches = report.data;
  const selected = matches?.items.find((session) => session.id === selectedId) ?? matches?.items[0];

  return (
    <>
      <div {...sx.props(styles.controls)}>
        <Select
          label="Funnel step"
          value={stage}
          onChange={(event) => onStage(event.target.value as Stage)}
        >
          <option value="">All sessions</option>
          <option value="intent">Inquiry intent</option>
          <option value="complete">Inquiry accepted after intent</option>
        </Select>
        {landing && <Button onPress={() => onLanding("")}>Clear landing page {landing}</Button>}
        {visitor && <Button onPress={() => onBrowser("")}>Clear browser history filter</Button>}
      </div>
      <div {...sx.props(styles.columns)}>
        <Panel
          title="Sessions"
          actions={matches ? <Badge>{number.format(matches.total)} matching</Badge> : undefined}
        >
          {visitor && (
            <Status>Showing retained sessions from this browser across date ranges.</Status>
          )}
          {!matches && !report.error && <Status>Loading sessions…</Status>}
          {report.error && (
            <Status tone="danger">
              Sessions are unavailable. <Button onPress={report.retry}>Retry</Button>
            </Status>
          )}
          {matches?.items.length === 0 && <Status>No sessions match these filters.</Status>}
          {matches && matches.items.length > 0 && (
            <ul aria-label="Matching sessions" {...sx.props(styles.list)}>
              {matches.items.map((session) => (
                <li
                  key={session.id}
                  {...sx.props(styles.row, selected?.id === session.id && styles.rowSelected)}
                >
                  <div {...sx.props(styles.details)}>
                    <p {...sx.props(styles.heading)}>{sourceName(session.source)}</p>
                    <p {...sx.props(styles.meta)}>
                      <code>{session.landing}</code>
                    </p>
                    <p {...sx.props(styles.meta)}>
                      {date.format(Date.parse(session.started_at))} ·{" "}
                      {time.format(Date.parse(session.started_at))} ·{" "}
                      {number.format(session.event_count)} events
                    </p>
                    {session.accepted_at && <Badge tone="success">Inquiry accepted</Badge>}
                  </div>
                  <Button
                    variant="ghost"
                    icon="view"
                    aria-label={`Inspect session ${session.id.slice(0, 8)}`}
                    aria-pressed={selected?.id === session.id}
                    onPress={() => setSelectedId(session.id)}
                  >
                    Inspect
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {(cursors.length > 0 || matches?.next) && (
            <div {...sx.props(styles.pagination)}>
              <Button
                isDisabled={cursors.length === 0}
                onPress={() => setCursors((list) => list.slice(0, -1))}
              >
                Previous
              </Button>
              <Button
                isDisabled={!matches?.next}
                onPress={() => {
                  if (matches?.next) setCursors([...cursors, matches.next]);
                }}
              >
                Next
              </Button>
            </div>
          )}
        </Panel>
        <Inspector
          key={selected?.id}
          integrationId={integrationId}
          session={selected}
          onBrowser={onBrowser}
        />
      </div>
    </>
  );
}
