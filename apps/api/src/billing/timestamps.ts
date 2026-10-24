import * as asn1 from "asn1js";
import {
  Certificate,
  AlgorithmIdentifier,
  MessageImprint,
  TimeStampReq,
  TimeStampResp,
  SignedData,
  TSTInfo,
} from "pkijs";
import { Buffer } from "node:buffer";
import { check } from "./common";
export type TimestampOptions = { url: string; trustPem: string };
export async function trustedTimestamp(signature: ArrayBuffer, options: TimestampOptions) {
  const url = new URL(options.url);
  check(url.protocol === "https:" && !url.username && !url.password, "invalid_timestamp_url");
  const certificates = (
    options.trustPem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? []
  ).map(
    (pem) =>
      new Certificate({
        schema: asn1.fromBER(
          Uint8Array.from(
            Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""), "base64")
          ).buffer
        ).result,
      })
  );
  check(certificates.length > 0, "timestamp_trust_certificate_required", 503);
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  nonceBytes[0] = nonceBytes[0] & 0x7f || 1;
  const nonce = new asn1.Integer({ valueHex: nonceBytes.buffer });
  const request = new TimeStampReq({
    version: 1,
    certReq: true,
    nonce,
    messageImprint: new MessageImprint({
      hashAlgorithm: new AlgorithmIdentifier({
        algorithmId: "2.16.840.1.101.3.4.2.1",
        algorithmParams: new asn1.Null(),
      }),
      hashedMessage: new asn1.OctetString({
        valueHex: await crypto.subtle.digest("SHA-256", signature),
      }),
    }),
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/timestamp-query",
      Accept: "application/timestamp-reply",
    },
    body: request.toSchema().toBER(false),
    signal: AbortSignal.timeout(15000),
    redirect: "manual",
  });
  check(response.ok, "timestamp_service_unavailable", 503);
  const raw = await response.arrayBuffer();
  check(raw.byteLength <= 1000000, "timestamp_response_too_large", 503);
  const parsed = new TimeStampResp({ schema: asn1.fromBER(raw).result });
  check([0, 1].includes(parsed.status.status) && parsed.timeStampToken, "timestamp_rejected", 503);
  const signed = new SignedData({ schema: parsed.timeStampToken.content });
  check(signed.encapContentInfo.eContent, "invalid_timestamp_response", 503);
  const info = new TSTInfo({
    schema: asn1.fromBER(signed.encapContentInfo.eContent.getValue()).result,
  });
  check(
    info.nonce?.isEqual(nonce) && Math.abs(info.genTime.getTime() - Date.now()) < 300000,
    "timestamp_nonce_or_time_mismatch",
    503
  );
  const verified = await signed.verify({
    signer: 0,
    data: signature,
    checkChain: true,
    trustedCerts: certificates,
    extendedMode: true,
  });
  check(
    verified.signatureVerified && verified.signerCertificateVerified && verified.signerCertificate,
    "timestamp_verification_failed",
    503
  );
  const usage = verified.signerCertificate.extensions?.find((e) => e.extnID === "2.5.29.37")
    ?.parsedValue as { keyPurposes?: string[] } | undefined;
  check(
    usage?.keyPurposes?.includes("1.3.6.1.5.5.7.3.8"),
    "timestamp_certificate_purpose_invalid",
    503
  );
  return parsed.timeStampToken.toSchema();
}
