const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

export async function verifyQuoSignature(
  bodyText: string,
  signatureHeader: string | null,
  base64SigningSecret: string,
  nowMs = Date.now(),
) {
  if (!signatureHeader) return { ok: false, error: "missing_signature" };
  const candidates = signatureHeader.split(",").map((value) => value.trim());
  for (const candidate of candidates) {
    const [scheme, version, timestamp, provided] = candidate.split(";");
    if (scheme !== "hmac" || version !== "1" || !timestamp || !provided)
      continue;
    const timestampMs = Number(timestamp);
    if (!Number.isFinite(timestampMs)) continue;
    if (Math.abs(nowMs - timestampMs) > MAX_TIMESTAMP_SKEW_MS) {
      return { ok: false, error: "signature_timestamp_out_of_range" };
    }
    let key: Uint8Array;
    try {
      key = Uint8Array.from(atob(base64SigningSecret.trim()), (char) =>
        char.charCodeAt(0),
      );
    } catch {
      return { ok: false, error: "invalid_signing_secret" };
    }
    const compactBody = compactJson(bodyText);
    if (compactBody === null) return { ok: false, error: "invalid_json_body" };
    const keyBuffer = key.buffer.slice(
      key.byteOffset,
      key.byteOffset + key.byteLength,
    ) as ArrayBuffer;
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBuffer,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        cryptoKey,
        new TextEncoder().encode(`${timestamp}.${compactBody}`),
      ),
    );
    const expected = btoa(String.fromCharCode(...digest));
    if (constantTimeEqual(expected, provided)) return { ok: true, error: null };
  }
  return { ok: false, error: "signature_mismatch" };
}

function compactJson(input: string) {
  try {
    return JSON.stringify(JSON.parse(input));
  } catch {
    return null;
  }
}

function constantTimeEqual(left: string, right: string) {
  const max = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < max; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}
