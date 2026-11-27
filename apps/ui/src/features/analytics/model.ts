import { useEffect, useState } from "react";
import { buildUrl, fetchJson } from "../../lib/api";

export type Counts = { arrivals: number; views: number; inquiries: number; sessions: number };
export type Point = Counts & { at: string };
export type Funnel = { sessions: number; intended: number; completed: number; accepted: number };
export type Overview = {
  from: string;
  to: string;
  caughtUpAt: string;
  series: Point[];
  sources: (Funnel & { source: string })[];
  landings: (Funnel & { landing: string })[];
  funnel: Funnel;
};
export type Session = {
  id: string;
  visitor: string;
  started_at: string;
  landing: string;
  source: string;
  referrer: string | null;
  medium: string | null;
  campaign: string | null;
  event_count: number;
  accepted_at: string | null;
};
export type TimelineEvent = {
  id: string;
  kind: string;
  occurred_at: string;
  path: string;
  experience: string | null;
  version: string | null;
  referrer: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  google_click: number;
  meta_click: number;
  arrival_at: string | null;
  submission_id: string | null;
  customer_id: string | null;
  receipt: "linked" | "needs_review" | null;
};
export type Page<T> = { items: T[]; next: string | null };
export type SessionPage = Page<Session> & { total: number };
export type Timeline = Page<TimelineEvent> & {
  session: Pick<Session, "id" | "visitor" | "started_at">;
  relatedCount: number;
};
export type Stage = "" | "intent" | "complete";

export const number = new Intl.NumberFormat("en-US");
const zone = "America/Los_Angeles";
export const date = new Intl.DateTimeFormat("en-US", {
  timeZone: zone,
  month: "short",
  day: "numeric",
});
export const time = new Intl.DateTimeFormat("en-US", {
  timeZone: zone,
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});
export const hour = new Intl.DateTimeFormat("en-US", {
  timeZone: zone,
  month: "short",
  day: "numeric",
  hour: "numeric",
  timeZoneName: "short",
});
export const hourTick = new Intl.DateTimeFormat("en-US", {
  timeZone: zone,
  month: "short",
  day: "numeric",
  hour: "numeric",
});

export function sourceName(value: string) {
  if (value === "google_ads") return "Google Ads";
  if (value === "meta_click") return "Meta click";
  if (value === "direct") return "Direct / unknown";
  if (value.startsWith("utm:")) {
    const tag = value.slice(4);
    const known: Record<string, string> = {
      google: "Google",
      facebook: "Facebook",
      instagram: "Instagram",
      newsletter: "Newsletter",
    };
    return known[tag] ?? tag;
  }
  if (value.startsWith("ref:")) {
    try {
      const host = new URL(value.slice(4)).hostname.replace(/^www\./, "");
      return host === "google.com" ? "Google Search" : host;
    } catch {
      return value.slice(4);
    }
  }
  return value;
}

export function ratio(count: number, base: number) {
  return base ? count / base : null;
}

const percentage = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});
export function percent(count: number, base: number) {
  const value = ratio(count, base);
  return value === null ? "—" : percentage.format(value);
}

export function websiteAnalyticsPath(integrationId: string) {
  return `/integrations/${encodeURIComponent(integrationId)}/analytics`;
}

export function useAnalytics<T>(
  integrationId: string,
  params: Record<string, string | undefined>,
  enabled = true
) {
  const url = buildUrl(websiteAnalyticsPath(integrationId), params);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>();
  const key = `${url}:${attempt}`;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetchJson<T & { error?: string }>(url, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok && result.data) setState({ key, data: result.data });
        else setState({ key, error: result.data?.error ?? "unavailable" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ key, error: "unavailable" });
      });
    return () => controller.abort();
  }, [enabled, key, url]);
  const result = enabled && state?.key === key ? state : undefined;
  return { data: result?.data, error: result?.error, retry: () => setAttempt((n) => n + 1) };
}
