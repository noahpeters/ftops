import { describe, expect, it, vi } from "vitest";
import type { Queue } from "@cloudflare/workers-types";
import type { IngestQueueMessage } from "@ftops/webhooks";
import { createTestEnv } from "../helpers/miniflare";
import { processIngestQueueMessage } from "../../src/processors/ingestQueue";

describe("ingest queue consumer", () => {
  it("inserts ingest_requests and emits one EVENT_QUEUE message", async () => {
    const eventQueue = {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue;
    const context = await createTestEnv({
      env: { EVENT_QUEUE: eventQueue },
    });
    if (!context) return;

    const { env, db, mf } = context;
    const receivedAt = new Date().toISOString();

    const message: IngestQueueMessage = {
      id: "ingest_1",
      source: "shopify",
      workspace_id: "ws_default",
      environment: "production",
      external_account_id: "demo-shop.myshopify.com",
      integration_id: "integ_1",
      received_at: receivedAt,
      method: "POST",
      path: "/ingest/shopify/webhook",
      headers_json: JSON.stringify({
        "x-shopify-topic": "orders/create",
        "x-shopify-webhook-id": "wh_1",
      }),
      body_text: '{"hello":"world"}',
      body_json: '{"hello":"world"}',
      content_type: "application/json",
      signature: "sig",
      signature_header: "sig",
      signature_verified: true,
      verify_error: null,
      notes: null,
    };

    await processIngestQueueMessage(message, env);

    expect(eventQueue.send).toHaveBeenCalledTimes(1);
    const eventPayload = (
      eventQueue.send as unknown as {
        mock: { calls: [[Record<string, unknown>]] };
      }
    ).mock.calls[0][0];
    expect(eventPayload.source).toBe("shopify");
    expect(eventPayload.type).toBe("shopify.orders.create");
    expect(eventPayload.idempotencyKey).toBe("shopify:shopify.orders.create:ingest_1");
    expect(eventPayload.payload).toMatchObject({
      ingestRequestId: "ingest_1",
      integrationId: "integ_1",
    });

    const row = await db
      .prepare(
        `SELECT id, provider, emitted_event_id, emitted_at
         FROM ingest_requests WHERE id = ?`
      )
      .bind("ingest_1")
      .first<{
        id: string;
        provider: string;
        emitted_event_id: string | null;
        emitted_at: string | null;
      }>();

    expect(row?.id).toBe("ingest_1");
    expect(row?.provider).toBe("shopify");
    expect(row?.emitted_event_id).toBe("shopify:shopify.orders.create:ingest_1");
    expect(row?.emitted_at).toBeTruthy();

    await mf.dispose();
  });

  it("does not emit twice for the same ingest id", async () => {
    const eventQueue = {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue;
    const context = await createTestEnv({
      env: { EVENT_QUEUE: eventQueue },
    });
    if (!context) return;

    const { env, db, mf } = context;
    const receivedAt = new Date().toISOString();

    const message: IngestQueueMessage = {
      id: "ingest_2",
      source: "shopify",
      workspace_id: "ws_default",
      environment: "production",
      external_account_id: "demo-shop.myshopify.com",
      integration_id: "integ_1",
      received_at: receivedAt,
      method: "POST",
      path: "/ingest/shopify/webhook",
      headers_json: JSON.stringify({ "x-shopify-topic": "orders/create" }),
      body_text: "{}",
      body_json: "{}",
      content_type: "application/json",
      signature: "sig",
      signature_header: "sig",
      signature_verified: true,
      verify_error: null,
      notes: null,
    };

    await processIngestQueueMessage(message, env);
    await processIngestQueueMessage(message, env);

    expect(eventQueue.send).toHaveBeenCalledTimes(1);

    const count = await db
      .prepare("SELECT COUNT(*) as count FROM ingest_requests WHERE id = ?")
      .bind("ingest_2")
      .first<{ count: number }>();
    expect(count?.count).toBe(1);

    await mf.dispose();
  });
});
