import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import ts from "typescript";
import { expect, it } from "vitest";

it("commits unchanged H2 events through the private Cloudflare entrypoint", async () => {
  const compile = (file: string) =>
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
  const mf = new Miniflare({
    workers: [
      {
        name: "h2",
        compatibilityDate: "2026-01-01",
        modules: true,
        script: `export default { fetch(request, env) {
          return (new URL(request.url).pathname === '/public' ? env.NORMAL : env.INGEST)
            .fetch('https://ftops.internal/h2-acquisition', { method: 'POST', body: request.body });
        } };`,
        serviceBindings: {
          NORMAL: "ftops",
          INGEST: { name: "ftops", entrypoint: "H2AcquisitionIngest" },
        },
      },
      {
        name: "ftops",
        compatibilityDate: "2026-01-01",
        modules: [
          {
            type: "ESModule",
            path: "index.js",
            contents: `export {H2AcquisitionIngest} from './h2AcquisitionIngest';
              export default { fetch: () => new Response(null, {status: 404}) };`,
          },
          {
            type: "ESModule",
            path: "h2AcquisitionIngest",
            contents: compile("src/h2AcquisitionIngest.ts"),
          },
          { type: "ESModule", path: "lib/http", contents: compile("src/lib/http.ts") },
          {
            type: "ESModule",
            path: "lib/websiteAcquisitionIntegration",
            contents: compile("src/lib/websiteAcquisitionIntegration.ts"),
          },
        ],
        bindings: { H2_ACQUISITION_INTEGRATION_ID: "website-1" },
        d1Databases: { DB: "analytics" },
      },
    ],
  });
  try {
    const db = await mf.getD1Database("DB", "ftops");
    await db.exec("CREATE TABLE workspaces (id TEXT PRIMARY KEY)");
    await db.exec("INSERT INTO workspaces VALUES ('default')");
    await db.exec(
      "CREATE TABLE integrations (id TEXT PRIMARY KEY, workspace_id TEXT, provider TEXT, environment TEXT, external_account_id TEXT, is_active INTEGER)"
    );
    await db.exec(
      "INSERT INTO integrations VALUES ('website-1','default','website','production','from-trees.com',1)"
    );
    for (const migration of ["0040_h2_acquisition.sql", "0041_h2_acquisition_integration.sql"]) {
      const sql = readFileSync(`migrations/${migration}`, "utf8").replace(/^--.*$/gm, "");
      for (const statement of sql.match(/\s*CREATE TRIGGER\b[\s\S]*?END;|[^;]+;/g) ?? []) {
        await db.prepare(statement).run();
      }
    }

    const row = {
      id: "paid-click",
      kind: "ad_attribution",
      occurred_at: "2026-11-27T09:00:00.000Z",
      received_at: "2026-11-27T09:01:00.000Z",
      visitor_id: "browser",
      session_id: "session",
      payload: '{ "attribution": {"gclid":"original-click"}, "version":"baseline-v1" }',
    };
    const deliver = (events: unknown[], caughtUp = false, path = "/") =>
      mf.dispatchFetch(`https://h2.example${path}`, {
        method: "POST",
        body: JSON.stringify({ events, caughtUp }),
      });

    expect((await deliver([row], false, "/public")).status).toBe(404);
    expect((await deliver([row])).status).toBe(204);
    expect((await deliver([row])).status).toBe(204);
    expect(
      (
        await deliver([
          { ...row, id: "rollback" },
          { ...row, payload: "{}" },
        ])
      ).status
    ).toBe(500);
    expect((await deliver([{ ...row, received_at: "bad-time" }])).status).toBe(400);
    expect((await deliver([], true)).status).toBe(204);
    const events = await db.prepare("SELECT * FROM h2_acquisition_events").all();
    expect(events.results).toEqual([
      { workspace_id: "default", integration_id: "website-1", ...row },
    ]);
    expect(
      await db
        .prepare("SELECT workspace_id, integration_id FROM h2_acquisition_delivery_state")
        .first()
    ).toEqual({ workspace_id: "default", integration_id: "website-1" });
  } finally {
    await mf.dispose();
  }
});
