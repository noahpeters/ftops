type PresignOptions = {
  method?: string;
  expiresIn?: number;
};

type R2BucketWithPresign = R2Bucket & {
  createPresignedUrl?: (key: string, options?: PresignOptions) => Promise<string>;
};

export async function tryCreatePresignedUrl(
  bucket: R2Bucket,
  key: string,
  options?: PresignOptions
): Promise<string | null> {
  const signer = (bucket as R2BucketWithPresign).createPresignedUrl;
  if (!signer) {
    return null;
  }
  return await signer.call(bucket, key, options);
}

type R2S3PresignArgs = {
  method: "GET" | "PUT";
  key: string;
  bucketName: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresIn?: number;
};

export async function presignR2S3Url(args: R2S3PresignArgs): Promise<string> {
  const region = "auto";
  const service = "s3";
  const method = args.method;
  const expiresIn = Math.min(Math.max(args.expiresIn ?? 900, 1), 604800);
  const host = `${args.accountId}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);

  const canonicalUri = `/${encodePath(`${args.bucketName}/${args.key}`)}`;

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const credential = `${args.accessKeyId}/${credentialScope}`;

  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host",
  };

  const canonicalQuery = buildCanonicalQuery(query);
  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = "host";
  const payloadHash = "UNSIGNED-PAYLOAD";

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await getSignatureKey(args.secretAccessKey, dateStamp, region, service);
  const signature = await hmacHex(signingKey, stringToSign);

  const url = `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  return url;
}

function toAmzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function encodePath(value: string) {
  return value
    .split("/")
    .map((part) => encodeRfc3986(part))
    .join("/");
}

function buildCanonicalQuery(params: Record<string, string>) {
  return Object.keys(params)
    .sort()
    .map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(params[key])}`)
    .join("&");
}

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return toHex(hash);
}

async function hmacHex(key: ArrayBuffer, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value));
  return toHex(signature);
}

async function getSignatureKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string
) {
  const kDate = await hmacRaw(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmacRaw(kDate, region);
  const kService = await hmacRaw(kRegion, service);
  return await hmacRaw(kService, "aws4_request");
}

async function hmacRaw(key: string | ArrayBuffer, value: string) {
  const keyData = typeof key === "string" ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value));
}

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
