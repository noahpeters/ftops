import { describe, expect, it, vi } from "vitest";
import type { Queue } from "@cloudflare/workers-types";
import { createTestEnv } from "../helpers/miniflare";
import { encryptSecrets } from "../../src/lib/crypto/secrets";
import { processQuickbooksBootstrap } from "../../src/processors/quickbooksBootstrap";
import { bootstrapMessage } from "../../src/routes/qboIntegration";

const config = {
  INTEGRATIONS_MASTER_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  INTEGRATIONS_KEY_ID: "v1",
  QBO_CLIENT_ID: "client",
  QBO_CLIENT_SECRET: "secret",
  QBO_OAUTH_STATE_SECRET: "state",
};

describe("QuickBooks bootstrap", () => {
  it("paginates all entity types and is idempotent", async () => {
    const queue = { send: vi.fn().mockResolvedValue(undefined) } as unknown as Queue;
    const context = await createTestEnv({ env: { ...config, EVENT_QUEUE: queue } });
    if (!context) return;
    const { env, db, mf } = context;
    await seedIntegration(env, db);
    await db
      .prepare(
        `INSERT INTO qbo_bootstrap_jobs (id,workspace_id,integration_id,entity_type,start_position,imported_count,status,started_at,updated_at) VALUES ('job','default','q1','customer',1,0,'queued',datetime('now'),datetime('now'))`
      )
      .run();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const query = decodeURIComponent(new URL(String(url)).searchParams.get("query") || "");
        let payload: unknown = { QueryResponse: {} };
        if (query.includes("from Customer") && query.includes("startposition 1"))
          payload = {
            QueryResponse: {
              Customer: Array.from({ length: 100 }, (_, i) => ({
                Id: `c${i}`,
                DisplayName: `Customer ${i}`,
                MetaData: { LastUpdatedTime: "2026-01-01" },
              })),
            },
          };
        else if (query.includes("from Estimate"))
          payload = {
            QueryResponse: {
              Estimate: [
                {
                  Id: "e1",
                  DocNumber: "E1",
                  CustomerRef: { value: "c0" },
                  MetaData: { LastUpdatedTime: "2026-01-01" },
                },
              ],
            },
          };
        else if (query.includes("from Invoice"))
          payload = {
            QueryResponse: {
              Invoice: [
                {
                  Id: "i1",
                  DocNumber: "I1",
                  CustomerRef: { value: "c0" },
                  MetaData: { LastUpdatedTime: "2026-01-01" },
                },
              ],
            },
          };
        return new Response(JSON.stringify(payload), { status: 200 });
      })
    );
    for (let i = 0; i < 5; i++) await processQuickbooksBootstrap(env, bootstrapMessage("job"));
    const job = await db
      .prepare(`SELECT status,imported_count FROM qbo_bootstrap_jobs WHERE id='job'`)
      .first<{ status: string; imported_count: number }>();
    expect(job).toEqual({ status: "complete", imported_count: 102 });
    expect(
      (await db.prepare(`SELECT COUNT(*) count FROM customers`).first<{ count: number }>())?.count
    ).toBe(100);
    await processQuickbooksBootstrap(env, bootstrapMessage("job"));
    expect(
      (await db.prepare(`SELECT COUNT(*) count FROM external_entities`).first<{ count: number }>())
        ?.count
    ).toBe(102);
    await mf.dispose();
  });

  it("persists a failure at its page and can resume", async () => {
    const queue = { send: vi.fn().mockResolvedValue(undefined) } as unknown as Queue;
    const context = await createTestEnv({ env: { ...config, EVENT_QUEUE: queue } });
    if (!context) return;
    const { env, db, mf } = context;
    await seedIntegration(env, db);
    await db
      .prepare(
        `INSERT INTO qbo_bootstrap_jobs (id,workspace_id,integration_id,entity_type,start_position,imported_count,status,started_at,updated_at) VALUES ('resume','default','q1','invoice',201,14,'queued',datetime('now'),datetime('now'))`
      )
      .run();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 }))
    );
    await expect(processQuickbooksBootstrap(env, bootstrapMessage("resume"))).rejects.toThrow(
      "quickbooks_http_500"
    );
    expect(
      await db
        .prepare(
          `SELECT status,entity_type,start_position,imported_count FROM qbo_bootstrap_jobs WHERE id='resume'`
        )
        .first()
    ).toMatchObject({
      status: "failed",
      entity_type: "invoice",
      start_position: 201,
      imported_count: 14,
    });
    await mf.dispose();
  });
});

async function seedIntegration(env: any, db: any) {
  const encrypted = await encryptSecrets(
    env,
    JSON.stringify({
      accessToken: "access",
      refreshToken: "refresh",
      accessTokenExpiresAt: "2999-01-01",
    })
  );
  await db
    .prepare(
      `INSERT INTO integrations (id,workspace_id,provider,environment,external_account_id,secrets_key_id,secrets_ciphertext,is_active,created_at,updated_at) VALUES ('q1','default','qbo','production','realm',?,?,1,datetime('now'),datetime('now'))`
    )
    .bind(encrypted.keyId, encrypted.ciphertext)
    .run();
}
