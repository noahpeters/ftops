export type EmailWorkerEnv = {
  API: { fetch: typeof fetch };
  EMAIL_INGESTION_SECRET: string;
};

const MAX_RAW_BYTES = 25 * 1024 * 1024;

export default {
  async fetch(): Promise<Response> {
    return new Response(JSON.stringify({ ok: true, service: "ftops-email" }), {
      headers: { "content-type": "application/json" },
    });
  },

  async email(
    message: ForwardableEmailMessage,
    env: EmailWorkerEnv,
  ): Promise<void> {
    if (message.rawSize <= 0 || message.rawSize > MAX_RAW_BYTES) {
      message.setReject("Message is too large for FTOPS ingestion");
      return;
    }
    if (!env.EMAIL_INGESTION_SECRET)
      throw new Error("email_ingestion_secret_missing");
    const raw = await new Response(message.raw).arrayBuffer();
    const timestamp = String(Date.now());
    const envelopeFrom = normalizeEmail(message.from);
    const envelopeTo = normalizeEmail(message.to);
    const digest = await sha256Hex(raw);
    const signature = await sign(
      env.EMAIL_INGESTION_SECRET,
      `${timestamp}\n${envelopeFrom}\n${envelopeTo}\n${digest}`,
    );
    const response = await env.API.fetch(
      "http://internal/customer-emails/inbound",
      {
        method: "POST",
        headers: {
          "content-type": "message/rfc822",
          "x-ftops-email-timestamp": timestamp,
          "x-ftops-email-signature": signature,
          "x-ftops-envelope-from": envelopeFrom,
          "x-ftops-envelope-to": envelopeTo,
        },
        body: raw,
      },
    );
    if (response.status === 403) {
      const detail = await response.text();
      console.warn(
        JSON.stringify({
          event: "customer_email_rejected",
          envelopeFrom,
          envelopeTo,
          detail,
        }),
      );
      message.setReject("This sender or FTOPS mailbox is not authorized");
      return;
    }
    if (!response.ok) {
      throw new Error(`email_ingestion_api_failed:${response.status}`);
    }
  },
} satisfies ExportedHandler<EmailWorkerEnv>;

function normalizeEmail(value: string) {
  return value.trim().toLowerCase().replace(/^<|>$/g, "");
}
async function sha256Hex(raw: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return bytesToHex(new Uint8Array(digest));
}
async function sign(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
    ),
  );
}
function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
