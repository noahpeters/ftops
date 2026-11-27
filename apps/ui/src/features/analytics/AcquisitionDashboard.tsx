import { List, Section, Select, Status, WorkspaceHeader, gap, layout } from "@from-trees/ui";
import { useEffect, useState } from "react";
import stylex from "~/lib/stylex";
import { buildUrl, fetchJson } from "../../lib/api";

type Report = {
  totals: {
    arrivals: number;
    views: number;
    visitors: number;
    sessions: number;
    inquiries: number;
  };
  pages: { path: string; arrivals: number }[];
  campaigns: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    views: number;
  }[];
};
type State = { days: string; report: Report | null };
const metrics = [
  {
    key: "arrivals",
    title: "Server arrivals",
    metadata: "Document navigations, excluding detected bots and prefetches",
  },
  {
    key: "views",
    title: "Browser views",
    metadata: "Confirmed views, including navigation within the site",
  },
  {
    key: "visitors",
    title: "Unique browser IDs",
    metadata: "Distinct first-party browser IDs with a view",
  },
  { key: "sessions", title: "Sessions", metadata: "Distinct session IDs with a view" },
  { key: "inquiries", title: "Accepted inquiries", metadata: "Recorded H2 inquiry confirmations" },
] as const;
const number = new Intl.NumberFormat("en-US");

export function AcquisitionDashboard({ loadingAccess = false }: { loadingAccess?: boolean }) {
  const [days, setDays] = useState("7");
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    if (loadingAccess) return;
    const controller = new AbortController();
    void fetchJson<Report>(buildUrl("/configurator/acquisition", { days }), {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setState({ days, report: result.ok ? result.data : null });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ days, report: null });
      });
    return () => controller.abort();
  }, [days, loadingAccess]);

  const current = state?.days === days ? state : null;
  const report = current?.report;
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
          <Select
            label="Date range"
            help="Pacific Time, including today"
            value={days}
            onChange={(event) => setDays(event.target.value)}
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </Select>
          {!current && <Status>Loading website analytics…</Status>}
          {current && !report && <Status tone="danger">Website analytics are unavailable.</Status>}
          {report && (
            <>
              <Section title="Overview">
                <List
                  label="Acquisition totals"
                  items={metrics.map(({ key, title, metadata }) => ({
                    id: key,
                    title,
                    metadata,
                    status: { label: number.format(report.totals[key]) },
                  }))}
                />
              </Section>
              <Section title="Top landing pages">
                <List
                  label="Landing pages by server arrivals"
                  emptyMessage="No landing page arrivals in this period."
                  items={report.pages.map(({ path, arrivals }) => ({
                    id: path,
                    title: path,
                    metadata: "Server arrivals",
                    status: { label: number.format(arrivals) },
                  }))}
                />
              </Section>
              <Section title="Top campaigns">
                <List
                  label="Campaigns by browser views"
                  emptyMessage="No browser views in this period."
                  items={report.campaigns.map(({ source, medium, campaign, views }) => ({
                    id: JSON.stringify([source, medium, campaign]),
                    title: campaign || source || medium || "Untagged",
                    metadata: [source, medium].filter(Boolean).join(" · ") || "Browser views",
                    status: { label: number.format(views) },
                  }))}
                />
              </Section>
            </>
          )}
        </>
      )}
    </div>
  );
}
