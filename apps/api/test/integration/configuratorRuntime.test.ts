import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { Miniflare } from "miniflare";
import ts from "typescript";
import { expect, it } from "vitest";

it("loads reports in workerd and rejects upstream redirects without following them", async () => {
  const compile = (file: string) =>
    ts.transpileModule(readFileSync(resolve(file), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
  const luxonRoot = dirname(createRequire(import.meta.url).resolve("luxon/package.json"));
  const mf = new Miniflare({
    workers: [
      {
        name: "ui-proxy",
        compatibilityDate: "2026-01-01",
        modules: [
          {
            type: "ESModule",
            path: "index.js",
            contents: `import {handleApiProxyRequest} from './apiProxy'; export default {fetch(request, env){return handleApiProxyRequest(request, env);}};`,
          },
          { type: "ESModule", path: "apiProxy", contents: compile("../ui/src/worker/apiProxy.ts") },
        ],
        serviceBindings: { API: "reporting-api" },
      },
      {
        name: "reporting-api",
        compatibilityDate: "2026-01-01",
        modules: [
          {
            type: "ESModule",
            path: "index.js",
            contents: `import { handleConfigurator } from './routes/configurator';
              import { handleMe } from './routes/me';
              export default { fetch(request, env) {
                const leaf = new URL(request.url).pathname.split('/').pop();
                if (leaf === "me") return handleMe([], request, env);
                const segments = ['design','export','extension','cost-report','acquisition'].includes(leaf) ? [leaf] : [];
                return handleConfigurator(segments, request, env);
              }};`,
          },
          {
            type: "ESModule",
            path: "routes/configurator",
            contents: compile("src/routes/configurator.ts"),
          },
          {
            type: "ESModule",
            path: "assets/sketchupExtension",
            contents: compile("src/assets/sketchupExtension.ts"),
          },
          {
            type: "ESModule",
            path: "routes/luxon",
            contents: readFileSync(resolve(luxonRoot, "build/es6/luxon.mjs"), "utf8"),
          },
          { type: "ESModule", path: "lib/http", contents: compile("src/lib/http.ts") },
          {
            type: "ESModule",
            path: "lib/access",
            contents: compile("src/lib/access.ts"),
          },
          { type: "ESModule", path: "lib/identity", contents: compile("src/lib/identity.ts") },
          { type: "ESModule", path: "routes/me", contents: compile("src/routes/me.ts") },
          {
            type: "ESModule",
            path: "lib/websiteAcquisitionIntegration",
            contents: compile("src/lib/websiteAcquisitionIntegration.ts"),
          },
        ],
        d1Databases: { DB: "reporting-roles" },
        bindings: {
          CABINET_ANALYTICS_WORKSPACE_ID: "default",
          CABINET_ANALYTICS_URL: "https://rooms.example",
          CABINET_ANALYTICS_READ_TOKEN: "test-read-token",
        },
        serviceBindings: { CABINET_ANALYTICS_SERVICE: "rooms" },
      },
      {
        name: "rooms",
        compatibilityDate: "2026-01-01",
        modules: true,
        script: `export default { fetch(request) {
          const url = new URL(request.url);
          if (request.headers.get('Authorization') !== 'Bearer test-read-token') return new Response(null,{status:401});
          if (url.searchParams.get('slug') === 'redirect') return Response.redirect('https://rooms.example/followed',302);
          return Response.json({path:url.pathname});
        }};`,
      },
    ],
  });
  try {
    const db = await mf.getD1Database("DB", "reporting-api");
    await db.exec(
      "CREATE TABLE users (email TEXT, workspace_id TEXT, workspace_admin INTEGER, system_admin INTEGER)"
    );
    await db.exec(
      "INSERT INTO users VALUES ('admin@example.com','default',1,0), ('member@example.com','default',0,0), ('other@example.com','other',1,0)"
    );
    const headers = { "Cf-Access-Authenticated-User-Email": "admin@example.com" };
    const memberHeaders = { "Cf-Access-Authenticated-User-Email": "member@example.com" };
    const otherHeaders = { "Cf-Access-Authenticated-User-Email": "other@example.com" };
    const memberProfile = await mf.dispatchFetch("https://ops.example/api/me", {
      headers: memberHeaders,
    });
    await expect(memberProfile.json()).resolves.toMatchObject({
      isSystemAdmin: false,
      cabinetAnalyticsWorkspaceId: "default",
    });
    const otherProfile = await mf.dispatchFetch("https://ops.example/api/me", {
      headers: otherHeaders,
    });
    await expect(otherProfile.json()).resolves.toMatchObject({
      cabinetAnalyticsWorkspaceId: null,
    });
    const report = await mf.dispatchFetch("https://ops.example/api/configurator", { headers });
    expect(report.status).toBe(200);
    expect(await report.json()).toEqual({ path: "/admin/dashboard" });
    const acquisition = await mf.dispatchFetch(
      "https://ops.example/api/configurator/acquisition?days=30",
      { headers: memberHeaders }
    );
    expect(acquisition.status).toBe(200);
    expect(await acquisition.json()).toEqual({ path: "/admin/acquisition" });
    expect(
      (
        await mf.dispatchFetch("https://ops.example/api/configurator/acquisition?days=30", {
          headers: otherHeaders,
        })
      ).status
    ).toBe(403);
    expect(
      (
        await mf.dispatchFetch("https://ops.example/api/configurator/cost-report", {
          headers: memberHeaders,
        })
      ).status
    ).toBe(403);
    const preview = await mf.dispatchFetch(
      "https://ops.example/api/configurator/design?slug=room",
      {
        headers,
      }
    );
    expect(preview.status).toBe(200);
    expect(await preview.json()).toEqual({ path: "/admin/design" });
    const exported = await mf.dispatchFetch(
      "https://ops.example/api/configurator/export?slug=room&revision=4&drawerThickness=0.625",
      { headers }
    );
    expect(exported.status).toBe(200);
    expect(await exported.json()).toEqual({ path: "/admin/export" });
    const cost = await mf.dispatchFetch(
      "https://ops.example/api/configurator/cost-report?slug=room&revision=4",
      { headers }
    );
    expect(cost.status).toBe(200);
    expect(await cost.json()).toEqual({ path: "/admin/cost-report" });
    expect(
      (
        await mf.dispatchFetch(
          "https://ops.example/api/configurator/cost-report?slug=room&revision=4",
          { method: "POST", headers }
        )
      ).status
    ).toBe(403);
    const installer = await mf.dispatchFetch("https://ops.example/api/configurator/extension", {
      headers,
    });
    expect(installer.status).toBe(200);
    const artifact = (await installer.json()) as any;
    expect(artifact.filename).toMatch(/\.rbz$/);
    expect(artifact.sourceRepository).toBe("https://github.com/noahpeters/from-trees-sketchup");
    const redirect = await mf.dispatchFetch(
      "https://ops.example/api/configurator/design?slug=redirect",
      { headers }
    );
    expect(redirect.status).toBe(503);
    expect(await redirect.json()).toEqual({ error: "configurator_unavailable" });
  } finally {
    await mf.dispose();
  }
}, 15000);
