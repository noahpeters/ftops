import { computeHmacSha256Base64, timingSafeEqual } from "./crypto";

export async function verifyShopifyHmac(
  rawBody: ArrayBuffer,
  headerValue: string | null,
  secret: string,
) {
  if (!headerValue) {
    return { ok: false, error: "missing signature header" };
  }
  if (!secret) {
    return { ok: false, error: "missing secret" };
  }

  const computed = await computeHmacSha256Base64(secret, rawBody);
  const ok = timingSafeEqual(computed, headerValue.trim());
  return ok ? { ok: true } : { ok: false, error: "signature mismatch" };
}
