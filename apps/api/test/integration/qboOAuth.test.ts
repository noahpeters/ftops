import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutionContext, Queue } from "@cloudflare/workers-types";
import { createTestEnv } from "../helpers/miniflare";
import { route } from "../../src/lib/router";
import { consumeOAuthState, createOAuthState } from "../../src/services/quickbooksOAuth";
import { decryptSecrets, encryptSecrets } from "../../src/lib/crypto/secrets";
import { ensureAccessToken, getQboIntegration, queryQboPage } from "../../src/services/quickbooks";

const masterKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const config = {
  INTEGRATIONS_MASTER_KEY: masterKey,
  INTEGRATIONS_KEY_ID: "v1",
  QBO_CLIENT_ID: "client",
  QBO_CLIENT_SECRET: "secret",
  QBO_OAUTH_STATE_SECRET: "state-secret",
};

describe("QuickBooks OAuth", () => {
  afterEach(() => vi.restoreAllMocks());
  it("creates the accounting-only authorization URL and rejects unauthorized workspaces", async () => {
    const context = await createTestEnv({ env: config });
    if (!context) return;
    const { env, db, mf } = context;
    const response = await request(
      env,
      "/integrations/qbo/connect?workspaceId=default&environment=production"
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://appcenter.intuit.com/connect/oauth2");
    expect(location.searchParams.get("scope")).toBe("com.intuit.quickbooks.accounting");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://api.from-trees.com/integrations/qbo/callback"
    );
    await db
      .prepare(
        `INSERT INTO users (workspace_id,user_id,name,email,workspace_admin,system_admin) VALUES ('default','u1','User','user@example.com',0,0)`
      )
      .run();
    const denied = await request(env, "/integrations/qbo/connect?workspaceId=ws_unknown", {
      headers: { "X-Debug-User-Email": "user@example.com" },
    });
    expect(denied.status).toBe(403);
    await mf.dispose();
  });

  it("detects state tampering, expiration, and replay", async () => {
    const context = await createTestEnv({ env: config });
    if (!context) return;
    const { env, db, mf } = context;
    const state = await createOAuthState(env, {
      workspaceId: "default",
      requestedBy: "unknown@local",
      environment: "production",
    });
    await expect(consumeOAuthState(env, `${state}x`)).rejects.toThrow("oauth_state_invalid");
    await consumeOAuthState(env, state);
    await expect(consumeOAuthState(env, state)).rejects.toThrow("oauth_state_replayed");
    const expired = await createOAuthState(env, {
      workspaceId: "default",
      requestedBy: "unknown@local",
      environment: "production",
    });
    await db
      .prepare(`UPDATE qbo_oauth_states SET expires_at='2000-01-01' WHERE consumed_at IS NULL`)
      .run();
    await expect(consumeOAuthState(env, expired)).rejects.toThrow("oauth_state_expired");
    await mf.dispose();
  });

  it("exchanges a callback once, creates an integration, and reconnects it", async () => {
    const context = await createTestEnv({ env: config });
    if (!context) return;
    const { env, db, mf } = context;
    let token = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              access_token: `access-${++token}`,
              refresh_token: `refresh-${token}`,
              expires_in: 3600,
              x_refresh_token_expires_in: 7200,
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
      )
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      const connect = await request(
        env,
        "/integrations/qbo/connect?workspaceId=default&environment=production"
      );
      const state = new URL(connect.headers.get("location")!).searchParams.get("state")!;
      const callback = await request(
        env,
        `/integrations/qbo/callback?code=single-use-code&realmId=realm-1&state=${encodeURIComponent(state)}`
      );
      expect(callback.status).toBe(302);
      expect(callback.headers.get("location")).toContain("qbo=connected");
    }
    const rows = await db
      .prepare(
        `SELECT id,token_version,secrets_key_id,secrets_ciphertext FROM integrations WHERE provider='qbo'`
      )
      .all<{
        id: string;
        token_version: number;
        secrets_key_id: string;
        secrets_ciphertext: string;
      }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].token_version).toBe(1);
    const secrets = JSON.parse(
      await decryptSecrets(env, rows.results[0].secrets_key_id, rows.results[0].secrets_ciphertext)
    );
    expect(secrets).toMatchObject({ accessToken: "access-2", refreshToken: "refresh-2" });
    expect(
      JSON.stringify(
        await (await request(env, "/integrations/qbo/status?workspaceId=default")).json()
      )
    ).not.toContain("access-2");
    await mf.dispose();
  });

  it("refreshes and rotates tokens with optimistic concurrent protection", async () => {
    const queue = { send: vi.fn() } as unknown as Queue;
    const context = await createTestEnv({ env: { ...config, EVENT_QUEUE: queue } });
    if (!context) return;
    const { env, db, mf } = context;
    const encrypted = await encryptSecrets(
      env,
      JSON.stringify({
        accessToken: "old",
        refreshToken: "refresh-old",
        accessTokenExpiresAt: "2000-01-01",
      })
    );
    await db
      .prepare(
        `INSERT INTO integrations (id,workspace_id,provider,environment,external_account_id,secrets_key_id,secrets_ciphertext,is_active,created_at,updated_at) VALUES ('q1','default','qbo','production','realm',?,?,1,datetime('now'),datetime('now'))`
      )
      .bind(encrypted.keyId, encrypted.ciphertext)
      .run();
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        return new Response(
          JSON.stringify({
            access_token: `new-${calls}`,
            refresh_token: `rotated-${calls}`,
            expires_in: 3600,
            x_refresh_token_expires_in: 7200,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );
    const integration = (await getQboIntegration(env, "q1"))!;
    const results = await Promise.all([
      ensureAccessToken(env, integration, false),
      ensureAccessToken(env, integration, false),
    ]);
    const stored = await db
      .prepare(
        `SELECT token_version,secrets_key_id,secrets_ciphertext FROM integrations WHERE id='q1'`
      )
      .first<{ token_version: number; secrets_key_id: string; secrets_ciphertext: string }>();
    expect(stored?.token_version).toBe(1);
    const final = JSON.parse(
      await decryptSecrets(env, stored!.secrets_key_id, stored!.secrets_ciphertext)
    );
    expect(results.map((x) => x.refreshToken)).toContain(final.refreshToken);
    await mf.dispose();
  });

  it("forces one refresh and retries once after a 401, and marks revoked authorization", async () => {
    const context = await createTestEnv({ env: config });
    if (!context) return;
    const { env, db, mf } = context;
    const encrypted = await encryptSecrets(
      env,
      JSON.stringify({
        accessToken: "valid-looking",
        refreshToken: "refresh",
        accessTokenExpiresAt: "2999-01-01",
      })
    );
    await db
      .prepare(
        `INSERT INTO integrations (id,workspace_id,provider,environment,external_account_id,secrets_key_id,secrets_ciphertext,is_active,created_at,updated_at) VALUES ('q2','default','qbo','production','realm',?,?,1,datetime('now'),datetime('now'))`
      )
      .bind(encrypted.keyId, encrypted.ciphertext)
      .run();
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        calls++;
        if (calls === 1) return new Response("{}", { status: 401 });
        if (String((init as RequestInit).body || "").includes("refresh_token"))
          return new Response(
            JSON.stringify({ access_token: "retry", refresh_token: "rotated", expires_in: 3600 }),
            { status: 200 }
          );
        return new Response(JSON.stringify({ QueryResponse: { Customer: [] } }), { status: 200 });
      })
    );
    const integration = (await getQboIntegration(env, "q2"))!;
    await queryQboPage(env, integration, "customer", 1);
    expect(calls).toBe(3);
    await db
      .prepare(`UPDATE integrations SET secrets_ciphertext=?,token_version=token_version+1`)
      .bind(
        (
          await encryptSecrets(
            env,
            JSON.stringify({
              accessToken: "expired",
              refreshToken: "revoked",
              accessTokenExpiresAt: "2000-01-01",
            })
          )
        ).ciphertext
      )
      .run();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 400 }))
    );
    await expect(ensureAccessToken(env, integration, false)).rejects.toThrow(
      "quickbooks_authorization_revoked"
    );
    expect(
      (await db.prepare(`SELECT connection_status FROM integrations WHERE id='q2'`).first())
        ?.connection_status
    ).toBe("reconnect_required");
    await mf.dispose();
  });
});

function request(env: Parameters<typeof route>[1], path: string, init: RequestInit = {}) {
  return route(new Request(`http://localhost${path}`, init), env, {} as ExecutionContext);
}
