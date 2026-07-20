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

  it.each([
    ["GET", "/api/customers?workspaceId=ws_123"],
    ["POST", "/api/customers"],
    ["GET", "/api/customers/customer_1"],
    ["PATCH", "/api/customers/customer_1"],
    ["POST", "/api/customers/customer_1/contacts"],
    ["PATCH", "/api/customers/customer_1/addresses/address_1"],
    ["POST", "/api/customers/customer_1/activities"],
    ["GET", "/api/customers/customer_1/estimates"],
    ["GET", "/api/customers/customer_1/quickbooks/search?integrationId=qbo_1"],
    ["POST", "/api/customers/customer_1/quickbooks/link"],
    ["GET", "/api/integrations/qbo/connect?workspaceId=ws_123&environment=production"],
    ["GET", "/api/integrations/qbo/callback?code=code&realmId=realm&state=state"],
    ["GET", "/api/integrations/qbo/status?workspaceId=ws_123"],
    ["POST", "/api/integrations/qbo/disconnect"],
    ["POST", "/api/integrations/qbo/bootstrap"],
  ])("forwards customer API %s %s", async (method, path) => {
    const fetch = vi.fn(async () => new Response("ok"));
    const env = { API: { fetch } } as unknown as ApiProxyEnv;
    const response = await handleApiProxyRequest(
      new Request(`https://ops.from-trees.com${path}`, {
        method,
        headers: { "cf-access-authenticated-user-email": "noah@from-trees.com" },
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
