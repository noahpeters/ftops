import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestEnv } from "../helpers/miniflare";
import { route } from "../../src/lib/router";
import type { ExecutionContext } from "@cloudflare/workers-types";

describe("customers API", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates an unlinked customer and loads detail and filters", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, mf } = context;
    const created = await request(env, "/customers", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: "default",
        displayName: "Acme Millwork",
        companyName: "Acme",
        status: "lead",
      }),
    });
    expect(created.status).toBe(201);
    const detail = (await created.json()) as {
      customer: { id: string; quickbooks_sync_status: string };
    };
    expect(detail.customer.quickbooks_sync_status).toBe("not_linked");
    const list = await request(
      env,
      "/customers?workspaceId=default&search=Acme&status=lead&sync=not_linked"
    );
    expect(list.status).toBe(200);
    expect((await list.json()) as unknown[]).toHaveLength(1);
    const loaded = await request(env, `/customers/${detail.customer.id}`);
    expect(loaded.status).toBe(200);

    const note = await request(env, `/customers/${detail.customer.id}/activities`, {
      method: "POST",
      headers: { "X-Debug-User-Email": "author@example.com" },
      body: JSON.stringify({ subject: "Note", body: "Called about the estimate." }),
    });
    expect(note.status).toBe(201);
    const activities = (await note.json()) as Array<{
      body: string | null;
      created_by: string | null;
    }>;
    expect(activities[0]).toMatchObject({
      body: "Called about the estimate.",
      created_by: "author@example.com",
    });
    await mf.dispose();
  });

  it("enforces authorization and workspace isolation", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, db, mf } = context;
    await db
      .prepare(
        `INSERT INTO users (workspace_id,user_id,name,email,workspace_admin,system_admin) VALUES ('default','u1','One','one@example.com',0,0)`
      )
      .run();
    const forbidden = await request(env, "/customers?workspaceId=ws_unknown", {
      headers: { "X-Debug-User-Email": "one@example.com" },
    });
    expect(forbidden.status).toBe(403);
    const unknown = await request(env, "/customers?workspaceId=default", {
      headers: { "X-Debug-User-Email": "other@example.com" },
    });
    expect(unknown.status).toBe(403);
    await mf.dispose();
  });
});

function request(env: Parameters<typeof route>[1], path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  return route(
    new Request(`http://localhost${path}`, { ...init, headers }),
    env,
    {} as ExecutionContext
  );
}
