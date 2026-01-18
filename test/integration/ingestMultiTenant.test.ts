import { describe, expect, it } from "vitest";
import { createTestEnv } from "../helpers/miniflare";
import { route } from "../../src/lib/router";
import type { ExecutionContext } from "@cloudflare/workers-types";
import { createHmac } from "node:crypto";
import { decryptSecrets } from "../../src/lib/crypto/secrets";

const MASTER_KEY = Buffer.alloc(32).toString("base64");

async function postJson(env: unknown, path: string, body: unknown) {
  return route(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env as never,
    {} as ExecutionContext
  );
}

function signBase64(secret: string, payload: string) {
  return createHmac("sha256", secret).update(payload).digest("base64");
}

describe("ingest multi-tenant routing", () => {
  it("routes shopify webhook by shop domain and verifies signature", async () => {
    const context = await createTestEnv({
      env: {
        INTEGRATIONS_MASTER_KEY: MASTER_KEY,
        INTEGRATIONS_KEY_ID: "v1",
      },
    });
    if (!context) return;
    const { env, db, mf } = context;

    const workspaceResponse = await postJson(env, "/workspaces", {
      slug: "alpha",
      name: "Alpha",
    });
    const workspace = (await workspaceResponse.json()) as { id: string };

    const integrationResponse = await postJson(env, "/integrations", {
      workspaceId: workspace.id,
      provider: "shopify",
      environment: "sandbox",
      externalAccountId: "alpha.myshopify.com",
      displayName: "Alpha Shop",
      secrets: { webhookSecret: "shp_secret" },
    });
    expect(integrationResponse.status).toBe(201);

    const rawBody = JSON.stringify({ hello: "world" });
    const signature = signBase64("shp_secret", rawBody);
    const webhookResponse = await route(
      new Request("http://localhost/ingest/shopify/webhook?env=sandbox", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": "alpha.myshopify.com",
          "X-Shopify-Hmac-SHA256": signature,
        },
        body: rawBody,
      }),
      env,
      {} as ExecutionContext
    );
    const webhookPayload = (await webhookResponse.json()) as {
      verified: boolean;
      routed: boolean;
      workspaceId: string;
    };
    expect(webhookPayload.verified).toBe(true);
    expect(webhookPayload.routed).toBe(true);
    expect(webhookPayload.workspaceId).toBe(workspace.id);

    const row = await db
      .prepare(
        "SELECT workspace_id, signature_verified FROM ingest_requests WHERE provider = ?"
      )
      .bind("shopify")
      .first<{ workspace_id: string; signature_verified: number }>();
    expect(row?.workspace_id).toBe(workspace.id);
    expect(row?.signature_verified).toBe(1);

    const integrationRow = await db
      .prepare("SELECT secrets_key_id, secrets_ciphertext FROM integrations LIMIT 1")
      .first<{ secrets_key_id: string; secrets_ciphertext: string }>();
    const decrypted = await decryptSecrets(
      env,
      integrationRow?.secrets_key_id ?? "v1",
      integrationRow?.secrets_ciphertext ?? ""
    );
    expect(decrypted).toContain("webhookSecret");

    await mf.dispose();
  });

  it("stores shopify webhook with unknown account", async () => {
    const context = await createTestEnv({
      env: {
        INTEGRATIONS_MASTER_KEY: MASTER_KEY,
        INTEGRATIONS_KEY_ID: "v1",
      },
    });
    if (!context) return;
    const { env, db, mf } = context;

    const rawBody = JSON.stringify({ hello: "unknown" });
    const signature = signBase64("unused", rawBody);
    await route(
      new Request("http://localhost/ingest/shopify/webhook?env=production", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": "unknown.myshopify.com",
          "X-Shopify-Hmac-SHA256": signature,
        },
        body: rawBody,
      }),
      env,
      {} as ExecutionContext
    );

    const row = await db
      .prepare(
        "SELECT verify_error, signature_verified FROM ingest_requests WHERE provider = ?"
      )
      .bind("shopify")
      .first<{ verify_error: string; signature_verified: number }>();
    expect(row?.signature_verified).toBe(0);
    expect(row?.verify_error).toBe("no_integration_for_account");

    await mf.dispose();
  });

  it("routes qbo webhook by realmId and verifies signature", async () => {
    const context = await createTestEnv({
      env: {
        INTEGRATIONS_MASTER_KEY: MASTER_KEY,
        INTEGRATIONS_KEY_ID: "v1",
      },
    });
    if (!context) return;
    const { env, db, mf } = context;

    const workspaceResponse = await postJson(env, "/workspaces", {
      slug: "beta",
      name: "Beta",
    });
    const workspace = (await workspaceResponse.json()) as { id: string };

    await postJson(env, "/integrations", {
      workspaceId: workspace.id,
      provider: "qbo",
      environment: "production",
      externalAccountId: "realm-123",
      displayName: "Beta QBO",
      secrets: { webhookVerifierToken: "qbo_secret" },
    });

    const rawBody = JSON.stringify({
      eventNotifications: [{ realmId: "realm-123" }],
    });
    const signature = signBase64("qbo_secret", rawBody);
    const response = await route(
      new Request("http://localhost/ingest/qbo/webhook?env=production", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "intuit-signature": signature,
        },
        body: rawBody,
      }),
      env,
      {} as ExecutionContext
    );

    const payload = (await response.json()) as { verified: boolean; routed: boolean };
    expect(payload.verified).toBe(true);
    expect(payload.routed).toBe(true);

    const row = await db
      .prepare("SELECT workspace_id FROM ingest_requests WHERE provider = ?")
      .bind("qbo")
      .first<{ workspace_id: string }>();
    expect(row?.workspace_id).toBe(workspace.id);

    await mf.dispose();
  });
});
