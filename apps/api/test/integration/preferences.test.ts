import { describe, expect, it } from "vitest";
import type { ExecutionContext } from "@cloudflare/workers-types";
import { route } from "../../src/lib/router";
import { createTestEnv } from "../helpers/miniflare";

describe("user preferences API", () => {
  it("stores validated preferences for the authenticated user", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, mf } = context;

    const empty = await request(env, "/preferences");
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({});

    const filters = await request(env, "/preferences/customer_status_filters", {
      method: "PUT",
      body: JSON.stringify({ value: ["lead", "active", "lead"] }),
    });
    expect(filters.status).toBe(200);
    expect(await filters.json()).toMatchObject({ value: ["lead", "active"] });

    const rail = await request(env, "/preferences/left_rail_collapsed", {
      method: "PUT",
      body: JSON.stringify({ value: true }),
    });
    expect(rail.status).toBe(200);

    const loaded = await request(env, "/preferences");
    expect(await loaded.json()).toEqual({
      customer_status_filters: ["lead", "active"],
      left_rail_collapsed: true,
    });

    const invalid = await request(env, "/preferences/customer_status_filters", {
      method: "PUT",
      body: JSON.stringify({ value: ["unknown"] }),
    });
    expect(invalid.status).toBe(400);
    await mf.dispose();
  });
});

function request(env: Parameters<typeof route>[1], path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  headers.set("X-Debug-User-Email", "dev@example.com");
  return route(new Request(`http://local${path}`, { ...init, headers }), env, {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext);
}
