import { sha256Hex } from "../lib/hash";
import { stableStringify } from "../lib/jsonStable";
import type { Env } from "../lib/types";
import { decryptSecrets } from "../lib/crypto/secrets";

export class BillingError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}
export function check(condition: unknown, code: string, status = 400): asserts condition {
  if (!condition) throw new BillingError(code, status);
}
export function text(value: unknown, label: string, max = 500): string {
  check(typeof value === "string" && !!value.trim() && value.length <= max, `invalid_${label}`);
  return value.trim();
}
export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}
export const now = () => new Date().toISOString();
export const hashObject = (value: unknown) => sha256Hex(stableStringify(value));
export async function readText(request: Request, maximum = 350000): Promise<string> {
  check(Number(request.headers.get("Content-Length") ?? 0) <= maximum, "request_too_large", 413);
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      check(size <= maximum, "request_too_large", 413);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(data);
}
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = await readText(request);
  try {
    const value = JSON.parse(body);
    check(value && typeof value === "object" && !Array.isArray(value), "invalid_json");
    return value;
  } catch {
    throw new BillingError("invalid_json");
  }
}

export type BillingSecrets = {
  timestampUrl?: string;
  timestampTrustPem?: string;
  stripeKey?: string;
  stripeWebhookSecret?: string;
  signingKeyPkcs8?: string;
  signingCertificatePem?: string;
};
export type Settings = {
  workspace_id: string;
  issuer_name: string;
  reply_email: string;
  disclosure: string;
  environment: "sandbox" | "production";
  secrets_key_id: string;
  secrets_ciphertext: string;
};
export async function settings(env: Env, workspace: string) {
  const row = await env.DB.prepare("SELECT * FROM native_billing_settings WHERE workspace_id=?")
    .bind(workspace)
    .first<Settings>();
  check(row, "billing_not_configured", 503);
  const secrets = JSON.parse(
    await decryptSecrets(env, row.secrets_key_id, row.secrets_ciphertext)
  ) as BillingSecrets;
  return { ...row, secrets };
}
export async function audit(
  env: Env,
  workspace: string,
  revision: string | null,
  action: string,
  actor: string,
  details: unknown = {}
) {
  await env.DB.prepare("INSERT INTO native_billing_audit VALUES(?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), workspace, revision, action, actor, now(), JSON.stringify(details))
    .run();
}
export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  body: string,
  idempotencyKey: string
) {
  check(env.RESEND_API_KEY, "email_not_configured", 503);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from: env.DAILY_SUMMARY_FROM_EMAIL ?? "notifications@fromtrees.studio",
      to: [to],
      subject,
      text: body,
    }),
  });
  check(response.ok, "email_unavailable", 503);
}
export function publicOrigin(env: Env) {
  const url = new URL(env.BILLING_PUBLIC_ORIGIN ?? "https://api.from-trees.com");
  check(
    url.protocol === "https:" || ["localhost", "127.0.0.1"].includes(url.hostname),
    "invalid_billing_origin",
    503
  );
  return url.origin;
}
