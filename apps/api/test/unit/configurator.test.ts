import { afterEach, expect, it, vi } from "vitest";
import { handleConfigurator } from "../../src/routes/configurator";
import { requireActor } from "../../src/lib/access";
import type { Env } from "../../src/lib/types";
vi.mock("../../src/lib/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/access")>()),
  requireActor: vi.fn(),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const env = {
  CABINET_ANALYTICS_URL: "https://rooms.example",
  CABINET_ANALYTICS_WORKSPACE_ID: "default",
  CABINET_ANALYTICS_READ_TOKEN: "private-report-token",
} as Env;
const request = (method = "GET") =>
  new Request("https://ops.example/configurator?days=7&page=2&token=untrusted", {
    method,
    headers: { "Cf-Access-Authenticated-User-Email": "admin@example.com" },
  });
function admin(value: boolean, workspaceIds: string[] = [], workspaceAdminIds: string[] = []) {
  vi.mocked(requireActor).mockResolvedValue({
    ok: true,
    actor: {
      email: "admin@example.com",
      isSystemAdmin: value,
      workspaceIds,
      workspaceAdminIds,
    },
  });
}
it("rejects unauthenticated and unrelated workspace requests before contacting the reporting service", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  admin(false, ["another-workspace"]);
  expect((await handleConfigurator([], request(), env)).status).toBe(403);
  expect(
    (await handleConfigurator([], new Request("https://ops.example/configurator"), env)).status
  ).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
it("allows only reads and reports a missing connection distinctly", async () => {
  admin(true);
  expect((await handleConfigurator([], request("POST"), env)).status).toBe(405);
  const response = await handleConfigurator([], request(), {
    CABINET_ANALYTICS_WORKSPACE_ID: "default",
  } as Env);
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

it("gates exports and forwards only construction settings over the private binding", async () => {
  const serviceFetch = vi.fn().mockResolvedValue(
    Response.json({
      filename: "From-Trees-aaaaaaaa-r4",
      ruby: "script",
      csv: "parts",
      manifest: { parts: [] },
    })
  );
  const boundEnv = { ...env, CABINET_ANALYTICS_SERVICE: { fetch: serviceFetch } } as unknown as Env;
  const exportRequest = new Request(
    "https://ops.example/configurator/export?slug=aaaaaaaa&revision=4&drawerThickness=0.625&url=https://evil.example&token=secret",
    { headers: request().headers }
  );
  admin(false);
  expect((await handleConfigurator(["export"], exportRequest, boundEnv)).status).toBe(403);
  expect(serviceFetch).not.toHaveBeenCalled();
  admin(true);
  const response = await handleConfigurator(["export"], exportRequest, boundEnv);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(serviceFetch.mock.calls[0][0].toString()).toBe(
    "https://rooms.example/admin/export?slug=aaaaaaaa&revision=4&drawerThickness=0.625"
  );
  expect(serviceFetch.mock.calls[0][1].headers).toEqual({
    Authorization: "Bearer private-report-token",
  });
  serviceFetch.mockResolvedValue(
    Response.json({ error: "design_revision_changed", issues: [] }, { status: 409 })
  );
  expect((await handleConfigurator(["export"], exportRequest, boundEnv)).status).toBe(409);
  serviceFetch.mockResolvedValue(
    Response.json(
      { error: "fabrication_needs_review", issues: ["Unsupported curve"] },
      { status: 422 }
    )
  );
  expect(await (await handleConfigurator(["export"], exportRequest, boundEnv)).json()).toEqual({
    error: "fabrication_needs_review",
    issues: ["Unsupported curve"],
  });
});

it("serves the pinned installer to authenticated members of the owning workspace", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  admin(false);
  expect((await handleConfigurator(["extension"], request(), env)).status).toBe(403);
  admin(false, ["default"]);
  const response = await handleConfigurator(["extension"], request(), env);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = (await response.json()) as any;
  expect(body.filename).toBe("from-trees-cabinet-designer-0.2.0.rbz");
  expect(body.sourceRepository).toBe("https://github.com/noahpeters/from-trees-sketchup");
  expect(body.sourceRevision).toMatch(/^[a-f0-9]{40}$/);
  const { createHash } = await import("node:crypto");
  expect(createHash("sha256").update(Buffer.from(body.data, "base64")).digest("hex")).toBe(
    body.sha256
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it("restricts economics reports to workspace admins and forwards only slug and revision", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ report: { totals: { cost: 100 } }, csv: "report" }));
  const boundEnv = { ...env, CABINET_ANALYTICS_SERVICE: { fetch: fetcher } } as unknown as Env;
  const costRequest = new Request(
    "https://ops.example/configurator/cost-report?slug=aaaaaaaa&revision=4&margin=0&token=secret",
    { headers: request().headers }
  );
  admin(false, ["default"]);
  expect((await handleConfigurator(["cost-report"], costRequest, boundEnv)).status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
  admin(false, ["default"], ["default"]);
  const response = await handleConfigurator(["cost-report"], costRequest, boundEnv);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(fetcher.mock.calls[0][0].toString()).toBe(
    "https://rooms.example/admin/cost-report?slug=aaaaaaaa&revision=4"
  );
  fetcher.mockResolvedValue(Response.json({ error: "design_revision_changed" }, { status: 409 }));
  expect((await handleConfigurator(["cost-report"], costRequest, boundEnv)).status).toBe(409);
});

it("sends only the Pacific calendar window to the private acquisition endpoint", async () => {
  admin(false, ["default"]);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-03T06:00:00Z"));
  const fetcher = vi.fn().mockResolvedValue(Response.json({ totals: { views: 3 } }));
  vi.stubGlobal("fetch", fetcher);
  const acquisition = (days: string) =>
    new Request(`https://ops.example/configurator/acquisition?days=${days}&start=untrusted`, {
      headers: { "Cf-Access-Authenticated-User-Email": "admin@example.com" },
    });
  expect((await handleConfigurator(["acquisition"], acquisition("365"), env)).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
  const response = await handleConfigurator(["acquisition"], acquisition("7"), env);
  const target = fetcher.mock.calls[0][0] as URL;
  expect(target.pathname).toBe("/admin/acquisition");
  expect([...target.searchParams.entries()]).toEqual([
    ["start", "2026-10-27T07:00:00.000Z"],
    ["end", "2026-11-03T08:00:00.000Z"],
  ]);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
