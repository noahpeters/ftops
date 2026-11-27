import { DateTime } from "luxon";
import { canAccessWorkspace, requireActor } from "../lib/access";
import { badRequest, json, methodNotAllowed, notFound } from "../lib/http";
import { websiteAcquisitionIntegration } from "../lib/websiteAcquisitionIntegration";
import type { Env } from "../lib/types";

const zone = "America/Los_Angeles";
const pageSize = 40;
const site = "https://from-trees.com";

const cohort = `WITH bounds(workspace, integration, start, end) AS (VALUES (?, ?, ?, ?)),
  first_views AS (
    SELECT v.session_id AS id, v.visitor_id AS visitor, v.occurred_at AS started_at,
           json_extract(v.payload, '$.path') AS landing,
           json_extract(v.payload, '$.referrer') AS referrer,
           trim(json_extract(v.payload, '$.attribution.utm_source')) AS utm,
           json_extract(v.payload, '$.attribution.utm_medium') AS medium,
           json_extract(v.payload, '$.attribution.utm_campaign') AS campaign,
           EXISTS (SELECT 1 FROM h2_acquisition_events ad
             WHERE ad.workspace_id=v.workspace_id AND ad.integration_id=v.integration_id AND ad.session_id=v.session_id
               AND ad.visitor_id=v.visitor_id AND ad.kind='ad_attribution' AND json_extract(ad.payload,'$.origin')='${site}'
               AND json_extract(ad.payload,'$.viewId')=v.id
               AND coalesce(json_extract(ad.payload,'$.attribution.gclid'),
                            json_extract(ad.payload,'$.attribution.gbraid'),
                            json_extract(ad.payload,'$.attribution.wbraid')) IS NOT NULL) AS google_click,
           EXISTS (SELECT 1 FROM h2_acquisition_events ad
             WHERE ad.workspace_id=v.workspace_id AND ad.integration_id=v.integration_id AND ad.session_id=v.session_id
               AND ad.visitor_id=v.visitor_id AND ad.kind='ad_attribution' AND json_extract(ad.payload,'$.origin')='${site}'
               AND json_extract(ad.payload,'$.viewId')=v.id
               AND json_extract(ad.payload,'$.attribution.fbclid') IS NOT NULL) AS meta_click
    FROM h2_acquisition_events v, bounds b
    WHERE v.workspace_id=b.workspace AND v.integration_id=b.integration AND v.kind='view' AND v.occurred_at>=b.start
      AND v.occurred_at<b.end AND json_extract(v.payload,'$.origin')='${site}'
      AND NOT EXISTS (
        SELECT 1 FROM h2_acquisition_events previous
        WHERE previous.workspace_id=v.workspace_id AND previous.integration_id=v.integration_id AND previous.session_id=v.session_id
          AND previous.kind='view' AND json_extract(previous.payload,'$.origin')='${site}'
          AND (previous.occurred_at, previous.id)<(v.occurred_at, v.id)
      )
  ),
  sessions AS (
    SELECT *,
      CASE WHEN google_click OR (lower(utm)='google' AND lower(medium) IN ('cpc','ppc','paid_search','paid-search'))
             THEN 'google_ads'
           WHEN length(utm)>0 THEN 'utm:' || lower(utm)
           WHEN referrer IS NOT NULL AND referrer NOT IN ('${site}', 'https://www.from-trees.com')
             THEN 'ref:' || lower(referrer)
           WHEN meta_click THEN 'meta_click'
           ELSE 'direct' END AS source
    FROM first_views
  )`;

const stages = `, intent AS (
    SELECT s.*, (SELECT min(e.occurred_at)
      FROM h2_acquisition_events e
      WHERE e.workspace_id=b.workspace AND e.integration_id=b.integration AND e.session_id=s.id
        AND e.occurred_at>=s.started_at AND e.occurred_at<b.end
        AND json_extract(e.payload,'$.origin')='${site}'
        AND (e.kind='inquiry_cta' OR (e.kind='view' AND
          (json_extract(e.payload,'$.path') LIKE '/inquire/%' OR
           json_extract(e.payload,'$.path')='/contact')))
    ) AS intended_at
    FROM sessions s, bounds b
  ), outcomes AS (
    SELECT s.*, (SELECT min(e.occurred_at)
      FROM h2_acquisition_events e
      WHERE e.workspace_id=b.workspace AND e.integration_id=b.integration AND e.session_id=s.id
        AND e.occurred_at>=s.started_at AND e.occurred_at<b.end
        AND json_extract(e.payload,'$.origin')='${site}' AND e.kind='inquiry_accepted'
    ) AS accepted_at,
    EXISTS (SELECT 1 FROM h2_acquisition_events e
      WHERE e.workspace_id=b.workspace AND e.integration_id=b.integration AND e.session_id=s.id AND e.kind='inquiry_accepted'
        AND e.occurred_at>=s.intended_at AND e.occurred_at<b.end
        AND json_extract(e.payload,'$.origin')='${site}'
    ) AS completed
    FROM intent s, bounds b
  )`;

function windowFor(params: URLSearchParams) {
  const today = DateTime.now().setZone(zone).startOf("day");
  const from = params.get("from");
  const through = params.get("through");
  if (from !== null || through !== null) {
    if (
      !from ||
      !through ||
      !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(through)
    )
      return null;
    const start = DateTime.fromISO(from, { zone });
    const last = DateTime.fromISO(through, { zone });
    if (!start.isValid || !last.isValid || start > last || last > today) return null;
    return { start, end: last.plus({ days: 1 }) };
  }
  const days = params.get("days") ?? "7";
  if (days === "1") {
    const now = DateTime.now().setZone(zone);
    return { start: now.minus({ hours: 24 }), end: now };
  }
  if (!["7", "30", "90"].includes(days)) return null;
  return { start: today.minus({ days: Number(days) - 1 }), end: today.plus({ days: 1 }) };
}

function afterPage<T>(rows: T[], cursor: (row: T) => string[]) {
  const items = rows.slice(0, pageSize);
  return {
    items,
    next: rows.length > pageSize ? JSON.stringify(cursor(items[pageSize - 1])) : null,
  };
}

function readCursor(value: string | null, length: number): string[] | null {
  if (value === null) return Array<string>(length).fill("");
  try {
    const cursor: unknown = JSON.parse(value);
    if (
      Array.isArray(cursor) &&
      cursor.length === length &&
      cursor.every((item) => typeof item === "string")
    )
      return cursor as string[];
  } catch {
    // Invalid cursors are rejected by the caller.
  }
  return null;
}

type Counts = { arrivals: number; views: number; inquiries: number; sessions: number };
type Source = {
  source: string;
  sessions: number;
  intended: number;
  completed: number;
  accepted: number;
};
type SessionSummary = {
  id: string;
  visitor: string;
  started_at: string;
  landing: string;
  source: string;
  referrer: string | null;
  medium: string | null;
  campaign: string | null;
  intended_at: string | null;
  accepted_at: string | null;
  event_count: number;
};
type TimelineEvent = {
  id: string;
  kind: string;
  occurred_at: string;
  path: string;
  experience: string;
  version: string;
  referrer: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  google_click: number;
  meta_click: number;
  arrival_at: string | null;
  submission_id: string | null;
  customer_id: string | null;
  receipt: string | null;
};

export async function handleWebsiteAnalytics(
  integrationId: string,
  request: Request,
  env: Env,
  url: URL
) {
  const auth = await requireActor(env, request);
  if (!auth.ok) return auth.response;
  const integration = await websiteAcquisitionIntegration(env);
  if (
    !integration ||
    integration.id !== integrationId ||
    !canAccessWorkspace(auth.actor, integration.workspace_id)
  )
    return notFound("Website analytics not found");
  const workspace = integration.workspace_id;
  if (request.method !== "GET") return methodNotAllowed(["GET"]);

  const params = url.searchParams;
  const mode = params.get("mode") ?? "overview";

  const state = await env.DB.prepare(
    "SELECT caught_up_at FROM h2_acquisition_delivery_state WHERE workspace_id=? AND integration_id=?"
  )
    .bind(workspace, integrationId)
    .first<{ caught_up_at: string }>();
  if (!state) return json({ error: "acquisition_backfill_pending" }, 503);

  if (mode === "timeline") return await timeline(env, workspace, integrationId, params);
  if (mode !== "overview" && mode !== "sessions") return badRequest("invalid_analytics_mode");
  const period =
    mode === "sessions" && params.get("history") === "all" && params.get("visitor")
      ? { start: DateTime.fromMillis(0), end: DateTime.now() }
      : windowFor(params);
  if (!period) return badRequest("invalid_analytics_window");
  const now = DateTime.now().setZone(zone);
  const last = period.end < now ? period.end : now;
  const start = period.start.toUTC().toISO()!;
  const end = last.toUTC().toISO()!;
  const source = params.get("source") ?? "";
  const landing = params.get("landing") ?? "";
  const visitor = params.get("visitor") ?? "";
  const filters = "(?5='' OR s.source=?5) AND (?6='' OR s.landing=?6) AND (?7='' OR s.visitor=?7)";
  const values = [workspace, integrationId, start, end, source, landing, visitor];

  if (mode === "sessions") {
    const cursor = readCursor(params.get("cursor"), 2);
    if (!cursor) return badRequest("invalid_analytics_cursor");
    const stage = params.get("stage") ?? "";
    const predicates = {
      "": "",
      intent: "AND intended_at IS NOT NULL",
      complete: "AND completed=1",
    };
    if (!Object.hasOwn(predicates, stage)) return badRequest("invalid_analytics_stage");
    const stageFilter = predicates[stage as keyof typeof predicates];
    const [rows, count] = await Promise.all([
      env.DB.prepare(
        `${cohort}${stages} SELECT id, visitor, started_at, landing, source, referrer, medium, campaign,
          intended_at, accepted_at, (SELECT count(*) FROM h2_acquisition_events e
            WHERE e.workspace_id=?1 AND e.integration_id=?2 AND e.session_id=s.id AND json_extract(e.payload,'$.origin')='${site}'
          ) AS event_count FROM outcomes s
          WHERE ${filters} ${stageFilter} AND (?8='' OR (started_at, id)<(?8, ?9))
          ORDER BY started_at DESC, id DESC LIMIT ?10`
      )
        .bind(...values, ...cursor, pageSize + 1)
        .all<SessionSummary>(),
      env.DB.prepare(
        `${cohort}${stages} SELECT count(*) AS total FROM outcomes s WHERE ${filters} ${stageFilter}`
      )
        .bind(...values)
        .first<{ total: number }>(),
    ]);
    return json({
      ...afterPage(rows.results, (row) => [row.started_at, row.id]),
      total: count?.total ?? 0,
    });
  }

  const grain = params.get("grain") ?? "day";
  if (grain !== "hour" && grain !== "day") return badRequest("invalid_analytics_grain");
  const [hourly, sessionsByHour, sources, funnel, landings, earliest] = await Promise.all([
    env.DB.prepare(
      `${cohort} SELECT substr(e.occurred_at,1,13)||':00:00.000Z' AS at,
         count(CASE WHEN e.kind='arrival' AND json_extract(e.payload,'$.traffic')='navigation' THEN 1 END) AS arrivals,
         count(CASE WHEN e.kind='view' THEN 1 END) AS views,
         count(CASE WHEN e.kind='inquiry_accepted' THEN 1 END) AS inquiries
       FROM h2_acquisition_events e, bounds b
       WHERE e.workspace_id=b.workspace AND e.integration_id=b.integration AND e.occurred_at>=b.start AND e.occurred_at<b.end
         AND json_extract(e.payload,'$.origin')='${site}'
         AND (e.kind IN ('view','inquiry_accepted') OR
            (e.kind='arrival' AND json_extract(e.payload,'$.traffic')='navigation'))
         AND ((?5='' AND ?6='' AND ?7='') OR e.session_id IN (SELECT id FROM sessions s WHERE ${filters}))
       GROUP BY at ORDER BY at`
    )
      .bind(...values)
      .all<Omit<Counts, "sessions"> & { at: string }>(),
    env.DB.prepare(
      `${cohort} SELECT substr(started_at,1,13)||':00:00.000Z' AS at, count(*) AS sessions
       FROM sessions s WHERE ${filters} GROUP BY at ORDER BY at`
    )
      .bind(...values)
      .all<Pick<Counts, "sessions"> & { at: string }>(),
    env.DB.prepare(
      `${cohort}${stages} SELECT source, count(*) AS sessions,
         count(intended_at) AS intended, sum(completed) AS completed, count(accepted_at) AS accepted
       FROM outcomes GROUP BY source ORDER BY sessions DESC, source`
    )
      .bind(workspace, integrationId, start, end)
      .all<Source>(),
    env.DB.prepare(
      `${cohort}${stages} SELECT count(*) AS sessions, count(intended_at) AS intended,
        coalesce(sum(completed),0) AS completed, count(accepted_at) AS accepted
        FROM outcomes s WHERE ${filters}`
    )
      .bind(...values)
      .first<Omit<Source, "source">>(),
    env.DB.prepare(
      `${cohort}${stages} SELECT landing, count(*) AS sessions, count(intended_at) AS intended,
         sum(completed) AS completed, count(accepted_at) AS accepted
       FROM outcomes s WHERE ${filters} GROUP BY landing ORDER BY sessions DESC, landing`
    )
      .bind(...values)
      .all<Omit<Source, "source"> & { landing: string }>(),
    env.DB.prepare(
      `SELECT min(occurred_at) AS at FROM h2_acquisition_events
        WHERE workspace_id=? AND integration_id=? AND json_extract(payload,'$.origin')='${site}'`
    )
      .bind(workspace, integrationId)
      .first<{ at: string | null }>(),
  ]);
  const byBucket = new Map<string, Counts>();
  const unit = grain === "hour" ? "hours" : "days";
  // No synthetic history before collection began. The current hour/day remains visible.
  if (earliest?.at) {
    const available = DateTime.fromISO(earliest.at, { zone });
    const first = (available > period.start ? available : period.start).startOf(grain);
    for (let time = first; time < last; time = time.plus({ [unit]: 1 }))
      byBucket.set(time.toUTC().toISO()!, { arrivals: 0, views: 0, inquiries: 0, sessions: 0 });
  }
  for (const row of hourly.results) {
    const key = DateTime.fromISO(row.at, { zone }).startOf(grain).toUTC().toISO()!;
    const bucket = byBucket.get(key);
    if (!bucket) continue;
    bucket.arrivals += row.arrivals;
    bucket.views += row.views;
    bucket.inquiries += row.inquiries;
  }
  for (const row of sessionsByHour.results) {
    const key = DateTime.fromISO(row.at, { zone }).startOf(grain).toUTC().toISO()!;
    const bucket = byBucket.get(key);
    if (bucket) bucket.sessions += row.sessions;
  }

  return json({
    caughtUpAt: state.caught_up_at,
    from: start,
    to: end,
    series: [...byBucket].map(([at, counts]) => ({ at, ...counts })),
    sources: sources.results,
    funnel,
    landings: landings.results,
  });
}

async function timeline(
  env: Env,
  workspace: string,
  integrationId: string,
  params: URLSearchParams
) {
  const id = params.get("session");
  const cursor = readCursor(params.get("cursor"), 3);
  if (!id || !cursor) return badRequest("invalid_analytics_session");
  const session = await env.DB.prepare(
    `SELECT session_id AS id, visitor_id AS visitor, occurred_at AS started_at
     FROM h2_acquisition_events
     WHERE workspace_id=? AND integration_id=? AND session_id=? AND json_extract(payload,'$.origin')='${site}'
     ORDER BY occurred_at, id, kind LIMIT 1`
  )
    .bind(workspace, integrationId, id)
    .first<Pick<SessionSummary, "id" | "visitor" | "started_at">>();
  if (!session) return notFound("Session not found");
  const rows = await env.DB.prepare(
    `SELECT e.id, e.kind, e.occurred_at, json_extract(e.payload,'$.path') AS path,
       json_extract(e.payload,'$.experience') AS experience, json_extract(e.payload,'$.version') AS version,
       json_extract(e.payload,'$.referrer') AS referrer,
       json_extract(e.payload,'$.attribution.utm_source') AS source,
       json_extract(e.payload,'$.attribution.utm_medium') AS medium,
       json_extract(e.payload,'$.attribution.utm_campaign') AS campaign,
       (coalesce(json_extract(e.payload,'$.attribution.gclid'), json_extract(e.payload,'$.attribution.gbraid'),
          json_extract(e.payload,'$.attribution.wbraid')) IS NOT NULL) AS google_click,
       (json_extract(e.payload,'$.attribution.fbclid') IS NOT NULL) AS meta_click,
       a.occurred_at AS arrival_at, json_extract(e.payload,'$.submissionId') AS submission_id,
       null AS customer_id, null AS receipt
     FROM h2_acquisition_events e
     LEFT JOIN h2_acquisition_events a ON e.kind='view' AND a.workspace_id=e.workspace_id AND a.integration_id=e.integration_id AND a.kind='arrival'
       AND a.id=json_extract(e.payload,'$.arrivalId') AND json_extract(a.payload,'$.origin')='${site}'
     WHERE e.workspace_id=? AND e.integration_id=? AND e.session_id=? AND json_extract(e.payload,'$.origin')='${site}'
       AND (?4='' OR (e.occurred_at,e.id,e.kind)>(?4,?5,?6))
     ORDER BY e.occurred_at,e.id,e.kind LIMIT ?7`
  )
    .bind(workspace, integrationId, id, ...cursor, pageSize + 1)
    .all<TimelineEvent>();

  const page = afterPage(rows.results, (row) => [row.occurred_at, row.id, row.kind]);
  const related = await env.DB.prepare(
    `SELECT count(DISTINCT session_id) AS count FROM h2_acquisition_events
      WHERE workspace_id=? AND integration_id=? AND visitor_id=? AND kind='view' AND json_extract(payload,'$.origin')='${site}'`
  )
    .bind(workspace, integrationId, session.visitor)
    .first<{ count: number }>();
  const submissions = [
    ...new Set(
      page.items.flatMap((event) =>
        event.kind === "inquiry_accepted" && event.submission_id ? [event.submission_id] : []
      )
    ),
  ];
  if (submissions.length > 0) {
    const receipts = await env.DB.prepare(
      `SELECT external_event_id, customer_id, reconciliation_status, raw_payload
       FROM website_submissions WHERE workspace_id=? AND integration_id=?
         AND external_event_id IN (${submissions.map(() => "?").join(",")})`
    )
      .bind(workspace, integrationId, ...submissions)
      .all<{
        external_event_id: string;
        customer_id: string | null;
        reconciliation_status: string;
        raw_payload: string;
      }>();
    for (const event of page.items) {
      if (event.kind !== "inquiry_accepted") continue;
      const matching = receipts.results.filter(
        (row) =>
          row.external_event_id === event.submission_id && matchesInquiry(row.raw_payload, session)
      );
      if (matching.length === 1) {
        event.customer_id = matching[0].customer_id;
        event.receipt = matching[0].reconciliation_status;
      }
    }
  }
  return json({ session, relatedCount: related?.count ?? 0, ...page });
}

function matchesInquiry(payload: string, session: { id: string; visitor: string }) {
  try {
    const { message } = JSON.parse(payload) as { message: string };
    const evidence = JSON.parse(message) as {
      format?: string;
      details?: { acquisition?: { visitorId?: string; sessionId?: string } };
    };
    return (
      evidence.format === "h2-inquiry-v1" &&
      evidence.details?.acquisition?.visitorId === session.visitor &&
      evidence.details.acquisition.sessionId === session.id
    );
  } catch {
    return false;
  }
}
