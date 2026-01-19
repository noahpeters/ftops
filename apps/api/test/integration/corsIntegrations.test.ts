import { describe, expect, it } from "vitest";
import type { ExecutionContext, Queue } from "@cloudflare/workers-types";
import worker from "../../src/index";
import { createTestEnv } from "../helpers/miniflare";

const ORIGIN = "https://ops.from-trees.com";

describe("CORS for integrations", () => {
  it("responds to preflight with CORS headers", async () => {
    const context = await createTestEnv({
      env: { EVENT_QUEUE: {} as Queue },
    });
    if (!context) return;
    const { env, mf } = context;

    const response = await worker.fetch(
      new Request("http://localhost/integrations", {
        method: "OPTIONS",
        headers: {
          Origin: ORIGIN,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "content-type",
        },
      }),
      env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(response.headers.get("Vary")).toBe("Origin");

    await mf.dispose();
  });

  it("returns CORS headers on GET", async () => {
    const context = await createTestEnv({
      env: { EVENT_QUEUE: {} as Queue },
    });
    if (!context) return;
    const { env, mf } = context;

    const response = await worker.fetch(
      new Request("http://localhost/integrations", {
        method: "GET",
        headers: {
          Origin: ORIGIN,
        },
      }),
      env,
      {} as ExecutionContext
    );

    expect([200, 400, 500]).toContain(response.status);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(response.headers.get("Vary")).toBe("Origin");

    await mf.dispose();
  });

  it("rejects disallowed origins with 403", async () => {
    const context = await createTestEnv({
      env: { EVENT_QUEUE: {} as Queue },
    });
    if (!context) return;
    const { env, mf } = context;

    const response = await worker.fetch(
      new Request("http://localhost/integrations", {
        method: "GET",
        headers: {
          Origin: "https://evil.example",
        },
      }),
      env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Vary")).toBe("Origin");

    await mf.dispose();
  });
});
