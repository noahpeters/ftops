import { decryptSecrets, encryptSecrets } from "../lib/crypto/secrets";
import type { Env } from "../lib/types";
import { nowISO } from "../lib/utils";
import { safeRedirect } from "../lib/security";

export const QBO_REDIRECT_URI = "https://ops.from-trees.com/api/integrations/qbo/callback";
const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const STATE_TTL_MS = 10 * 60 * 1000;
const ALLOWED_INTUIT_REDIRECTS = new Set([AUTHORIZE_URL]);
export const ALLOWED_CALLBACK_REDIRECTS = new Set([
  QBO_REDIRECT_URI,
  "http://localhost:8787/integrations/qbo/callback",
]);

export type QboSecrets = {
  webhookVerifierToken?: string;
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  apiBaseUrl?: string;
  minorVersion?: string;
  realmId?: string;
};

type TokenPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  x_refresh_token_expires_in?: number;
};

export async function createOAuthState(
  env: Env,
  input: { workspaceId: string; requestedBy: string; environment: "sandbox" | "production" }
) {
  requireOAuthConfig(env);
  const nonce = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const signature = await hmac(env.QBO_OAUTH_STATE_SECRET!, nonce);
  const state = `${nonce}.${signature}`;
  const now = new Date();
  await env.DB.prepare(
    `INSERT INTO qbo_oauth_states
     (state_hash, workspace_id, requested_by, environment, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      await sha256(state),
      input.workspaceId,
      input.requestedBy,
      input.environment,
      new Date(now.getTime() + STATE_TTL_MS).toISOString(),
      now.toISOString()
    )
    .run();
  return state;
}

export async function consumeOAuthState(env: Env, state: string) {
  requireOAuthConfig(env);
  const [nonce, signature, extra] = state.split(".");
  if (
    !nonce ||
    !signature ||
    extra ||
    !(await safeEqual(signature, await hmac(env.QBO_OAUTH_STATE_SECRET!, nonce)))
  ) {
    throw new Error("oauth_state_invalid");
  }
  const hash = await sha256(state);
  const row = await env.DB.prepare(
    `SELECT workspace_id, requested_by, environment, expires_at, consumed_at
     FROM qbo_oauth_states WHERE state_hash = ?`
  )
    .bind(hash)
    .first<{
      workspace_id: string;
      requested_by: string;
      environment: "sandbox" | "production";
      expires_at: string;
      consumed_at: string | null;
    }>();
  if (!row) throw new Error("oauth_state_invalid");
  if (row.consumed_at) throw new Error("oauth_state_replayed");
  if (row.expires_at <= nowISO()) throw new Error("oauth_state_expired");
  const consumed = await env.DB.prepare(
    `UPDATE qbo_oauth_states SET consumed_at=? WHERE state_hash=? AND consumed_at IS NULL AND expires_at>?`
  )
    .bind(nowISO(), hash, nowISO())
    .run();
  if (consumed.meta?.changes !== 1) throw new Error("oauth_state_replayed");
  return row;
}

export function buildAuthorizationUrl(env: Env, state: string) {
  requireOAuthConfig(env);
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", env.QBO_CLIENT_ID!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "com.intuit.quickbooks.accounting");
  url.searchParams.set("redirect_uri", getRedirectUri(env));
  url.searchParams.set("state", state);
  return url.toString();
}

export function authorizationRedirect(env: Env, state: string) {
  return safeRedirect(buildAuthorizationUrl(env, state), ALLOWED_INTUIT_REDIRECTS);
}

export async function exchangeAuthorizationCode(env: Env, code: string) {
  return await tokenRequest(
    env,
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: getRedirectUri(env),
    })
  );
}

export async function exchangeRefreshToken(env: Env, refreshToken: string) {
  return await tokenRequest(
    env,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    })
  );
}

export function tokensWithExpiry(payload: TokenPayload, previous: QboSecrets = {}): QboSecrets {
  if (!payload.access_token || !(payload.refresh_token || previous.refreshToken)) {
    throw new Error("quickbooks_token_response_invalid");
  }
  const now = Date.now();
  return {
    ...previous,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || previous.refreshToken,
    accessTokenExpiresAt: new Date(now + Number(payload.expires_in || 3600) * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(
      now + Number(payload.x_refresh_token_expires_in || 8_726_400) * 1000
    ).toISOString(),
  };
}

export async function saveOAuthIntegration(
  env: Env,
  input: {
    workspaceId: string;
    environment: "sandbox" | "production";
    realmId: string;
    tokens: TokenPayload;
  }
) {
  const realmHash = await sha256Hex(input.realmId);
  const existing = await env.DB.prepare(
    `SELECT id, workspace_id, secrets_key_id, secrets_ciphertext FROM integrations
     WHERE provider='qbo' AND environment=? AND (external_account_hash=? OR external_account_id=?)`
  )
    .bind(input.environment, realmHash, input.realmId)
    .first<{
      id: string;
      workspace_id: string;
      secrets_key_id: string;
      secrets_ciphertext: string;
    }>();
  if (existing && existing.workspace_id !== input.workspaceId)
    throw new Error("quickbooks_realm_already_connected");
  let previous: QboSecrets = {};
  if (existing)
    previous = JSON.parse(
      await decryptSecrets(env, existing.secrets_key_id, existing.secrets_ciphertext)
    ) as QboSecrets;
  const encrypted = await encryptSecrets(
    env,
    JSON.stringify({ ...tokensWithExpiry(input.tokens, previous), realmId: input.realmId })
  );
  const now = nowISO();
  const id = existing?.id || crypto.randomUUID();
  if (existing)
    await env.DB.prepare(
      `UPDATE integrations SET external_account_id=?,external_account_hash=?,secrets_key_id=?,secrets_ciphertext=?,is_active=1,connection_status='connected',
     connection_error=NULL,token_version=token_version+1,updated_at=? WHERE id=?`
    )
      .bind(
        `qbo_${realmHash.slice(0, 16)}`,
        realmHash,
        encrypted.keyId,
        encrypted.ciphertext,
        now,
        id
      )
      .run();
  else
    await env.DB.prepare(
      `INSERT INTO integrations (id,workspace_id,provider,environment,external_account_id,external_account_hash,display_name,
     secrets_key_id,secrets_ciphertext,is_active,connection_status,created_at,updated_at)
     VALUES (?,?,'qbo',?,?,?,?, ?,?,1,'connected',?,?)`
    )
      .bind(
        id,
        input.workspaceId,
        input.environment,
        `qbo_${realmHash.slice(0, 16)}`,
        realmHash,
        "QuickBooks Online",
        encrypted.keyId,
        encrypted.ciphertext,
        now,
        now
      )
      .run();
  return id;
}

async function tokenRequest(env: Env, body: URLSearchParams): Promise<TokenPayload> {
  requireOAuthConfig(env);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env.QBO_CLIENT_ID}:${env.QBO_CLIENT_SECRET}`)}`,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = (await response.json().catch(() => ({}))) as TokenPayload;
  if (!response.ok) {
    const error = Object.assign(
      new Error(
        response.status === 400 || response.status === 401
          ? "quickbooks_authorization_revoked"
          : `quickbooks_token_http_${response.status}`
      ),
      { status: response.status }
    );
    throw error;
  }
  return payload;
}

function requireOAuthConfig(env: Env) {
  if (!env.QBO_CLIENT_ID || !env.QBO_CLIENT_SECRET || !env.QBO_OAUTH_STATE_SECRET)
    throw new Error("quickbooks_oauth_not_configured");
}
function getRedirectUri(env: Env) {
  const value = env.QBO_REDIRECT_URI || QBO_REDIRECT_URI;
  if (!ALLOWED_CALLBACK_REDIRECTS.has(value)) throw new Error("redirect_not_allowed");
  return value;
}
async function sha256(value: string) {
  return base64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))
  );
}
export async function sha256Hex(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  );
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return base64Url(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)))
  );
}
function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
