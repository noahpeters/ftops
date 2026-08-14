import { describe, expect, it, vi } from "vitest";
import { createTestEnv } from "../helpers/miniflare";
import { route } from "../../src/lib/router";
import type { ExecutionContext } from "@cloudflare/workers-types";

const MASTER_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

async function requestJson(env: unknown, method: string, path: string, body?: unknown) {
  const headers = new Headers(body ? { "content-type": "application/json" } : undefined);
  headers.set("x-debug-user-email", "admin@example.com");
  if (["POST", "PATCH", "DELETE"].includes(method)) {
    headers.set("origin", "https://ops.from-trees.com");
  }

  return route(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }),
    env as never,
    {} as ExecutionContext
  );
}

describe("workspaces integration", () => {
  it("create workspace", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, mf } = context;

    const response = await requestJson(env, "POST", "/workspaces", {
      slug: "alpha",
      name: "Alpha",
    });
    expect(response.status).toBe(201);
    const workspace = (await response.json()) as { slug: string };
    expect(workspace.slug).toBe("alpha");

    await mf.dispose();
  });

  it("update workspace", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, mf } = context;

    const create = await requestJson(env, "POST", "/workspaces", {
      slug: "beta",
      name: "Beta",
    });
    const created = (await create.json()) as { id: string };

    const updated = await requestJson(env, "PATCH", `/workspaces/${created.id}`, {
      name: "Beta Updated",
      slug: "beta-updated",
    });
    const payload = (await updated.json()) as { name: string; slug: string };
    expect(payload.name).toBe("Beta Updated");
    expect(payload.slug).toBe("beta-updated");

    await mf.dispose();
  });

  it("delete blocked for default workspace", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, mf } = context;

    const response = await requestJson(env, "DELETE", "/workspaces/default");
    expect(response.status).toBe(400);

    await mf.dispose();
  });

  it("delete blocked when workspace not empty", async () => {
    const context = await createTestEnv({
      env: {
        INTEGRATIONS_MASTER_KEY: MASTER_KEY,
        INTEGRATIONS_KEY_ID: "v1",
      },
    });
    if (!context) return;
    const { env, mf } = context;

    const workspaceResponse = await requestJson(env, "POST", "/workspaces", {
      slug: "gamma",
      name: "Gamma",
    });
    const workspace = (await workspaceResponse.json()) as { id: string };

    const integrationResponse = await requestJson(env, "POST", "/integrations", {
      workspaceId: workspace.id,
      provider: "shopify",
      environment: "production",
      externalAccountId: "gamma.myshopify.com",
      secrets: { webhookSecret: "shp" },
    });
    expect(integrationResponse.status).toBe(201);

    const response = await requestJson(env, "DELETE", `/workspaces/${workspace.id}`);
    expect(response.status).toBe(409);
    const payload = (await response.json()) as { counts: { integrations: number } };
    expect(payload.counts.integrations).toBeGreaterThan(0);

    await mf.dispose();
  });

  it("delete succeeds when empty", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, mf } = context;

    const workspaceResponse = await requestJson(env, "POST", "/workspaces", {
      slug: "delta",
      name: "Delta",
    });
    const workspace = (await workspaceResponse.json()) as { id: string };

    const response = await requestJson(env, "DELETE", `/workspaces/${workspace.id}`);
    expect(response.status).toBe(200);

    await mf.dispose();
  });

  it("lets workspace admins manually send a user's daily summary", async () => {
    const context = await createTestEnv({
      env: {
        RESEND_API_KEY: "test-key",
        DAILY_SUMMARY_FROM_EMAIL: "notifications@fromtrees.studio",
      },
    });
    if (!context) return;
    const { env, db, mf } = context;
    await db
      .prepare(
        `INSERT INTO users (workspace_id,user_id,name,email,workspace_admin,system_admin)
         VALUES ('default','admin','Admin','admin@example.com',1,0),
                ('default','recipient','Recipient','recipient@example.com',0,0)`
      )
      .run();
    const fetchMock = vi.fn(async () => Response.json({ id: "manual-email" }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const response = await requestJson(
        env,
        "POST",
        "/workspaces/default/users/recipient/daily-summary"
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        taskCount: 0,
        customerCount: 0,
        providerMessageId: "manual-email",
      });
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      await mf.dispose();
    }
  });
});
