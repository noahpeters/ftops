import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestEnv } from "../helpers/miniflare";
import { processQuoCallWebhook } from "../../src/services/quoCallWebhook";
import { encryptSecrets } from "../../src/lib/crypto/secrets";

const MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

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
  afterEach(() => vi.restoreAllMocks());

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

  it("waits for a transcript instead of creating a phone-number-named lead", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, db, mf } = context;
    await processQuoCallWebhook(env, {
      workspaceId: "ws_default",
      integrationId: "quo_1",
      eventId: "EV_call_1",
      body: callEvent(),
    });

    expect(await db.prepare(`SELECT COUNT(*) count FROM customers`).first()).toMatchObject({
      count: 0,
    });
    expect(
      await db.prepare(`SELECT outcome,reason FROM quo_call_ingestions`).first()
    ).toMatchObject({ outcome: "ignored", reason: "awaiting_named_call_transcript" });
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

  it("creates a named lead and summarized note from a meaningful call transcript", async () => {
    const ai = {
      run: vi.fn().mockResolvedValue({
        response: JSON.stringify({
          name: "Whitney Carter",
          meaningful: true,
          spam: false,
          subject: "Built-in cabinetry inquiry",
          summary: "Whitney is interested in built-in cabinetry for her living room.",
          nextSteps: ["Schedule an onsite consultation"],
          confidence: 0.96,
        }),
      }),
    };
    const context = await createTestEnv({
      env: {
        AI: ai,
        INTEGRATIONS_MASTER_KEY: MASTER_KEY,
        INTEGRATIONS_KEY_ID: "v1",
      },
    });
    if (!context) return;
    const { env, db, mf } = context;
    const secrets = await encryptSecrets(env, JSON.stringify({ apiKey: "quo-api-key" }));
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO integrations
         (id,workspace_id,provider,environment,external_account_id,display_name,
          secrets_key_id,secrets_ciphertext,is_active,created_at,updated_at)
         VALUES ('quo_1','ws_default','quo','production','ws_default','Quo',?,?,1,?,?)`
      )
      .bind(secrets.keyId, secrets.ciphertext, now, now)
      .run();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: "AC_call_1",
            direction: "incoming",
            participants: ["+14155550100"],
            completedAt: "2026-08-27T18:02:00.000Z",
          },
        }),
        { status: 200 }
      )
    );

    await processQuoCallWebhook(env, {
      workspaceId: "ws_default",
      integrationId: "quo_1",
      eventId: "EV_transcript_1",
      body: {
        id: "EV_transcript_1",
        type: "call.transcript.completed",
        createdAt: "2026-08-27T18:02:05.000Z",
        data: {
          object: {
            callId: "AC_call_1",
            createdAt: "2026-08-27T18:02:01.000Z",
            duration: 120,
            dialogue: [
              {
                identifier: "+14155550100",
                content: "Hi, this is Whitney Carter. I am calling about living room built-ins.",
              },
              { identifier: "+13105550199", content: "Let's schedule a consultation." },
            ],
          },
        },
      },
    });

    expect(await db.prepare(`SELECT display_name,status FROM customers`).first()).toMatchObject({
      display_name: "Whitney Carter",
      status: "lead",
    });
    const note = await db
      .prepare(
        `SELECT subject,body FROM customer_activities WHERE id='quo-call-transcript:AC_call_1'`
      )
      .first<{ subject: string; body: string }>();
    expect(note).toMatchObject({ subject: "Built-in cabinetry inquiry" });
    expect(note?.body).toContain("Whitney is interested in built-in cabinetry");
    expect(note?.body).toContain("Schedule an onsite consultation");
    expect(note?.body).not.toContain("Hi, this is Whitney Carter");
    expect(
      await db.prepare(`SELECT outcome,reason FROM quo_call_ingestions`).first()
    ).toMatchObject({
      outcome: "lead_created",
      reason: "meaningful_named_call_transcript",
    });
    await mf.dispose();
  });
});
