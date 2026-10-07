import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import ts from "typescript";
import { expect, it } from "vitest";

it("loads reports in workerd and rejects upstream redirects without following them", async () => {
  const compile = (file: string) =>
    ts.transpileModule(readFileSync(resolve(file), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
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
              export default { fetch(request, env) {
                const leaf = new URL(request.url).pathname.split('/').pop();
                const segments = ['design','export','extension','cost-report'].includes(leaf) ? [leaf] : [];
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
          { type: "ESModule", path: "lib/http", contents: compile("src/lib/http.ts") },
          {
            type: "ESModule",
            path: "lib/access",
            contents: `export async function requireActor() { return {ok:true,actor:{isSystemAdmin:true}}; }`,
          },
        ],
        bindings: {
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
    const headers = { "Cf-Access-Authenticated-User-Email": "admin@example.com" };
    const report = await mf.dispatchFetch("https://ops.example/api/configurator", { headers });
    expect(report.status).toBe(200);
    expect(await report.json()).toEqual({ path: "/admin/dashboard" });
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
