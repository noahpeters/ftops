export type WebhookSource = "quickbooks" | "shopify";

export type WebhookEnvelope = {
  id: string;
  source: WebhookSource;
  workspaceId?: string | null;
  realmId?: string | null;
  externalAccountId?: string | null;
  integrationId?: string | null;
  environment?: string | null;
  receivedAt: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  bodyBase64?: boolean;
  contentType?: string | null;
  signature?: string | null;
  signatureVerified: boolean;
  verifyError?: string | null;
};

export async function buildWebhookEnvelopeId(args: {
  source: WebhookSource;
  parsedBody?: unknown;
  body: string;
  realmId?: string | null;
  path: string;
  method: string;
}) {
  if (args.source === "quickbooks") {
    const eventId = extractQuickBooksEventId(args.parsedBody);
    if (eventId) {
      return eventId;
    }
  }

  const stable = [
    args.source,
    args.realmId ?? "",
    args.method.toUpperCase(),
    args.path,
    args.body,
  ].join("|");
  return sha256Hex(stable);
}

export function extractQuickBooksEventId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const notifications = record.eventNotifications;
  if (!Array.isArray(notifications)) {
    return null;
  }
  for (const notification of notifications) {
    if (!notification || typeof notification !== "object") {
      continue;
    }
    const eventId = (notification as Record<string, unknown>).eventId;
    if (typeof eventId === "string" && eventId.trim().length > 0) {
      return eventId.trim();
    }
  }
  return null;
}

async function sha256Hex(input: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("crypto_subtle_unavailable");
  }
  const data = new TextEncoder().encode(input);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
  return bufferToHex(new Uint8Array(hashBuffer));
}

function bufferToHex(bytes: Uint8Array) {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
