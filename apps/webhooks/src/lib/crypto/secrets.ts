import type { Env } from "../types";

type EncryptedSecrets = {
  keyId: string;
  ciphertext: string;
};

export async function importMasterKey(env: Env): Promise<CryptoKey> {
  const raw = env.INTEGRATIONS_MASTER_KEY;
  if (!raw) {
    throw new Error("missing_integrations_master_key");
  }
  const keyBytes = decodeKey(raw);
  if (keyBytes.length !== 32) {
    throw new Error("invalid_master_key_length");
  }
  return await globalThis.crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptSecrets(
  env: Env,
  plaintextJson: string,
): Promise<EncryptedSecrets> {
  const keyId = env.INTEGRATIONS_KEY_ID || "v1";
  const key = await importMasterKey(env);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintextJson),
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return {
    keyId,
    ciphertext: toBase64(combined),
  };
}

export async function decryptSecrets(
  env: Env,
  keyId: string,
  ciphertext: string,
): Promise<string> {
  const envKeyId = env.INTEGRATIONS_KEY_ID || "v1";
  if (keyId !== envKeyId) {
    throw new Error("unsupported_key_id");
  }
  const key = await importMasterKey(env);
  const bytes = fromBase64(ciphertext);
  if (bytes.length < 13) {
    throw new Error("invalid_ciphertext");
  }
  const iv = bytes.slice(0, 12);
  const data = bytes.slice(12);
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );
  return new TextDecoder().decode(plaintext);
}

function decodeKey(value: string) {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return fromHex(trimmed);
  }
  return fromBase64(trimmed);
}

function fromHex(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
