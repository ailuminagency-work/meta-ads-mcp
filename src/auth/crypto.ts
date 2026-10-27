import crypto from "node:crypto";
import {
  type EncryptionKeyring,
  getKeyringStatus,
  parseKeyringEnv,
  redactKeyId,
} from "./keyring.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

let cachedKeyring: EncryptionKeyring | undefined;
let testKeyring: EncryptionKeyring | undefined;

function getKeyring(): EncryptionKeyring {
  if (testKeyring) return testKeyring;
  if (!cachedKeyring) cachedKeyring = parseKeyringEnv();
  return cachedKeyring;
}

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  tag: string;
  /** Identifies the key used for encryption; absent only on legacy records. */
  keyVersion?: string;
}

export interface DecryptedToken {
  plaintext: string;
  keyVersion: string;
}

function candidateKeyIds(
  payload: EncryptedPayload,
  declaredKeyVersion: string | undefined,
  keyring: EncryptionKeyring,
): string[] {
  if (payload?.keyVersion !== undefined && typeof payload.keyVersion !== "string") {
    throw new Error("Malformed encrypted token payload");
  }
  const declared = declaredKeyVersion?.trim() || payload?.keyVersion?.trim();
  if (declared) {
    if (!keyring.keys.has(declared)) {
      throw new Error(`Encryption key version is not available: ${redactKeyId(declared)}`);
    }
    return [declared];
  }
  return [
    keyring.activeKeyId,
    ...[...keyring.keys.keys()].filter((keyId) => keyId !== keyring.activeKeyId).sort(),
  ];
}

function decryptWithKey(
  payload: EncryptedPayload,
  aad: string | undefined,
  key: Buffer,
): string {
  if (
    typeof payload?.iv !== "string" ||
    typeof payload.tag !== "string" ||
    typeof payload.ciphertext !== "string"
  ) {
    throw new Error("Malformed encrypted token payload");
  }
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");
  if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Malformed encrypted token payload");
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(tag);
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function encryptToken(
  plaintext: string,
  aad?: string,
  keyring: EncryptionKeyring = getKeyring(),
): EncryptedPayload {
  const key = keyring.keys.get(keyring.activeKeyId);
  if (!key) throw new Error(`Active encryption key is not available: ${redactKeyId(keyring.activeKeyId)}`);

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyVersion: keyring.activeKeyId,
  };
}

export function decryptTokenDetailed(
  payload: EncryptedPayload,
  aad?: string,
  declaredKeyVersion?: string,
  keyring: EncryptionKeyring = getKeyring(),
): DecryptedToken {
  let lastError: unknown;
  for (const keyId of candidateKeyIds(payload, declaredKeyVersion, keyring)) {
    const key = keyring.keys.get(keyId);
    if (!key) continue;
    try {
      return { plaintext: decryptWithKey(payload, aad, key), keyVersion: keyId };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error("Encrypted token could not be authenticated", { cause: lastError });
}

export function decryptToken(
  payload: EncryptedPayload,
  aad?: string,
  declaredKeyVersion?: string,
  keyring?: EncryptionKeyring,
): string {
  return decryptTokenDetailed(payload, aad, declaredKeyVersion, keyring).plaintext;
}

/** Exposes only key ids and one-way fingerprints for operational diagnostics. */
export function getEncryptionKeyringStatus(): ReturnType<typeof getKeyringStatus> {
  return getKeyringStatus(getKeyring());
}

/** Test-only injection; production code always reads the provider environment. */
export function configureKeyringForTests(keyring: EncryptionKeyring | undefined): void {
  testKeyring = keyring;
}

export function resetKeyCacheForTests(): void {
  cachedKeyring = undefined;
  testKeyring = undefined;
}
