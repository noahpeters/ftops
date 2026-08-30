import { once } from "node:events";
import { Readable } from "node:stream";
import { MailParser, type AttachmentStream, type Headers, type MessageText } from "mailparser";

const MULTIPART_PART_BYTES = 5 * 1024 * 1024;

export type StreamedAttachment = {
  filename: string | null;
  mimeType: string;
  size: number;
  sha256: string;
  storageKey: string;
};

export type StreamedEmail = {
  headers: Headers;
  subject: string;
  messageId: string | null;
  date: string | null;
  from: unknown;
  to: unknown;
  cc: unknown;
  bcc: unknown;
  text: string;
  html: string;
  attachments: StreamedAttachment[];
  nestedEmails: StreamedEmail[];
};

export async function uploadStreamToR2(
  bucket: R2Bucket,
  storageKey: string,
  source: ReadableStream<Uint8Array>,
  options: R2MultipartOptions
) {
  const upload = await bucket.createMultipartUpload(storageKey, options);
  const uploadedParts: R2UploadedPart[] = [];
  const digestStream = new crypto.DigestStream("SHA-256");
  const digestWriter = digestStream.getWriter();
  const reader = source.getReader();
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      totalBytes += chunk.byteLength;
      await digestWriter.write(chunk);
      pending.push(chunk);
      pendingBytes += chunk.byteLength;
      while (pendingBytes >= MULTIPART_PART_BYTES) {
        const combined = concatBytes(pending, pendingBytes);
        uploadedParts.push(
          await upload.uploadPart(uploadedParts.length + 1, combined.slice(0, MULTIPART_PART_BYTES))
        );
        const remainder = combined.slice(MULTIPART_PART_BYTES);
        pending = remainder.byteLength > 0 ? [remainder] : [];
        pendingBytes = remainder.byteLength;
      }
    }
    if (pendingBytes > 0) {
      uploadedParts.push(
        await upload.uploadPart(uploadedParts.length + 1, concatBytes(pending, pendingBytes))
      );
    }
    await digestWriter.close();
    if (uploadedParts.length === 0) throw new Error("email_size_invalid");
    const object = await upload.complete(uploadedParts);
    return {
      object,
      size: totalBytes,
      sha256: bytesToHex(new Uint8Array(await digestStream.digest)),
    };
  } catch (error) {
    await digestWriter.abort(error).catch(() => undefined);
    await upload.abort().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function parseEmailFromR2(
  bucket: R2Bucket,
  rawStorageKey: string,
  attachmentKey: (attachment: AttachmentStream, index: number) => string
): Promise<StreamedEmail> {
  const object = await bucket.get(rawStorageKey);
  if (!object) throw new Error("email_source_not_found");

  return await parseEmailStream(
    Readable.from(object.body as unknown as AsyncIterable<Uint8Array>),
    bucket,
    attachmentKey,
    { value: 0 }
  );
}

async function parseEmailStream(
  source: Readable,
  bucket: R2Bucket,
  attachmentKey: (attachment: AttachmentStream, index: number) => string,
  attachmentIndex: { value: number }
): Promise<StreamedEmail> {
  const parser = new MailParser({
    checksumAlgo: "sha256",
    skipHtmlToText: true,
    skipTextToHtml: true,
    skipImageLinks: true,
  });
  let headers: Headers = new Map();
  const textPart: { value: MessageText | null } = { value: null };
  const attachments: StreamedAttachment[] = [];
  const nestedEmails: StreamedEmail[] = [];
  const attachmentTasks: Promise<void>[] = [];

  parser.on("headers", (value) => {
    headers = value;
  });
  parser.on("data", (part: AttachmentStream | MessageText) => {
    if (part.type === "text") {
      textPart.value = part;
      return;
    }
    const index = attachmentIndex.value++;
    const task = (
      part.contentType.toLowerCase() === "message/rfc822"
        ? parseEmailStream(part.content as Readable, bucket, attachmentKey, attachmentIndex).then(
            (nested) => {
              nestedEmails.push(nested);
            }
          )
        : uploadAttachment(bucket, attachmentKey(part, index), part).then((attachment) => {
            attachments.push(attachment);
          })
    ).finally(() => part.release());
    void task.catch(() => undefined);
    attachmentTasks.push(task);
  });

  const completed = once(parser, "end");
  const failed = once(parser, "error").then(([error]) => Promise.reject(error));
  source.pipe(parser);
  await Promise.race([completed, failed]);
  await Promise.all(attachmentTasks);

  return {
    headers,
    subject: headerString(headers, "subject") || "Customer email",
    messageId: headerString(headers, "message-id") || null,
    date: headerDate(headers, "date"),
    from: headers.get("from"),
    to: headers.get("to"),
    cc: headers.get("cc"),
    bcc: headers.get("bcc"),
    text: textPart.value?.text || "",
    html: typeof textPart.value?.html === "string" ? textPart.value.html : "",
    attachments: attachments.sort((a, b) => a.storageKey.localeCompare(b.storageKey)),
    nestedEmails,
  };
}

async function uploadAttachment(
  bucket: R2Bucket,
  storageKey: string,
  attachment: AttachmentStream
): Promise<StreamedAttachment> {
  const upload = await bucket.createMultipartUpload(storageKey, {
    httpMetadata: { contentType: attachment.contentType || "application/octet-stream" },
  });
  const uploadedParts: R2UploadedPart[] = [];
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  try {
    for await (const value of attachment.content as Readable) {
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer);
      pending.push(chunk);
      pendingBytes += chunk.byteLength;
      while (pendingBytes >= MULTIPART_PART_BYTES) {
        const combined = concatBytes(pending, pendingBytes);
        uploadedParts.push(
          await upload.uploadPart(uploadedParts.length + 1, combined.slice(0, MULTIPART_PART_BYTES))
        );
        const remainder = combined.slice(MULTIPART_PART_BYTES);
        pending = remainder.byteLength > 0 ? [remainder] : [];
        pendingBytes = remainder.byteLength;
      }
    }
    if (pendingBytes > 0) {
      uploadedParts.push(
        await upload.uploadPart(uploadedParts.length + 1, concatBytes(pending, pendingBytes))
      );
    }
    if (uploadedParts.length === 0) {
      await upload.abort();
      await bucket.put(storageKey, new Uint8Array(), {
        httpMetadata: { contentType: attachment.contentType || "application/octet-stream" },
      });
    } else {
      await upload.complete(uploadedParts);
    }
  } catch (error) {
    await upload.abort().catch(() => undefined);
    throw error;
  }
  return {
    filename: attachment.filename || null,
    mimeType: attachment.contentType || "application/octet-stream",
    size: attachment.size || 0,
    sha256: attachment.checksum || "",
    storageKey,
  };
}

function concatBytes(chunks: Uint8Array[], totalBytes: number) {
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function headerString(headers: Headers, name: string) {
  const value = headers.get(name);
  return typeof value === "string" ? value : "";
}

function headerDate(headers: Headers, name: string) {
  const value = headers.get(name);
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null;
}
