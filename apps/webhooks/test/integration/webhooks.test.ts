import { beforeAll, describe, expect, it, vi } from "vitest";
import * as crypto from "node:crypto";
import type { ExecutionContext, Queue } from "@cloudflare/workers-types";
import { createTestEnv } from "../helpers/miniflare";
import worker from "../../src/index";
import { encryptSecrets } from "../../src/lib/crypto/secrets";
import type { IngestQueueMessage } from "@ftops/webhooks";

const MASTER_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const nodeCrypto = crypto as typeof crypto & { webcrypto?: Crypto };

describe("webhook ingress", () => {
  beforeAll(() => {
    if (!globalThis.crypto?.subtle && nodeCrypto.webcrypto) {
      (globalThis as { crypto: Crypto }).crypto = nodeCrypto.webcrypto;
    }
  });

  it("enqueues a QuickBooks ingest message and returns 200", async () => {
    const qbQueue = {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue;
    const shopifyQueue = {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue;
    const context = await createTestEnv({
      env: {
        INTEGRATIONS_MASTER_KEY: MASTER_KEY,
        INTEGRATIONS_KEY_ID: "v1",
        QB_INGEST_QUEUE: qbQueue,
        SHOPIFY_INGEST_QUEUE: shopifyQueue,
      },
    });
    if (!context) return;

    const { env, db, mf } = context;

    const workspaceId = "ws_alpha";
    const realmId = "12345";
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO workspaces (id, slug, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(workspaceId, "alpha", "Alpha", now, now)
      .run();

    const secrets = await encryptSecrets(
      env,
      JSON.stringify({ webhookVerifierToken: "qbo_secret" }),
    );
    await db
      .prepare(
        `INSERT INTO integrations
          (id, workspace_id, provider, environment, external_account_id, display_name,
           secrets_key_id, secrets_ciphertext, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        "integ_1",
        workspaceId,
        "qbo",
        "production",
        realmId,
        "Alpha QBO",
        secrets.keyId,
        secrets.ciphertext,
        1,
        now,
        now,
      )
      .run();

    const payload = JSON.stringify({
      realmId,
      eventNotifications: [{ eventId: "evt_1", realmId }],
    });
    const signature = crypto
      .createHmac("sha256", "qbo_secret")
      .update(payload)
      .digest("base64");
    const response = await worker.fetch(
      new Request("http://localhost/ingest/qbo/webhook?env=production", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "intuit-signature": signature,
        },
        body: payload,
      }),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(qbQueue.send).toHaveBeenCalledTimes(1);
    expect(shopifyQueue.send).not.toHaveBeenCalled();

    const message = (
      qbQueue.send as unknown as { mock: { calls: [IngestQueueMessage][] } }
    ).mock.calls[0][0];
    expect(message.source).toBe("quickbooks");
    expect(message.signature_verified).toBe(true);
    expect(message.body_json).toBe(payload);
    expect(message.external_account_id).toBe(realmId);

    const ingestCount = await db
      .prepare("SELECT COUNT(*) as count FROM ingest_requests")
      .first<{ count: number }>();
    expect(ingestCount?.count ?? 0).toBe(0);

    await mf.dispose();
  });

  it("enqueues a Shopify ingest message and returns 200", async () => {
    const qbQueue = {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue;
    const shopifyQueue = {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue;
    const context = await createTestEnv({
      env: {
        INTEGRATIONS_MASTER_KEY: MASTER_KEY,
        INTEGRATIONS_KEY_ID: "v1",
        QB_INGEST_QUEUE: qbQueue,
        SHOPIFY_INGEST_QUEUE: shopifyQueue,
      },
    });
    if (!context) return;

    const { env, db, mf } = context;

    const workspaceId = "ws_beta";
    const shopDomain = "demo-shop.myshopify.com";
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO workspaces (id, slug, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(workspaceId, "beta", "Beta", now, now)
      .run();

    const secrets = await encryptSecrets(
      env,
      JSON.stringify({ webhookSecret: "shopify_secret" }),
    );
    await db
      .prepare(
        `INSERT INTO integrations
          (id, workspace_id, provider, environment, external_account_id, display_name,
           secrets_key_id, secrets_ciphertext, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        "integ_2",
        workspaceId,
        "shopify",
        "production",
        shopDomain,
        "Beta Shopify",
        secrets.keyId,
        secrets.ciphertext,
        1,
        now,
        now,
      )
      .run();

    const payload = JSON.stringify({ id: 123, event: "orders/create" });
    const signature = crypto
      .createHmac("sha256", "shopify_secret")
      .update(payload)
      .digest("base64");
    const response = await worker.fetch(
      new Request("http://localhost/ingest/shopify/webhook?env=production", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-shopify-hmac-sha256": signature,
          "x-shopify-shop-domain": shopDomain,
          "x-shopify-topic": "orders/create",
          "x-shopify-webhook-id": "wh_1",
        },
        body: payload,
      }),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(shopifyQueue.send).toHaveBeenCalledTimes(1);
    expect(qbQueue.send).not.toHaveBeenCalled();

    const message = (
      shopifyQueue.send as unknown as {
        mock: { calls: [IngestQueueMessage][] };
      }
    ).mock.calls[0][0];
    expect(message.source).toBe("shopify");
    expect(message.signature_verified).toBe(true);
    expect(message.body_json).toBe(payload);
    expect(message.external_account_id).toBe(shopDomain);

    await mf.dispose();
  });
});
