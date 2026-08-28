import { describe, expect, it } from "vitest";
import type { ExecutionContext } from "@cloudflare/workers-types";
import worker from "../../src/index";
import { createTestEnv } from "../helpers/miniflare";

describe("ingest request browsing", () => {
  it("lists and loads Quo requests from the current ingest_requests table", async () => {
    const context = await createTestEnv();
    if (!context) return;
    const { env, db, mf } = context;
    await db
      .prepare(
        `INSERT INTO ingest_requests
       (id,workspace_id,provider,environment,received_at,method,url,headers_json,body_text,
        body_json,signature_header,signature_verified,verify_error,emitted_event_id,emitted_at)
       VALUES ('EV_quo_1','ws_default','quo','production','2026-08-28T01:00:00Z','POST',
        '/ingest/quo/quo_1/webhook','{}','{}',?,'signature',1,NULL,'quo:quo.webhook:EV_quo_1',
        '2026-08-28T01:00:01Z')`
      )
      .bind(JSON.stringify({ id: "EV_quo_1", type: "call.completed" }))
      .run();

    const listResponse = await worker.fetch(
      new Request(
        "http://localhost/ingest/requests?provider=quo&environment=production&workspaceId=ws_default"
      ),
      env,
      {} as ExecutionContext
    );
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as { requests: Array<Record<string, unknown>> };
    expect(list.requests).toHaveLength(1);
    expect(list.requests[0]).toMatchObject({
      id: "EV_quo_1",
      provider: "quo",
      event_type: "call.completed",
      signature_verified: 1,
      emitted_event_id: "quo:quo.webhook:EV_quo_1",
    });

    const detailResponse = await worker.fetch(
      new Request("http://localhost/ingest/requests/EV_quo_1"),
      env,
      {} as ExecutionContext
    );
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({ id: "EV_quo_1", provider: "quo" });
    await mf.dispose();
  });
});
