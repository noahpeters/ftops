import { describe, expect, it } from "vitest";
import { verifyQuoSignature } from "../../src/ingest/verifyQuo";

describe("verifyQuoSignature", () => {
  it("verifies a current signature and rejects stale timestamps", async () => {
    const now = 1_800_000_000_000;
    const secret = btoa("test-signing-key");
    const body = '{\n  "id": "EV1", "type": "call.completed"\n}';
    const compact = JSON.stringify(JSON.parse(body));
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("test-signing-key"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`${now}.${compact}`),
      ),
    );
    const signature = `hmac;1;${now};${btoa(String.fromCharCode(...digest))}`;

    await expect(
      verifyQuoSignature(body, signature, secret, now),
    ).resolves.toEqual({ ok: true, error: null });
    await expect(
      verifyQuoSignature(body, signature, secret, now + 300_001),
    ).resolves.toEqual({
      ok: false,
      error: "signature_timestamp_out_of_range",
    });
  });
});
