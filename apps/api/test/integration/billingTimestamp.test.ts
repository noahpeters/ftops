import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import * as asn1 from "asn1js";
import {
  TimeStampReq,
  TimeStampResp,
  PKIStatusInfo,
  TSTInfo,
  SignedData,
  EncapsulatedContentInfo,
  SignerInfo,
  IssuerAndSerialNumber,
  ContentInfo,
} from "pkijs";
import { signedPdf, signingIdentity } from "../../src/billing/documents";
import { trustedTimestamp } from "../../src/billing/timestamps";
const key = readFileSync("test/fixtures/billing/test-key.pem", "utf8"),
  certificate = readFileSync("test/fixtures/billing/test-certificate.pem", "utf8");
const rootCertificate = readFileSync("test/fixtures/billing/test-tsa-root.pem", "utf8");
const tsaKey = readFileSync("test/fixtures/billing/test-tsa-key.pem", "utf8"),
  tsaCertificate = readFileSync("test/fixtures/billing/test-tsa-certificate.pem", "utf8");
it("embeds a verified RFC3161 timestamp and rejects an authority outside the configured trust chain", async () => {
  const identity = await signingIdentity(tsaKey, tsaCertificate);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: RequestInit) => {
      const request = new TimeStampReq({ schema: asn1.fromBER(init!.body as ArrayBuffer).result });
      const info = new TSTInfo({
        version: 1,
        policy: "1.2.3.4.1",
        messageImprint: request.messageImprint,
        serialNumber: new asn1.Integer({ value: 1 }),
        genTime: new Date(),
        nonce: request.nonce,
      });
      const signed = new SignedData({
        version: 3,
        encapContentInfo: new EncapsulatedContentInfo({
          eContentType: "1.2.840.113549.1.9.16.1.4",
          eContent: new asn1.OctetString({ valueHex: info.toSchema().toBER(false) }),
        }),
        signerInfos: [
          new SignerInfo({
            version: 1,
            sid: new IssuerAndSerialNumber({
              issuer: identity.certificate.issuer,
              serialNumber: identity.certificate.serialNumber,
            }),
          }),
        ],
        certificates: identity.certificates,
      });
      await signed.sign(identity.key, 0, "SHA-256");
      return new Response(
        new TimeStampResp({
          status: new PKIStatusInfo({ status: 0 }),
          timeStampToken: new ContentInfo({
            contentType: "1.2.840.113549.1.7.2",
            content: signed.toSchema(true),
          }),
        })
          .toSchema()
          .toBER(false),
        { headers: { "Content-Type": "application/timestamp-reply" } }
      );
    })
  );
  try {
    const result = await signedPdf(
      {
        title: "Timestamped estimate",
        subtitle: "Synthetic test only",
        paragraphs: ["Preserve café, curly quotes “exactly”, and dimensions 96 × 42."],
      },
      key,
      certificate,
      "Synthetic issuer",
      "owner@example.test",
      { url: "https://tsa.example.test", trustPem: rootCertificate }
    );
    expect(result.profile).toBe("CMS-SHA256-RFC3161");
    expect(result.bytes.toString()).toContain("/ByteRange");
    await expect(
      trustedTimestamp(new Uint8Array([1, 2, 3]).buffer, {
        url: "https://tsa.example.test",
        trustPem: tsaCertificate,
      })
    ).rejects.toThrow();
  } finally {
    vi.unstubAllGlobals();
  }
});
