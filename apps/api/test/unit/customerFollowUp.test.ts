import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
  computeCustomerFollowUp,
  enqueueMissingCustomerNoteFollowUps,
  processCustomerNoteFollowUpAnalysis,
} from "../../src/services/customerFollowUp";
import { createTestEnv } from "../helpers/miniflare";

const zone = "America/Los_Angeles";

describe("customer follow-up cadence", () => {
  it("schedules leads on predictable Tuesday and Friday cadence", () => {
    const result = computeCustomerFollowUp(
      { status: "lead", created_at: "2026-08-17T17:00:00.000Z" },
      DateTime.fromISO("2026-08-17T12:00:00", { zone })
    );
    expect(result.next_follow_up_at).toBe("2026-08-18T16:00:00.000Z");
    expect(result.follow_up_urgency).toBe("upcoming");
  });

  it("moves a holiday Friday to the prior business day", () => {
    const result = computeCustomerFollowUp(
      { status: "active", last_human_note_at: "2026-06-29T17:00:00.000Z" },
      DateTime.fromISO("2026-06-29T12:00:00", { zone })
    );
    expect(result.next_follow_up_at).toBe("2026-07-02T16:00:00.000Z");
  });

  it("uses stored note guidance and suppresses archived customers", () => {
    const guided = computeCustomerFollowUp(
      {
        status: "completed",
        created_at: "2026-08-01T17:00:00.000Z",
        guidance_type: "date",
        interpreted_date: "2026-09-15T16:00:00.000Z",
        guidance_explanation: "Customer asked us to call next month.",
      },
      DateTime.fromISO("2026-08-16T12:00:00", { zone })
    );
    expect(guided).toMatchObject({
      next_follow_up_at: "2026-09-15T16:00:00.000Z",
      follow_up_reason: "Customer asked us to call next month.",
    });
    expect(computeCustomerFollowUp({ status: "archived" }).next_follow_up_at).toBeNull();
  });

  it("uses AI to interpret an explicit next weekday", async () => {
    const context = await createTestEnv({
      env: {
        AI: {
          run: async () => ({
            response: JSON.stringify({
              type: "date",
              interpretedDate: "2026-08-17T09:00:00-07:00",
              confidence: 0.9,
              explanation: "Staff plans to contact the customer Monday.",
            }),
          }),
        },
      },
    });
    if (!context) return;
    const { env, db, mf } = context;
    await db
      .prepare(
        `INSERT INTO customers (id,workspace_id,display_name,status,created_at,updated_at) VALUES ('weekday-customer','default','Weekday Customer','active','2026-08-16T23:28:17.938Z','2026-08-16T23:28:17.938Z')`
      )
      .run();
    await db
      .prepare(
        `INSERT INTO customer_activities (id,workspace_id,customer_id,activity_type,subject,body,source,occurred_at,created_by,created_at,is_human_authored) VALUES ('weekday-note','default','weekday-customer','note','Note','No response to messages. Try to contact on Monday by phone.','ftops','2026-08-16T23:28:17.938Z','user@example.com','2026-08-16T23:28:17.938Z',1)`
      )
      .run();

    await processCustomerNoteFollowUpAnalysis(env, {
      workspaceId: "default",
      customerId: "weekday-customer",
      noteId: "weekday-note",
    });
    const guidance = await db
      .prepare(
        `SELECT guidance_type,interpreted_date,model FROM customer_follow_up_guidance WHERE customer_id='weekday-customer'`
      )
      .first<{ guidance_type: string; interpreted_date: string; model: string }>();
    expect(guidance).toEqual({
      guidance_type: "date",
      interpreted_date: "2026-08-17T16:00:00.000Z",
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    });
    await mf.dispose();
  });

  it("uses AI to categorize sending drawings on Monday as follow-up", async () => {
    const context = await createTestEnv({
      env: {
        AI: {
          run: async () => ({
            response: JSON.stringify({
              type: "date",
              interpretedDate: "2026-08-17T09:00:00-07:00",
              confidence: 0.96,
              explanation: "Staff needs to send drawings and pricing Monday.",
            }),
          }),
        },
      },
    });
    if (!context) return;
    const { env, db, mf } = context;
    await db
      .prepare(
        `INSERT INTO customers (id,workspace_id,display_name,status,created_at,updated_at) VALUES ('planned-weekday-customer','default','Planned Weekday Customer','active','2026-08-16T23:28:17.938Z','2026-08-16T23:28:17.938Z')`
      )
      .run();
    await db
      .prepare(
        `INSERT INTO customer_activities (id,workspace_id,customer_id,activity_type,subject,body,source,occurred_at,created_by,created_at,is_human_authored) VALUES ('planned-weekday-note','default','planned-weekday-customer','note','Note',?, 'ftops','2026-08-16T23:28:17.938Z','user@example.com','2026-08-16T23:28:17.938Z',1)`
      )
      .bind(
        `Texted with with James last night. He accepted the estimate and paid the down payment. We discussed potentially changing the size. We are going to widen the table to 48". Also discussed a bench on at least one end of the table, possibly both ends. But, may wait to add the second bench until after the table is installed and we know how it fills the space. I need to send him new drawings and any price changes on Monday.`
      )
      .run();

    await processCustomerNoteFollowUpAnalysis(env, {
      workspaceId: "default",
      customerId: "planned-weekday-customer",
      noteId: "planned-weekday-note",
    });
    const guidance = await db
      .prepare(
        `SELECT guidance_type,interpreted_date,model FROM customer_follow_up_guidance WHERE customer_id='planned-weekday-customer'`
      )
      .first<{ guidance_type: string; interpreted_date: string; model: string }>();
    expect(guidance).toEqual({
      guidance_type: "date",
      interpreted_date: "2026-08-17T16:00:00.000Z",
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    });
    await mf.dispose();
  });

  it("re-enqueues the latest human note when guidance is missing", async () => {
    const sent: unknown[] = [];
    const context = await createTestEnv({
      env: { EVENT_QUEUE: { send: async (message: unknown) => void sent.push(message) } },
    });
    if (!context) return;
    const { env, db, mf } = context;
    await db
      .prepare(
        `INSERT INTO customers (id,workspace_id,display_name,status,created_at,updated_at) VALUES ('repair-customer','default','Repair Customer','active','2026-08-16T00:00:00Z','2026-08-16T00:00:00Z')`
      )
      .run();
    for (const [id, occurredAt] of [
      ["old-note", "2026-08-15T00:00:00Z"],
      ["latest-note", "2026-08-16T00:00:00Z"],
    ]) {
      await db
        .prepare(
          `INSERT INTO customer_activities (id,workspace_id,customer_id,activity_type,subject,source,occurred_at,created_by,created_at,is_human_authored) VALUES (?,'default','repair-customer','note','Note','ftops',?,'user@example.com',?,1)`
        )
        .bind(id, occurredAt, occurredAt)
        .run();
    }
    expect(await enqueueMissingCustomerNoteFollowUps(env)).toBe(1);
    expect(sent).toMatchObject([
      { type: "customer.note.follow_up.analyze", payload: { noteId: "latest-note" } },
    ]);
    await mf.dispose();
  });
});
