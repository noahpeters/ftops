import { beforeAll, describe, expect, it, vi } from "vitest";
import * as crypto from "node:crypto";
import type { ExecutionContext, Queue } from "@cloudflare/workers-types";
import { createTestEnv } from "../helpers/miniflare";
import worker from "../../src/index";
import { encryptSecrets } from "../../src/lib/crypto/secrets";
import type { WebhookEnvelope } from "@ftops/webhooks";

const MASTER_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const nodeCrypto = crypto as typeof crypto & { webcrypto?: Crypto };

describe("webhook ingress", () => {
  beforeAll(() => {
    if (!globalThis.crypto?.subtle && nodeCrypto.webcrypto) {
      (globalThis as { crypto: Crypto }).crypto = nodeCrypto.webcrypto;
    }
  });

  it("enqueues a QuickBooks webhook payload and returns 200", async () => {
    const queue = {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue;
    const context = await createTestEnv({
      env: {
        INTEGRATIONS_MASTER_KEY: MASTER_KEY,
        INTEGRATIONS_KEY_ID: "v1",
        QB_INGEST_QUEUE: queue,
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
    expect(queue.send).toHaveBeenCalledTimes(1);

    const envelope = (
      queue.send as unknown as { mock: { calls: [WebhookEnvelope][] } }
    ).mock.calls[0][0];
    expect(envelope.source).toBe("quickbooks");
    expect(envelope.realmId).toBe(realmId);
    expect(envelope.signatureVerified).toBe(true);

    await mf.dispose();
  });
});
