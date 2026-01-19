import { describe, expect, it, vi } from "vitest";
import type { ApiProxyEnv } from "../../../ui/src/worker/apiProxy";
import { handleApiProxyRequest } from "../../../ui/src/worker/apiProxy";

describe("ops api proxy allowlist", () => {
  it("forwards allowed /api/integrations requests via the service binding", async () => {
    const fetch = vi.fn(async (req: Request) => new Response("ok"));
    const env = { API: { fetch } } as unknown as ApiProxyEnv;

    const request = new Request("https://ops.from-trees.com/api/integrations?workspaceId=ws_123", {
      method: "GET",
      headers: {
        "cf-access-authenticated-user-email": "noah@from-trees.com",
      },
    });

    const response = await handleApiProxyRequest(request, env);

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);

    const upstreamRequest = fetch.mock.calls[0][0] as Request;
    const upstreamUrl = new URL(upstreamRequest.url);
    expect(upstreamRequest.method).toBe("GET");
    expect(upstreamUrl.pathname).toBe("/integrations");
    expect(upstreamUrl.search).toBe("?workspaceId=ws_123");
  });

  it("rejects disallowed paths without proxying", async () => {
    const fetch = vi.fn();
    const env = { API: { fetch } } as unknown as ApiProxyEnv;

    const request = new Request("https://ops.from-trees.com/api/health", {
      method: "GET",
      headers: {
        "cf-access-authenticated-user-email": "noah@from-trees.com",
      },
    });

    const response = await handleApiProxyRequest(request, env);

    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});
