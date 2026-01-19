import * as crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { buildWebhookEnvelopeId } from "@ftops/webhooks";

const nodeCrypto = crypto as typeof crypto & { webcrypto?: Crypto };

beforeAll(() => {
  if (!globalThis.crypto?.subtle && nodeCrypto.webcrypto) {
    (globalThis as { crypto: Crypto }).crypto = nodeCrypto.webcrypto;
  }
});

describe("buildWebhookEnvelopeId", () => {
  it("prefers the QuickBooks event id when present", async () => {
    const id = await buildWebhookEnvelopeId({
      source: "quickbooks",
      parsedBody: { eventNotifications: [{ eventId: "evt_123" }] },
      body: "{}",
      realmId: "456",
      path: "/ingest/qbo/webhook",
      method: "POST",
    });

    expect(id).toBe("evt_123");
  });

  it("falls back to a stable sha256 hash", async () => {
    const first = await buildWebhookEnvelopeId({
      source: "quickbooks",
      parsedBody: { eventNotifications: [] },
      body: '{"hello":"world"}',
      realmId: "456",
      path: "/ingest/qbo/webhook",
      method: "POST",
    });
    const second = await buildWebhookEnvelopeId({
      source: "quickbooks",
      parsedBody: null,
      body: '{"hello":"world"}',
      realmId: "456",
      path: "/ingest/qbo/webhook",
      method: "POST",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });
});
