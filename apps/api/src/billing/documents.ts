import { trustedTimestamp, type TimestampOptions } from "./timestamps";
import fontkit from "@pdf-lib/fontkit";
import { BILLING_FONT_BASE64 } from "../assets/billing/font";
import { Buffer } from "node:buffer";
import { PDFDocument, rgb } from "pdf-lib";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import { SignPdf, Signer } from "@signpdf/signpdf";
import * as asn1 from "asn1js";
import {
  Certificate,
  EncapsulatedContentInfo,
  ContentInfo,
  SignedData,
  SignerInfo,
  IssuerAndSerialNumber,
  SignedAndUnsignedAttributes,
  Attribute,
  CryptoEngine,
  setEngine,
} from "pkijs";
import type { Env } from "../lib/types";
import { check, settings, now } from "./common";

setEngine("webcrypto", new CryptoEngine({ name: "webcrypto", crypto: globalThis.crypto }));
const arrayBuffer = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer;
const pemBytes = (pem: string) =>
  Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""), "base64");

export async function signingIdentity(keyPem: string, certificatePem: string) {
  const matches =
    certificatePem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  check(matches.length > 0 && matches.length <= 8, "invalid_signing_certificate");
  const certificates = matches.map((pem) => {
    const decoded = asn1.fromBER(arrayBuffer(pemBytes(pem)));
    check(decoded.offset !== -1, "invalid_signing_certificate");
    return new Certificate({ schema: decoded.result });
  });
  const certificate = certificates[0];
  check(
    certificate.notBefore.value.getTime() <= Date.now() &&
      certificate.notAfter.value.getTime() > Date.now(),
    "signing_certificate_expired_or_not_yet_valid",
    503
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    arrayBuffer(pemBytes(keyPem)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const publicKey = await crypto.subtle.importKey(
    "spki",
    certificate.subjectPublicKeyInfo.toSchema().toBER(false),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const probe = crypto.getRandomValues(new Uint8Array(32));
  check(
    await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, probe),
      probe
    ),
    "signing_key_certificate_mismatch"
  );
  const fingerprint = Buffer.from(
    await crypto.subtle.digest("SHA-256", certificate.toSchema().toBER(false))
  ).toString("hex");
  return { key, certificate, certificates, fingerprint };
}

class CertificateSigner extends Signer {
  constructor(
    private identity: Awaited<ReturnType<typeof signingIdentity>>,
    private timestamp?: TimestampOptions
  ) {
    super();
  }
  async sign(pdf: Buffer, signingTime = new Date()): Promise<Buffer> {
    const data = arrayBuffer(pdf);
    const certificate = this.identity.certificate;
    const signed = new SignedData({
      version: 1,
      certificates: this.identity.certificates,
      encapContentInfo: new EncapsulatedContentInfo({ eContentType: "1.2.840.113549.1.7.1" }),
      signerInfos: [
        new SignerInfo({
          version: 1,
          sid: new IssuerAndSerialNumber({
            issuer: certificate.issuer,
            serialNumber: certificate.serialNumber,
          }),
          signedAttrs: new SignedAndUnsignedAttributes({
            type: 0,
            attributes: [
              new Attribute({
                type: "1.2.840.113549.1.9.3",
                values: [new asn1.ObjectIdentifier({ value: "1.2.840.113549.1.7.1" })],
              }),
              new Attribute({
                type: "1.2.840.113549.1.9.5",
                values: [new asn1.UTCTime({ valueDate: signingTime })],
              }),
              new Attribute({
                type: "1.2.840.113549.1.9.4",
                values: [
                  new asn1.OctetString({ valueHex: await crypto.subtle.digest("SHA-256", data) }),
                ],
              }),
            ],
          }),
        }),
      ],
    });
    await signed.sign(this.identity.key, 0, "SHA-256", data);
    if (this.timestamp) {
      const token = await trustedTimestamp(
        signed.signerInfos[0].signature.getValue(),
        this.timestamp
      );
      signed.signerInfos[0].unsignedAttrs = new SignedAndUnsignedAttributes({
        type: 1,
        attributes: [new Attribute({ type: "1.2.840.113549.1.9.16.2.14", values: [token] })],
      });
    }
    const encoded = new ContentInfo({
      contentType: "1.2.840.113549.1.7.2",
      content: signed.toSchema(true),
    })
      .toSchema()
      .toBER(false);
    const decoded = new ContentInfo({ schema: asn1.fromBER(encoded).result });
    const verified = new SignedData({ schema: decoded.content });
    check(
      await verified.verify({ signer: 0, data, checkChain: false }),
      "pdf_signature_verification_failed",
      503
    );
    return Buffer.from(encoded);
  }
}

export type PdfContent = {
  issuer?: { name: string; replyEmail: string };
  title: string;
  subtitle: string;
  paragraphs: string[];
  evidenceParagraphs?: string[];
  attachments?: Array<{ filename: string; content: string; mimeType: string }>;
  rows?: Array<[string, string]>;
};
export async function signedPdf(
  content: PdfContent,
  key: string,
  certificate: string,
  issuer: string,
  contact: string,
  timestamp?: TimestampOptions
) {
  const identity = await signingIdentity(key, certificate);
  const pdf = await PDFDocument.create();
  pdf.setTitle(content.title);
  pdf.setAuthor(issuer);
  pdf.setProducer("FTOPS");
  pdf.setCreator("FTOPS native billing");
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(Buffer.from(BILLING_FONT_BASE64, "base64"), { subset: true });
  const bold = font;
  const available = new Set(font.getCharacterSet());
  const allText = [
    issuer,
    content.title,
    content.subtitle,
    ...content.paragraphs,
    ...(content.evidenceParagraphs ?? []),
    ...(content.rows ?? []).flat(),
  ].join("\n");
  check(
    Array.from(allText).every((c) => c === "\n" || c === "\r" || available.has(c.codePointAt(0)!)),
    "pdf_font_unsupported_character"
  );
  let page = pdf.addPage([612, 792]);
  let y = 735;
  const newPage = () => {
    page = pdf.addPage([612, 792]);
    y = 735;
  };
  const write = (value: string, size = 10, strong = false) => {
    const useFont = strong ? bold : font;
    for (const paragraph of value.replace(/\r\n?/g, "\n").split("\n")) {
      let current = "";
      for (const word of paragraph.split(" ")) {
        // Break long identifiers without overflowing the page.
        for (const chunk of word.match(/.{1,65}/g) ?? [""]) {
          if (useFont.widthOfTextAtSize(`${current} ${chunk}`, size) > 500 && current) {
            if (y < 65) newPage();
            page.drawText(current, { x: 54, y, size, font: useFont, color: rgb(0.12, 0.16, 0.15) });
            y -= size + 5;
            current = chunk;
          } else current += (current ? " " : "") + chunk;
        }
      }
      if (y < 65) newPage();
      if (current)
        page.drawText(current, { x: 54, y, size, font: useFont, color: rgb(0.12, 0.16, 0.15) });
      y -= size + 7;
    }
  };
  write(issuer.toUpperCase(), 11, true);
  y -= 14;
  write(content.title, 22, true);
  write(content.subtitle, 10);
  y -= 12;
  for (const [label, value] of content.rows ?? []) {
    write(label, 10, true);
    write(value);
    y -= 4;
  }
  for (const paragraph of content.paragraphs) {
    write(paragraph);
    y -= 8;
  }
  if (content.evidenceParagraphs?.length) {
    if (y < 250) newPage();
    write("Electronic signature record", 12, true);
    y -= 6;
    for (const paragraph of content.evidenceParagraphs) {
      write(paragraph);
      y -= 8;
    }
  }
  for (const attachment of content.attachments ?? []) {
    await pdf.attach(new TextEncoder().encode(attachment.content), attachment.filename, {
      mimeType: attachment.mimeType,
      description: "Exact customer-facing document source covered by the PDF signature",
    });
  }
  write(
    "Digitally signed by the issuer. Customer acceptance, when applicable, is recorded separately.",
    8
  );
  const pages = pdf.getPages();
  pages.forEach((p, index) =>
    p.drawText(`FTOPS | ${index + 1} / ${pages.length}`, {
      x: 54,
      y: 32,
      font,
      size: 8,
      color: rgb(0.4, 0.4, 0.4),
    })
  );
  pdflibAddPlaceholder({
    pdfDoc: pdf,
    reason: "Document issuance and integrity",
    contactInfo: contact,
    name: issuer,
    location: "United States",
    signatureLength: 16384,
    subFilter: "adbe.pkcs7.detached",
    widgetRect: [0, 0, 0, 0],
  });
  const result = await new SignPdf().sign(
    Buffer.from(await pdf.save({ useObjectStreams: false })),
    new CertificateSigner(identity, timestamp)
  );
  return {
    bytes: result,
    fingerprint: identity.fingerprint,
    profile: timestamp ? "CMS-SHA256-RFC3161" : "CMS-SHA256-detached",
  };
}

export async function document(
  env: Env,
  workspace: string,
  sourceKey: string,
  kind: string,
  revisionId: string | null,
  termsId: string | null,
  content: PdfContent
) {
  const existing = await env.DB.prepare(
    "SELECT id FROM native_documents WHERE workspace_id=? AND source_key=?"
  )
    .bind(workspace, sourceKey)
    .first<{ id: string }>();
  if (existing) return existing.id;
  check(env.R2_BILLING_DOCUMENTS_BUCKET, "document_storage_not_configured", 503);
  const config = await settings(env, workspace);
  check(
    config.secrets.signingKeyPkcs8 && config.secrets.signingCertificatePem,
    "pdf_signing_not_configured",
    503
  );
  const result = await signedPdf(
    content,
    config.secrets.signingKeyPkcs8,
    config.secrets.signingCertificatePem,
    content.issuer?.name ?? config.issuer_name,
    content.issuer?.replyEmail ?? config.reply_email,
    config.secrets.timestampUrl && config.secrets.timestampTrustPem
      ? { url: config.secrets.timestampUrl, trustPem: config.secrets.timestampTrustPem }
      : undefined
  );
  const digest = Buffer.from(
    await crypto.subtle.digest("SHA-256", arrayBuffer(result.bytes))
  ).toString("hex");
  const id = crypto.randomUUID();
  const objectKey = `${workspace}/${id}/${digest}.pdf`;
  await env.R2_BILLING_DOCUMENTS_BUCKET.put(objectKey, Uint8Array.from(result.bytes).buffer, {
    httpMetadata: { contentType: "application/pdf" },
  });
  await env.DB.prepare("INSERT OR IGNORE INTO native_documents VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .bind(
      id,
      workspace,
      revisionId,
      termsId,
      kind,
      sourceKey,
      objectKey,
      digest,
      result.fingerprint,
      result.profile,
      now()
    )
    .run();
  const saved = await env.DB.prepare(
    "SELECT id FROM native_documents WHERE workspace_id=? AND source_key=?"
  )
    .bind(workspace, sourceKey)
    .first<{ id: string }>();
  check(saved, "document_save_failed", 503);
  return saved.id;
}
