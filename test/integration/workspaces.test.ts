import { describe, expect, it } from "vitest";
import { createTestEnv } from "../helpers/miniflare";
import { route } from "../../src/lib/router";
import type { ExecutionContext } from "@cloudflare/workers-types";

const MASTER_KEY = Buffer.alloc(32).toString("base64");

async function requestJson(env: unknown, method: string, path: string, body?: unknown) {
  return route(
    new Request(`http://localhost${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
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

    await requestJson(env, "POST", "/integrations", {
      workspaceId: workspace.id,
      provider: "shopify",
      environment: "production",
      externalAccountId: "gamma.myshopify.com",
      secrets: { webhookSecret: "shp" },
    });

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
});
