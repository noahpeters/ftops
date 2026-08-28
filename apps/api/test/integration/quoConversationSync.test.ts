import { afterEach, describe, expect, it, vi } from "vitest";
import type { D1Database, ExecutionContext } from "@cloudflare/workers-types";
import { createTestEnv } from "../helpers/miniflare";
import { route } from "../../src/lib/router";
import type { Env } from "../../src/lib/types";
import { syncQuoIntegrationConversations } from "../../src/services/quoConversationSync";

const MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SYNC_TIME = new Date("2026-08-28T12:00:00Z");

describe("Quo conversation reconciliation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("adds incoming and outgoing messages to a matched Customer once", async () => {
    const context = await createTestEnv({
      env: { INTEGRATIONS_MASTER_KEY: MASTER_KEY, INTEGRATIONS_KEY_ID: "v1" },
    });
    if (!context) return;
    const { env, db, mf } = context;
    const integration = await createQuoIntegration(env, db);
    await db
      .prepare(
        `INSERT INTO customers (id,workspace_id,display_name,customer_type,status,created_at,updated_at)
         VALUES ('customer-1','default','Taylor Residence','person','active',?,?)`
      )
      .bind(SYNC_TIME.toISOString(), SYNC_TIME.toISOString())
      .run();
    await db
      .prepare(
        `INSERT INTO contacts
         (id,workspace_id,customer_id,display_name,phone,is_primary,status,created_at,updated_at)
         VALUES ('contact-1','default','customer-1','Taylor','(415) 555-0123',1,'active',?,?)`
      )
      .bind(SYNC_TIME.toISOString(), SYNC_TIME.toISOString())
      .run();

    mockConversationApi([
      message("AC-in", "incoming", "Could you build walnut cabinets for our kitchen?", "10:00:00"),
      message("AC-out", "outgoing", "Yes, I would be glad to discuss it.", "10:05:00"),
    ]);
    await syncQuoIntegrationConversations(env, integration, SYNC_TIME);

    expect(
      await db
        .prepare(
          `SELECT COUNT(*) count FROM customer_activities WHERE customer_id='customer-1' AND source='quo'`
        )
        .first()
    ).toMatchObject({ count: 2 });
    expect(
      await db
        .prepare(`SELECT subject,body FROM customer_activities WHERE id='quo-message:AC-out'`)
        .first()
    ).toMatchObject({
      subject: "Quo outgoing text",
      body: expect.stringContaining("Yes, I would be glad"),
    });

    mockConversationApi([
      message("AC-in", "incoming", "Could you build walnut cabinets for our kitchen?", "10:00:00"),
      message("AC-out", "outgoing", "Yes, I would be glad to discuss it.", "10:05:00"),
    ]);
    await syncQuoIntegrationConversations(env, integration, new Date("2026-08-28T13:00:00Z"));
    expect(
      await db.prepare(`SELECT COUNT(*) count FROM customer_activities WHERE source='quo'`).first()
    ).toMatchObject({ count: 2 });
    expect(
      await db.prepare(`SELECT COUNT(*) count FROM quo_message_ingestions`).first()
    ).toMatchObject({ count: 2 });
    await mf.dispose();
  });

  it("backfills a completed call transcript into a named lead and summarized note", async () => {
    const context = await createTestEnv({
      env: {
        INTEGRATIONS_MASTER_KEY: MASTER_KEY,
        INTEGRATIONS_KEY_ID: "v1",
        AI: {
          run: vi.fn(async () => ({
            response: JSON.stringify({
              name: "Whitney Carter",
              meaningful: true,
              spam: false,
              subject: "Built-in cabinet inquiry",
              summary: "Whitney discussed a built-in cabinet project and requested next steps.",
              nextSteps: ["Schedule a site visit"],
              confidence: 0.98,
            }),
          })),
        },
      },
    });
    if (!context) return;
    const { env, db, mf } = context;
    const integration = await createQuoIntegration(env, db);
    mockConversationApi([], null, {
      id: "AC-whitney-call",
      status: "completed",
      direction: "incoming",
      phoneNumberId: "PN-1",
      participants: ["+14155550123"],
      createdAt: "2026-08-27T18:00:00Z",
      completedAt: "2026-08-27T18:12:00Z",
    });

    await syncQuoIntegrationConversations(env, integration, SYNC_TIME, { forceBackfill: true });

    expect(
      await db.prepare(`SELECT display_name,status,lead_source FROM customers`).first()
    ).toMatchObject({ display_name: "Whitney Carter", status: "lead", lead_source: "quo" });
    expect(await db.prepare(`SELECT display_name,phone FROM contacts`).first()).toMatchObject({
      display_name: "Whitney Carter",
      phone: "+14155550123",
    });
    const note = await db
      .prepare(
        `SELECT subject,body FROM customer_activities WHERE id='quo-call-transcript:AC-whitney-call'`
      )
      .first<{ subject: string; body: string }>();
    expect(note?.subject).toBe("Built-in cabinet inquiry");
    expect(note?.body).toContain("Whitney discussed a built-in cabinet project");
    expect(note?.body).not.toContain("Hello, this is Whitney");
    await mf.dispose();
  });

  it("creates a lead for a meaningful unmatched inbound conversation and records both directions", async () => {
    const context = await createTestEnv({
      env: { INTEGRATIONS_MASTER_KEY: MASTER_KEY, INTEGRATIONS_KEY_ID: "v1" },
    });
    if (!context) return;
    const { env, db, mf } = context;
    const integration = await createQuoIntegration(env, db);
    mockConversationApi(
      [
        message("AC-lead-in", "incoming", "I need a built-in cabinet estimate", "09:00:00"),
        message("AC-lead-out", "outgoing", "What room is it for?", "09:05:00"),
      ],
      "Kitchen inquiry"
    );

    await syncQuoIntegrationConversations(env, integration, SYNC_TIME);

    expect(
      await db.prepare(`SELECT display_name,status,lead_source FROM customers`).first()
    ).toMatchObject({ display_name: "Kitchen inquiry", status: "lead", lead_source: "quo" });
    expect(await db.prepare(`SELECT phone,customer_id FROM contacts`).first()).toMatchObject({
      phone: "+14155550123",
      customer_id: "quo-conversation:CN-1",
    });
    expect(
      await db.prepare(`SELECT COUNT(*) count FROM customer_activities WHERE source='quo'`).first()
    ).toMatchObject({ count: 2 });
    await mf.dispose();
  });

  it("uses a sender's explicit self-introduction for a new lead name", async () => {
    const context = await createTestEnv({
      env: { INTEGRATIONS_MASTER_KEY: MASTER_KEY, INTEGRATIONS_KEY_ID: "v1" },
    });
    if (!context) return;
    const { env, db, mf } = context;
    const integration = await createQuoIntegration(env, db);
    mockConversationApi([
      message(
        "AC-named-lead",
        "incoming",
        "Hello, Morgen. This is Daniel Arreola. I met you and your husband last week.",
        "09:00:00"
      ),
    ]);

    await syncQuoIntegrationConversations(env, integration, SYNC_TIME);

    expect(await db.prepare(`SELECT display_name FROM customers`).first()).toMatchObject({
      display_name: "Daniel Arreola",
    });
    expect(await db.prepare(`SELECT display_name FROM contacts`).first()).toMatchObject({
      display_name: "Daniel Arreola",
    });
    await mf.dispose();
  });

  it("upgrades an existing Quo phone-number placeholder from a self-introduction", async () => {
    const context = await createTestEnv({
      env: { INTEGRATIONS_MASTER_KEY: MASTER_KEY, INTEGRATIONS_KEY_ID: "v1" },
    });
    if (!context) return;
    const { env, db, mf } = context;
    const integration = await createQuoIntegration(env, db);
    await db.batch([
      db
        .prepare(
          `INSERT INTO customers
           (id,workspace_id,display_name,customer_type,status,lead_source,created_at,updated_at)
           VALUES ('quo-lead','default','Text (415) 555-0123','person','lead','quo',?,?)`
        )
        .bind(SYNC_TIME.toISOString(), SYNC_TIME.toISOString()),
      db
        .prepare(
          `INSERT INTO contacts
           (id,workspace_id,customer_id,display_name,phone,is_primary,status,created_at,updated_at)
           VALUES ('quo-contact','default','quo-lead','Text (415) 555-0123','+14155550123',1,'active',?,?)`
        )
        .bind(SYNC_TIME.toISOString(), SYNC_TIME.toISOString()),
    ]);
    mockConversationApi([
      message("AC-existing-name", "incoming", "Hello. This is Daniel Arreola.", "09:00:00"),
    ]);

    await syncQuoIntegrationConversations(env, integration, SYNC_TIME);

    expect(await db.prepare(`SELECT display_name FROM customers`).first()).toMatchObject({
      display_name: "Daniel Arreola",
    });
    expect(await db.prepare(`SELECT display_name FROM contacts`).first()).toMatchObject({
      display_name: "Daniel Arreola",
    });
    await mf.dispose();
  });

  it("creates a lead for a meaningful named outgoing-only conversation", async () => {
    const context = await createTestEnv({
      env: { INTEGRATIONS_MASTER_KEY: MASTER_KEY, INTEGRATIONS_KEY_ID: "v1" },
    });
    if (!context) return;
    const { env, db, mf } = context;
    const integration = await createQuoIntegration(env, db);
    mockConversationApi(
      [
        message(
          "AC-whitney",
          "outgoing",
          "Hi Whitney, it was nice discussing your built-in project. Here are the next steps.",
          "08:00:00"
        ),
      ],
      "Whitney"
    );

    await syncQuoIntegrationConversations(env, integration, SYNC_TIME);

    expect(await db.prepare(`SELECT display_name,status FROM customers`).first()).toMatchObject({
      display_name: "Whitney",
      status: "lead",
    });
    expect(
      await db.prepare(`SELECT outcome,reason FROM quo_message_ingestions`).first()
    ).toMatchObject({
      outcome: "lead_created",
      reason: "meaningful_named_outgoing_conversation",
    });
    await mf.dispose();
  });

  it("does not create a lead for an unmatched trivial incoming conversation", async () => {
    const context = await createTestEnv({
      env: { INTEGRATIONS_MASTER_KEY: MASTER_KEY, INTEGRATIONS_KEY_ID: "v1" },
    });
    if (!context) return;
    const { env, db, mf } = context;
    const integration = await createQuoIntegration(env, db);
    mockConversationApi([message("AC-trivial", "incoming", "Thanks", "08:00:00")]);

    await syncQuoIntegrationConversations(env, integration, SYNC_TIME);

    expect(await db.prepare(`SELECT COUNT(*) count FROM customers`).first()).toMatchObject({
      count: 0,
    });
    expect(
      await db.prepare(`SELECT outcome,reason FROM quo_message_ingestions`).first()
    ).toMatchObject({ outcome: "ignored", reason: "low_information_conversation" });
    await mf.dispose();
  });

  it("does not create a lead for a meaningful outgoing conversation without a useful name", async () => {
    const context = await createTestEnv({
      env: { INTEGRATIONS_MASTER_KEY: MASTER_KEY, INTEGRATIONS_KEY_ID: "v1" },
    });
    if (!context) return;
    const { env, db, mf } = context;
    const integration = await createQuoIntegration(env, db);
    mockConversationApi([
      message(
        "AC-unnamed-outgoing",
        "outgoing",
        "It was nice discussing your built-in project. Here are the next steps.",
        "08:00:00"
      ),
    ]);

    await syncQuoIntegrationConversations(env, integration, SYNC_TIME);

    expect(await db.prepare(`SELECT COUNT(*) count FROM customers`).first()).toMatchObject({
      count: 0,
    });
    expect(
      await db.prepare(`SELECT outcome,reason FROM quo_message_ingestions`).first()
    ).toMatchObject({ outcome: "ignored", reason: "outgoing_only_conversation" });
    await mf.dispose();
  });
});

async function createQuoIntegration(env: Env, db: D1Database) {
  const response = await request(env, "/integrations", {
    method: "POST",
    body: JSON.stringify({
      workspaceId: "default",
      provider: "quo",
      displayName: "Quo",
      secrets: { apiKey: "test-key" },
    }),
  });
  expect(response.status).toBe(201);
  const created = (await response.json()) as { id: string };
  return (await db
    .prepare(
      `SELECT id,workspace_id,secrets_key_id,secrets_ciphertext FROM integrations WHERE id=?`
    )
    .bind(created.id)
    .first()) as {
    id: string;
    workspace_id: string;
    secrets_key_id: string;
    secrets_ciphertext: string;
  };
}

function mockConversationApi(
  messages: Record<string, unknown>[],
  name: string | null = null,
  call: Record<string, unknown> | null = null
) {
  const mock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "CN-1",
              phoneNumberId: "PN-1",
              participants: ["+14155550123"],
              name,
              updatedAt: "2026-08-28T10:05:00Z",
            },
          ],
          totalItems: 1,
          nextPageToken: null,
        })
      )
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: call ? [call] : [], totalItems: call ? 1 : 0, nextPageToken: null })
      )
    );
  if (call) {
    mock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              callId: call.id,
              createdAt: call.createdAt,
              duration: 720,
              dialogue: [
                { identifier: "+14155550123", content: "Hello, this is Whitney Carter." },
                { identifier: "US-ftops", content: "Tell me about your project." },
              ],
            },
          })
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: call })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: messages, totalItems: messages.length, nextPageToken: null })
        )
      );
  } else {
    mock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: messages, totalItems: messages.length, nextPageToken: null })
      )
    );
  }
}

function message(id: string, direction: string, text: string, time: string) {
  return {
    id,
    conversationId: "CN-1",
    phoneNumberId: "PN-1",
    direction,
    text,
    createdAt: `2026-08-28T${time}Z`,
    updatedAt: `2026-08-28T${time}Z`,
    media: [],
  };
}

async function request(env: Env, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("X-Debug-User-Email", "admin@example.com");
  headers.set("Origin", "https://ops.from-trees.com");
  return route(
    new Request(`http://local${path}`, { ...init, headers }),
    env,
    {} as ExecutionContext
  );
}
