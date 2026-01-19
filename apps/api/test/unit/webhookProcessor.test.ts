import { describe, expect, it } from "vitest";
import { createTestEnv } from "../helpers/miniflare";
import { processWebhookEnvelope } from "../../src/processors/webhookProcessor";
import type { WebhookEnvelope } from "@ftops/webhooks";

describe("processWebhookEnvelope", () => {
  it("writes raw_events and dedupes by id", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, db, mf } = context;

    const message: WebhookEnvelope = {
      id: "evt_1",
      source: "quickbooks",
      workspaceId: "ws_alpha",
      realmId: "123",
      externalAccountId: "123",
      integrationId: "integ_1",
      environment: "production",
      receivedAt: new Date().toISOString(),
      path: "/ingest/qbo/webhook",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"hello":"world"}',
      contentType: "application/json",
      signature: "sig",
      signatureVerified: true,
      verifyError: null,
    };

    await processWebhookEnvelope(message, env);
    await processWebhookEnvelope(message, env);

    const row = await db
      .prepare("SELECT id, source, signature_verified FROM raw_events WHERE id = ?")
      .bind(message.id)
      .first<{ id: string; source: string; signature_verified: number }>();

    expect(row?.id).toBe(message.id);
    expect(row?.source).toBe("quickbooks");
    expect(row?.signature_verified).toBe(1);

    const countRow = await db
      .prepare("SELECT COUNT(*) as count FROM raw_events WHERE id = ?")
      .bind(message.id)
      .first<{ count: number }>();
    expect(countRow?.count).toBe(1);

    await mf.dispose();
  });
});
