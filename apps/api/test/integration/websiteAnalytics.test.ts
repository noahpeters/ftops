import type { ExecutionContext } from "@cloudflare/workers-types";
import { expect, it, vi } from "vitest";
import worker from "../../src/index";
import { createTestEnv } from "../helpers/miniflare";

it("reports a website integration's raw events and drills into exact session and CRM evidence", async () => {
  const fixture = await createTestEnv({ env: { H2_ACQUISITION_INTEGRATION_ID: "tree-site" } });
  if (!fixture) throw new Error("Cloudflare test runtime is unavailable");
  const { db, mf, env } = fixture;
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-27T20:00:00.000Z"));
  try {
    await db.batch([
      db.prepare(`INSERT INTO users (workspace_id,user_id,name,email,workspace_admin,system_admin)
        VALUES ('default','member','Member','member@example.test',0,0),
          ('other','foreign','Foreign','foreign@example.test',1,0)`),
      db.prepare(`INSERT INTO integrations
        (id,workspace_id,provider,environment,external_account_id,secrets_key_id,secrets_ciphertext,is_active,created_at,updated_at)
        VALUES ('tree-site','default','website','production','from-trees.com','test','test',1,'now','now'),
          ('other-site','default','website','production','other.example','test','test',1,'now','now')`),
    ]);
    const read = (query = "", user = "member", site = "tree-site") =>
      worker.fetch(
        new Request(`https://ops.from-trees.com/integrations/${site}/analytics${query}`, {
          headers: { "Cf-Access-Authenticated-User-Email": `${user}@example.test` },
        }),
        env,
        {} as ExecutionContext
      );
    expect((await read("", "foreign")).status).toBe(404);
    expect((await read("", "member", "other-site")).status).toBe(404);
    expect(await (await read()).json()).toEqual({ error: "acquisition_backfill_pending" });

    const current = "2026-11-27T08:00:00.000Z";
    const at = (minute: number) => new Date(Date.parse(current) + minute * 60_000).toISOString();
    const insert = (
      id: string,
      kind: string,
      minute: number,
      options: {
        session?: string;
        visitor?: string;
        integration?: string;
        path?: string;
        evidence?: object;
      } = {}
    ) =>
      db
        .prepare(
          `INSERT INTO h2_acquisition_events
      (workspace_id,integration_id,id,kind,occurred_at,received_at,visitor_id,session_id,payload)
      VALUES ('default',?,?,?,?,?,?,?,?)`
        )
        .bind(
          options.integration ?? "tree-site",
          id,
          kind,
          at(minute),
          at(minute),
          kind === "arrival" ? null : (options.visitor ?? "same-browser"),
          kind === "arrival" ? null : (options.session ?? "paid-session"),
          JSON.stringify({
            origin: "https://from-trees.com",
            path: options.path ?? "/",
            ...options.evidence,
          })
        );
    const receipt = (id: string, integration: string, submission: string, browser: string) =>
      db
        .prepare(
          `INSERT INTO website_submissions
        (id,workspace_id,integration_id,external_event_id,email,fields_json,raw_payload,received_at,customer_id,reconciliation_status)
        VALUES (?,'default',?,?,'test@example.test','{}',?,'now',?,'linked')`
        )
        .bind(
          id,
          integration,
          submission,
          JSON.stringify({
            message: JSON.stringify({
              format: "h2-inquiry-v1",
              details: {
                acquisition: { visitorId: browser, sessionId: "paid-session" },
              },
            }),
          }),
          "contact-" + id
        );
    await db.batch([
      db
        .prepare(
          "INSERT INTO h2_acquisition_delivery_state (workspace_id,integration_id,caught_up_at) VALUES ('default','tree-site',?)"
        )
        .bind(at(240)),
      insert("arrival", "arrival", 9, { evidence: { traffic: "navigation" } }),
      insert("prefetch", "arrival", 8, { evidence: { traffic: "prefetch" } }),
      insert("paid-view", "view", 10, {
        evidence: {
          arrivalId: "arrival",
          attribution: { utm_source: "google", utm_campaign: "cabinetry" },
        },
      }),
      insert("click", "ad_attribution", 12, {
        evidence: { viewId: "paid-view", attribution: { gclid: "private-click-value" } },
      }),
      insert("early", "inquiry_accepted", 14, { evidence: { submissionId: "early-submission" } }),
      insert("intent", "inquiry_cta", 15),
      insert("receipt", "inquiry_accepted", 16, { evidence: { submissionId: "exact-submission" } }),
      insert("later-view", "view", 17, { evidence: { attribution: { utm_source: "newsletter" } } }),
      insert("repeat", "view", -60 * 24 * 12, {
        session: "older-session",
        evidence: { referrer: "https://www.google.com" },
      }),
      insert("direct", "view", 85, { session: "direct-session", visitor: "second-browser" }),
      insert("inquiry-direct", "inquiry_accepted", 86, {
        session: "direct-session",
        visitor: "second-browser",
      }),
      insert("unrelated", "view", 89, { integration: "other-site", session: "unrelated-session" }),
      receipt("good", "tree-site", "exact-submission", "same-browser"),
      receipt("foreign", "other-site", "exact-submission", "same-browser"),
      receipt("mismatched", "tree-site", "early-submission", "different-browser"),
    ]);

    const daily = (await (await read()).json()) as {
      series: unknown[];
      sources: unknown[];
      funnel: unknown;
    };
    expect(daily.series.at(-1)).toMatchObject({
      at: current,
      arrivals: 1,
      views: 3,
      sessions: 2,
      inquiries: 3,
    });
    expect(daily.sources).toEqual([
      { source: "direct", sessions: 1, intended: 0, completed: 0, accepted: 1 },
      { source: "google_ads", sessions: 1, intended: 1, completed: 1, accepted: 1 },
    ]);
    expect(daily.funnel).toEqual({ sessions: 2, intended: 1, completed: 1, accepted: 2 });
    const hourly = (await (await read("?grain=hour&source=google_ads")).json()) as {
      series: { at: string }[];
      funnel: unknown;
    };
    expect(hourly.series.find(({ at }) => at === current)).toMatchObject({
      at: current,
      arrivals: 0,
      views: 2,
      sessions: 1,
      inquiries: 2,
    });
    expect(hourly.funnel).toEqual({ sessions: 1, intended: 1, completed: 1, accepted: 1 });

    expect(await (await read("?mode=sessions&stage=complete")).json()).toMatchObject({
      total: 1,
      items: [{ id: "paid-session", source: "google_ads", campaign: "cabinetry" }],
    });
    expect(
      await (await read("?mode=sessions&visitor=same-browser&history=all")).json()
    ).toMatchObject({
      total: 2,
      items: [{ id: "paid-session" }, { id: "older-session" }],
    });
    const inactive = await read("?mode=timeline&session=unrelated-session");
    expect(inactive.status).toBe(404);
    const timeline = (await (await read("?mode=timeline&session=paid-session")).json()) as {
      relatedCount: number;
      items: Array<Record<string, unknown>>;
    };
    expect(timeline.relatedCount).toBe(2);
    expect(timeline.items.map((event) => event.id)).toEqual([
      "paid-view",
      "click",
      "early",
      "intent",
      "receipt",
      "later-view",
    ]);
    expect(timeline.items[0]).toMatchObject({ arrival_at: at(9), campaign: "cabinetry" });
    expect(timeline.items[1]).toMatchObject({ google_click: 1 });
    expect(timeline.items[2]).toMatchObject({
      submission_id: "early-submission",
      customer_id: null,
    });
    expect(timeline.items[4]).toMatchObject({
      submission_id: "exact-submission",
      customer_id: "contact-good",
      receipt: "linked",
    });
    expect(JSON.stringify(timeline)).not.toContain("private-click-value");
  } finally {
    clock.mockRestore();
    await mf.dispose();
  }
});
