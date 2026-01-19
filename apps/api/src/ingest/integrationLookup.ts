import type { Env } from "../lib/types";

export async function findIntegration(
  env: Env,
  args: {
    provider: "shopify" | "qbo";
    environment: "sandbox" | "production";
    externalAccountId: string;
  }
) {
  const { provider, environment, externalAccountId } = args;
  if (!externalAccountId) {
    return null;
  }
  return await env.DB.prepare(
    `SELECT id, workspace_id, provider, environment, external_account_id,
            secrets_key_id, secrets_ciphertext, is_active
     FROM integrations
     WHERE provider = ? AND environment = ? AND external_account_id = ? AND is_active = 1
     LIMIT 1`
  )
    .bind(provider, environment, externalAccountId)
    .first<{
      id: string;
      workspace_id: string;
      provider: string;
      environment: string;
      external_account_id: string;
      secrets_key_id: string;
      secrets_ciphertext: string;
      is_active: number;
    }>();
}
