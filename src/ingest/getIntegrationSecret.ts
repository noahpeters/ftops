import type { Env } from "../lib/types";
import { decryptSecrets } from "../lib/crypto/secrets";

type IntegrationRow = {
  secrets_key_id: string;
  secrets_ciphertext: string;
};

export async function getShopifyWebhookSecret(
  env: Env,
  integration: IntegrationRow
) {
  const decrypted = await decryptSecrets(
    env,
    integration.secrets_key_id,
    integration.secrets_ciphertext
  );
  const parsed = JSON.parse(decrypted) as { webhookSecret?: string };
  if (!parsed.webhookSecret) {
    throw new Error("missing_webhook_secret");
  }
  return parsed.webhookSecret;
}

export async function getQboVerifierToken(
  env: Env,
  integration: IntegrationRow
) {
  const decrypted = await decryptSecrets(
    env,
    integration.secrets_key_id,
    integration.secrets_ciphertext
  );
  const parsed = JSON.parse(decrypted) as { webhookVerifierToken?: string };
  if (!parsed.webhookVerifierToken) {
    throw new Error("missing_webhook_verifier_token");
  }
  return parsed.webhookVerifierToken;
}
