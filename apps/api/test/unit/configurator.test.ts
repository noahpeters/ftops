import { afterEach, expect, it, vi } from "vitest";
import { handleConfigurator } from "../../src/routes/configurator";
import { requireActor } from "../../src/lib/access";
import type { Env } from "../../src/lib/types";
vi.mock("../../src/lib/access", () => ({ requireActor: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const env = {
  CABINET_ANALYTICS_URL: "https://rooms.example",
  CABINET_ANALYTICS_READ_TOKEN: "private-report-token",
} as Env;
const request = (method = "GET") =>
  new Request("https://ops.example/configurator?days=7&page=2&token=untrusted", {
    method,
    headers: { "Cf-Access-Authenticated-User-Email": "admin@example.com" },
  });
function admin(value: boolean) {
  vi.mocked(requireActor).mockResolvedValue({
    ok: true,
    actor: {
      email: "admin@example.com",
      isSystemAdmin: value,
      workspaceIds: [],
      workspaceAdminIds: [],
    },
  });
}
it("rejects unauthenticated and non-admin requests before contacting the reporting service", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  admin(false);
  expect((await handleConfigurator([], request(), env)).status).toBe(403);
  expect(
    (await handleConfigurator([], new Request("https://ops.example/configurator"), env)).status
  ).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
it("allows only reads and reports a missing connection distinctly", async () => {
  admin(true);
  expect((await handleConfigurator([], request("POST"), env)).status).toBe(405);
  const response = await handleConfigurator([], request(), {} as Env);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "configurator_not_connected" });
});
it("forwards only fixed paths and supported filters and never returns credentials", async () => {
  admin(true);
  const fetcher = vi.fn().mockResolvedValue(Response.json({ totals: { visits: 3 } }));
  vi.stubGlobal("fetch", fetcher);
  const response = await handleConfigurator([], request(), env);
  expect(fetcher.mock.calls[0][0].toString()).toBe(
    "https://rooms.example/admin/dashboard?days=7&page=2"
  );
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    headers: { Authorization: "Bearer private-report-token" },
    redirect: "manual",
  });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ totals: { visits: 3 } });
});
it("does not leak upstream errors or follow redirects", async () => {
  admin(true);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("private-report-token", { status: 401 }))
  );
  const response = await handleConfigurator([], request(), env);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private-report-token");
});

it("uses the private service binding for reports and design previews", async () => {
  admin(true);
  const publicFetch = vi.fn();
  vi.stubGlobal("fetch", publicFetch);
  const serviceFetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
  const boundEnv = { ...env, CABINET_ANALYTICS_SERVICE: { fetch: serviceFetch } } as unknown as Env;
  expect((await handleConfigurator([], request(), boundEnv)).status).toBe(200);
  expect(serviceFetch.mock.calls[0][0].toString()).toBe(
    "https://rooms.example/admin/dashboard?days=7&page=2"
  );
  const previewRequest = new Request(
    "https://ops.example/configurator/design?slug=room-1&token=untrusted",
    {
      headers: request().headers,
    }
  );
  expect((await handleConfigurator(["design"], previewRequest, boundEnv)).status).toBe(200);
  expect(serviceFetch.mock.calls[1][0].toString()).toBe(
    "https://rooms.example/admin/design?slug=room-1"
  );
  expect(serviceFetch.mock.calls[1][1]).toMatchObject({
    headers: { Authorization: "Bearer private-report-token" },
    redirect: "manual",
  });
  expect(publicFetch).not.toHaveBeenCalled();
});
