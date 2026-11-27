import * as sx from "@stylexjs/stylex";
import {
  Button,
  DataTable,
  Panel,
  SegmentedControl,
  Select,
  Status,
  WorkspaceHeader,
  gap,
  layout,
  type TableColumn,
  type TableQuery,
} from "@from-trees/ui";
import { color, metrics } from "@from-trees/ui/tokens.stylex";
import { useState } from "react";
import stylex from "~/lib/stylex";
import {
  date,
  number,
  percent,
  sourceName,
  useAnalytics,
  type Funnel,
  type Overview,
  type Stage,
} from "./model";
import { SessionExplorer } from "./SessionExplorer";
import { TrafficChart, type Grain } from "./TrafficChart";

const styles = sx.create({
  toolbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "end",
    gap: 14,
    flexWrap: "wrap",
  },
  filters: { display: "flex", alignItems: "start", flexWrap: "wrap", gap: 12 },
  field: { minWidth: 148, maxWidth: "100%" },
  grid: {
    display: "grid",
    gap: 16,
    gridTemplateColumns: {
      default: "minmax(0, 1.7fr) minmax(0, 1fr)",
      "@media (max-width: 850px)": "minmax(0, 1fr)",
    },
  },
  hint: { color: color.muted, fontSize: metrics.small, margin: 0 },
  steps: { listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 13 },
  stage: { display: "grid", gap: 5 },
  stageTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  count: { fontWeight: 650, fontVariantNumeric: "tabular-nums" },
  track: { height: 7, borderRadius: 4, overflow: "hidden", backgroundColor: color.subtle },
  fill: (width: string) => ({ width, height: "100%", backgroundColor: color.accent }),
});

const views = [
  { value: "overview", label: "Overview" },
  { value: "sessions", label: "Sessions" },
];
const dimensions = [
  { value: "source", label: "Source" },
  { value: "landing", label: "Landing page" },
];

function InquiryFunnel({ funnel, onStep }: { funnel: Funnel; onStep: (stage: Stage) => void }) {
  const steps: { stage: Stage; name: string; count: number; info: string }[] = [
    {
      stage: "",
      name: "Confirmed session",
      count: funnel.sessions,
      info: "Browser-confirmed entry",
    },
    {
      stage: "intent",
      name: "Inquiry intent",
      count: funnel.intended,
      info: `${percent(funnel.intended, funnel.sessions)} of confirmed sessions`,
    },
    {
      stage: "complete",
      name: "Inquiry accepted",
      count: funnel.completed,
      info: `${percent(funnel.completed, funnel.intended)} of sessions with inquiry intent`,
    },
  ];
  return (
    <Panel title="Inquiry funnel">
      <p {...sx.props(styles.hint)}>Ordered steps within a session</p>
      <ol aria-label="Inquiry funnel stages" {...sx.props(styles.steps)}>
        {steps.map(({ stage, name, count, info }) => (
          <li key={name} {...sx.props(styles.stage)}>
            <div {...sx.props(styles.stageTop)}>
              <Button
                variant="ghost"
                onPress={() => onStep(stage)}
                aria-label={`Inspect sessions with ${name.toLowerCase()}`}
              >
                {name}
              </Button>
              <span {...sx.props(styles.count)}>{number.format(count)}</span>
            </div>
            <div aria-hidden="true" {...sx.props(styles.track)}>
              <div
                {...sx.props(
                  styles.fill(funnel.sessions ? `${(100 * count) / funnel.sessions}%` : "0%")
                )}
              />
            </div>
            <p {...sx.props(styles.hint)}>{info}</p>
          </li>
        ))}
      </ol>
      <p {...sx.props(styles.hint)}>
        Inquiry intent includes an inquiry link click or an inquiry or contact page view.
      </p>
    </Panel>
  );
}

type BreakdownRow = Funnel & { value: string; label: string };
type Dimension = "source" | "landing";
const initialTable: TableQuery = { search: "", filters: {}, sort: null, page: 1, pageSize: 10 };

function Breakdown({
  report,
  source,
  onOpen,
}: {
  report: Overview;
  source: string;
  onOpen: (dimension: Dimension, value: string) => void;
}) {
  const [dimension, setDimension] = useState<Dimension>("source");
  const [query, setQuery] = useState(initialTable);
  const rows =
    dimension === "source"
      ? report.sources
          .filter((row) => !source || row.source === source)
          .map((row) => ({ ...row, value: row.source, label: sourceName(row.source) }))
      : report.landings.map((row) => ({ ...row, value: row.landing, label: row.landing }));
  const columns: TableColumn<BreakdownRow>[] = [
    {
      id: "dimension",
      label: dimension === "source" ? "Session source" : "Landing page",
      kind: "text",
      fillWidth: true,
      value: (row) => row.label,
    },
    { id: "sessions", label: "Sessions", kind: "number", value: (row) => row.sessions },
    { id: "intent", label: "Inquiry intent", kind: "number", value: (row) => row.intended },
    { id: "accepted", label: "Accepted", kind: "number", value: (row) => row.accepted },
    {
      id: "conversion",
      label: "Conversion",
      kind: "text",
      value: (row) => percent(row.accepted, row.sessions),
    },
  ];
  const filtered = rows.filter((row) =>
    row.label.toLowerCase().includes(query.search.trim().toLowerCase())
  );
  const start = (query.page - 1) * query.pageSize;
  const drill = (row: BreakdownRow) => onOpen(dimension, row.value);

  return (
    <Panel
      title="Acquisition breakdown"
      actions={
        <SegmentedControl
          label="Breakdown dimension"
          value={dimension}
          options={dimensions}
          onChange={(value) => {
            setDimension(value === "landing" ? "landing" : "source");
            setQuery(initialTable);
          }}
        />
      }
    >
      <DataTable
        label="acquisition breakdown"
        columns={columns}
        query={query}
        onQueryChange={setQuery}
        page={{
          query,
          items: filtered.slice(start, start + query.pageSize),
          total: filtered.length,
        }}
        getRowId={(row) => row.value}
        getRowLabel={(row) => row.label}
        onOpenRow={drill}
        rowActions={(row) => [
          {
            id: "inspect",
            label: "Inspect matching sessions",
            icon: "view",
            onAction: () => drill(row),
          },
        ]}
      />
    </Panel>
  );
}

export function AcquisitionDashboard({
  integrationId = "",
  loadingAccess = false,
}: {
  integrationId?: string;
  loadingAccess?: boolean;
}) {
  const [view, setView] = useState("overview");
  const [days, setDays] = useState("7");
  const [grain, setGrain] = useState<Grain>("day");
  const [source, setSource] = useState("");
  const [stage, setStage] = useState<Stage>("");
  const [landing, setLanding] = useState("");
  const [visitor, setVisitor] = useState("");
  const request = useAnalytics<Overview>(
    integrationId,
    { days, grain, source },
    Boolean(integrationId) && !loadingAccess
  );
  const report = request.data;
  const knownSources = report?.sources.map((row) => row.source) ?? [];
  const sources =
    source && !knownSources.includes(source) ? [...knownSources, source] : knownSources;

  function openSessions(nextStage: Stage) {
    setLanding("");
    setVisitor("");
    setStage(nextStage);
    setView("sessions");
  }

  function inspectBrowser(nextVisitor: string) {
    if (nextVisitor) {
      setSource("");
      setStage("");
      setLanding("");
    }
    setVisitor(nextVisitor);
  }

  return (
    <div className={stylex(layout.stack, gap.lg)}>
      <WorkspaceHeader
        label="Website analytics"
        title="Website analytics"
        metadata="from-trees.com"
        level={1}
      />
      {loadingAccess ? (
        <Status>Checking access…</Status>
      ) : (
        <>
          <div {...sx.props(styles.toolbar)}>
            <div {...sx.props(styles.filters)}>
              <div {...sx.props(styles.field)}>
                <Select
                  label="Date range"
                  help={
                    report
                      ? `${date.format(Date.parse(report.from))} – ${date.format(Date.parse(report.to) - 1)} PT`
                      : "Pacific Time"
                  }
                  value={days}
                  onChange={(event) => {
                    setDays(event.target.value);
                    setGrain(event.target.value === "1" ? "hour" : "day");
                    setVisitor("");
                  }}
                >
                  <option value="1">Last 24 hours</option>
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                </Select>
              </div>
              <div {...sx.props(styles.field)}>
                <Select
                  label="Session source"
                  help="First recorded browser view"
                  value={source}
                  onChange={(event) => {
                    setSource(event.target.value);
                    setVisitor("");
                  }}
                >
                  <option value="">All sources</option>
                  {sources.map((value) => (
                    <option key={value} value={value}>
                      {sourceName(value)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <SegmentedControl
              label="Analytics view"
              value={view}
              options={views}
              onChange={setView}
            />
          </div>
          {!report && !request.error && <Status>Loading website analytics…</Status>}
          {request.error && (
            <Status tone={request.error === "acquisition_backfill_pending" ? "neutral" : "danger"}>
              {request.error === "acquisition_backfill_pending"
                ? "Waiting for the initial H2 data backfill."
                : "Website analytics are unavailable."}{" "}
              <Button onPress={request.retry}>Retry</Button>
            </Status>
          )}
          {report && view === "overview" && (
            <>
              <div {...sx.props(styles.grid)}>
                <TrafficChart
                  series={report.series}
                  grain={grain}
                  onGrain={setGrain}
                  filtered={Boolean(source)}
                />
                <InquiryFunnel funnel={report.funnel} onStep={openSessions} />
              </div>
              <Breakdown
                key={`${days}:${source}`}
                report={report}
                source={source}
                onOpen={(dimension, value) => {
                  openSessions("");
                  if (dimension === "source") setSource(value);
                  else setLanding(value);
                }}
              />
            </>
          )}
          {report && view === "sessions" && (
            <SessionExplorer
              key={JSON.stringify([days, source, stage, landing, visitor])}
              integrationId={integrationId}
              days={days}
              source={source}
              stage={stage}
              landing={landing}
              visitor={visitor}
              onStage={setStage}
              onLanding={setLanding}
              onBrowser={inspectBrowser}
            />
          )}
        </>
      )}
    </div>
  );
}
