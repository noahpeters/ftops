import { describe, expect, it } from "vitest";
import { createTestEnv } from "../helpers/miniflare";
import { processQuoCallWebhook } from "../../src/services/quoCallWebhook";

function callEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "EV_call_1",
    type: "call.completed",
    createdAt: "2026-08-27T18:00:31.000Z",
    data: {
      object: {
        id: "AC_call_1",
        from: "+1 (415) 555-0100",
        to: "+13105550199",
        direction: "incoming",
        status: "completed",
        createdAt: "2026-08-27T18:00:00.000Z",
        answeredAt: "2026-08-27T18:00:05.000Z",
        completedAt: "2026-08-27T18:00:31.000Z",
        ...overrides,
      },
    },
  };
}

describe("Quo call webhook processing", () => {
  it("matches normalized Contact phone and creates one note across retries", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, db, mf } = context;
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          `INSERT INTO customers (id,workspace_id,display_name,status,created_at,updated_at) VALUES ('c1','ws_default','Acme','active',?,?)`
        )
        .bind(now, now),
      db
        .prepare(
          `INSERT INTO contacts (id,workspace_id,customer_id,display_name,phone,is_primary,status,created_at,updated_at) VALUES ('ct1','ws_default','c1','Pat','415-555-0100',1,'active',?,?)`
        )
        .bind(now, now),
    ]);

    const args = {
      workspaceId: "ws_default",
      integrationId: "quo_1",
      eventId: "EV_call_1",
      body: callEvent(),
    };
    await processQuoCallWebhook(env, args);
    await processQuoCallWebhook(env, args);

    const notes = await db
      .prepare(
        `SELECT customer_id,source,external_entity_id FROM customer_activities WHERE source='quo'`
      )
      .all();
    expect(notes.results).toHaveLength(1);
    expect(notes.results[0]).toMatchObject({
      customer_id: "c1",
      source: "quo",
      external_entity_id: "EV_call_1",
    });
    const ingestion = await db
      .prepare(`SELECT outcome,reason FROM quo_call_ingestions WHERE event_id='EV_call_1'`)
      .first();
    expect(ingestion).toMatchObject({ outcome: "noted", reason: "matched_contact_phone" });
    await mf.dispose();
  });

  it("creates a person Customer lead and human Contact for a meaningful unmatched call", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, db, mf } = context;
    await processQuoCallWebhook(env, {
      workspaceId: "ws_default",
      integrationId: "quo_1",
      eventId: "EV_call_1",
      body: callEvent({ callerName: "Jamie Rivera" }),
    });

    const customer = await db
      .prepare(
        `SELECT display_name,customer_type,status,lead_source,primary_contact_id FROM customers WHERE id='quo-lead:EV_call_1'`
      )
      .first();
    expect(customer).toMatchObject({
      display_name: "Jamie Rivera",
      customer_type: "person",
      status: "lead",
      lead_source: "quo",
      primary_contact_id: "quo-contact:EV_call_1",
    });
    const contact = await db
      .prepare(
        `SELECT customer_id,display_name,phone FROM contacts WHERE id='quo-contact:EV_call_1'`
      )
      .first();
    expect(contact).toMatchObject({
      customer_id: "quo-lead:EV_call_1",
      display_name: "Jamie Rivera",
      phone: "+14155550100",
    });
    await mf.dispose();
  });

  it("ignores an unmatched short or spam-labeled call", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, db, mf } = context;
    await processQuoCallWebhook(env, {
      workspaceId: "ws_default",
      integrationId: "quo_1",
      eventId: "EV_call_1",
      body: callEvent({ callerName: "Potential Spam", answeredAt: null }),
    });
    const count = await db
      .prepare(`SELECT COUNT(*) count FROM customers WHERE lead_source='quo'`)
      .first<{ count: number }>();
    expect(count?.count).toBe(0);
    const ingestion = await db
      .prepare(`SELECT outcome,reason FROM quo_call_ingestions WHERE event_id='EV_call_1'`)
      .first();
    expect(ingestion).toMatchObject({ outcome: "ignored", reason: "spam_caller_label" });
    await mf.dispose();
  });
});
