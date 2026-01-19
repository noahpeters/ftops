import { computeHmacSha256Base64, timingSafeEqual } from "./crypto";

export async function verifyQboSignature(
  rawBody: ArrayBuffer,
  headerValue: string | null,
  verifierToken: string,
) {
  if (!headerValue) {
    return { ok: false, error: "missing signature header" };
  }
  if (!verifierToken) {
    return { ok: false, error: "missing verifier token" };
  }

  const computed = await computeHmacSha256Base64(verifierToken, rawBody);
  const ok = timingSafeEqual(computed, headerValue.trim());
  return ok ? { ok: true } : { ok: false, error: "signature mismatch" };
}
