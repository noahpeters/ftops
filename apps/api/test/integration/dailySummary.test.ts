import { describe, expect, it, vi } from "vitest";
import { createTestEnv } from "../helpers/miniflare";
import { sendDailySummaries } from "../../src/services/dailySummary";

describe("daily summary emails", () => {
  it("sends due tasks and computed customer follow-ups once at 7am local time", async () => {
    const context = await createTestEnv({
      env: {
        RESEND_API_KEY: "test-key",
        DAILY_SUMMARY_FROM_EMAIL: "notifications@fromtrees.studio",
        DAILY_SUMMARY_TIMEZONE: "America/Los_Angeles",
        APP_BASE_URL: "https://ops.example.com",
      },
    });
    if (!context) return;
    const { env, db, mf } = context;
    await db
      .prepare(
        `INSERT INTO users (workspace_id,user_id,name,email,workspace_admin,system_admin)
         VALUES ('default','user-1','Taylor','taylor@example.com',0,0)`
      )
      .run();
    await db
      .prepare(
        `INSERT INTO customers
          (id,workspace_id,display_name,status,created_at,updated_at)
         VALUES ('customer-1','default','Acme Cabinets','active',?,?)`
      )
      .bind("2026-08-14T00:00:00.000Z", "2026-08-14T00:00:00.000Z")
      .run();
    await db
      .prepare(
        `INSERT INTO tasks
          (id,workspace_id,project_id,scope,template_key,title,kind,position,status,due_at,assigned_to,customer_id,priority,created_at,updated_at)
         VALUES ('task-1','default',NULL,'workspace','daily-check','Finish checklist','task',0,'scheduled','2026-08-14T17:00:00.000Z','user-1',NULL,0,?,?)`
      )
      .bind("2026-08-14T00:00:00.000Z", "2026-08-14T00:00:00.000Z")
      .run();

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ id: "email-1" }, { status: 200 })
    );
    const fetcher = fetchMock as unknown as typeof fetch;
    const scheduledAt = new Date("2026-08-14T14:00:00.000Z");
    const first = await sendDailySummaries(env, scheduledAt, fetcher);
    const second = await sendDailySummaries(env, scheduledAt, fetcher);

    expect(first).toMatchObject({ sent: 1, skipped: 0, failed: 0, date: "2026-08-14" });
    expect(second).toMatchObject({ sent: 0, skipped: 1, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as { text: string; html: string };
    expect(body.text).toContain("Finish checklist");
    expect(body.text).toContain("Customer follow-ups due today");
    expect(body.text).toContain("Acme Cabinets");
    expect(body.html).toContain("https://ops.example.com/tasks");
    await mf.dispose();
  });

  it("does nothing outside 7am in the configured timezone", async () => {
    const context = await createTestEnv({
      env: {
        RESEND_API_KEY: "test-key",
        DAILY_SUMMARY_FROM_EMAIL: "notifications@fromtrees.studio",
        DAILY_SUMMARY_TIMEZONE: "America/Los_Angeles",
      },
    });
    if (!context) return;
    const { env, mf } = context;
    const fetcher = vi.fn() as unknown as typeof fetch;
    const result = await sendDailySummaries(env, new Date("2026-08-14T13:00:00.000Z"), fetcher);
    expect(result).toMatchObject({ sent: 0, skipped: 0, failed: 0 });
    expect(fetcher).not.toHaveBeenCalled();
    await mf.dispose();
  });
});
