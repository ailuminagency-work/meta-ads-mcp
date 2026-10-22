import crypto from "node:crypto";

const KEY_LENGTH = 32;
const HEX_KEY_LENGTH = KEY_LENGTH * 2;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export const PRIMARY_KEY_ID = "primary";

export interface EncryptionKeyring {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
}

export interface KeyringStatus {
  activeKeyId: string;
  keyIds: string[];
  fingerprints: Record<string, string>;
}

function validateKeyId(keyId: string): string {
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new Error(`Invalid encryption key id: ${keyId}`);
  }
  return keyId;
}

function parseKey(raw: unknown, label: string): Buffer {
  if (typeof raw !== "string" || !new RegExp(`^[0-9a-fA-F]{${HEX_KEY_LENGTH}}$`).test(raw.trim())) {
    throw new Error(`${label} must be ${HEX_KEY_LENGTH} hex characters (${KEY_LENGTH} bytes)`);
  }
  return Buffer.from(raw.trim(), "hex");
}

function makeKeyring(activeKeyId: string, entries: Map<string, Buffer>): EncryptionKeyring {
  validateKeyId(activeKeyId);
  if (!entries.has(activeKeyId)) {
    throw new Error(`Active encryption key is not present in the keyring: ${activeKeyId}`);
  }
  if (entries.size === 0) {
    throw new Error("Encryption keyring must contain at least one key");
  }
  return { activeKeyId, keys: entries };
}

function parseJsonKeyring(raw: string): EncryptionKeyring {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("TOKEN_ENCRYPTION_KEYRING_JSON must be valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("TOKEN_ENCRYPTION_KEYRING_JSON must be an object");
  }
  const value = parsed as Record<string, unknown>;
  const activeKeyId = value.activeKeyId;
  const rawKeys = value.keys;
  if (typeof activeKeyId !== "string" || typeof rawKeys !== "object" || rawKeys === null || Array.isArray(rawKeys)) {
    throw new Error("TOKEN_ENCRYPTION_KEYRING_JSON requires activeKeyId and keys");
  }

  const entries = new Map<string, Buffer>();
  for (const [keyId, rawKey] of Object.entries(rawKeys as Record<string, unknown>)) {
    entries.set(validateKeyId(keyId), parseKey(rawKey, `Encryption key ${keyId}`));
  }
  return makeKeyring(activeKeyId, entries);
}

/**
 * Builds the runtime keyring without ever logging key material.
 *
 * The JSON form is the canonical format. The split-variable form exists for
 * sealed-secret rotation: TOKEN_ENCRYPTION_KEY can remain unreadable as the
 * old key while TOKEN_ENCRYPTION_KEY_NEXT is added through the provider UI.
 */
export function parseKeyringEnv(env: NodeJS.ProcessEnv = process.env): EncryptionKeyring {
  const json = env.TOKEN_ENCRYPTION_KEYRING_JSON?.trim();
  if (json) return parseJsonKeyring(json);

  const current = env.TOKEN_ENCRYPTION_KEY?.trim();
  const next = env.TOKEN_ENCRYPTION_KEY_NEXT?.trim();
  const previous = env.TOKEN_ENCRYPTION_KEY_PREVIOUS?.trim();
  const currentId = env.TOKEN_ENCRYPTION_KEY_ID?.trim() || PRIMARY_KEY_ID;
  const nextId = env.TOKEN_ENCRYPTION_KEY_NEXT_ID?.trim() || "next";
  const previousId = env.TOKEN_ENCRYPTION_KEY_PREVIOUS_ID?.trim() || "previous";

  const entries = new Map<string, Buffer>();
  if (current) entries.set(validateKeyId(currentId), parseKey(current, "TOKEN_ENCRYPTION_KEY"));
  if (previous) entries.set(validateKeyId(previousId), parseKey(previous, "TOKEN_ENCRYPTION_KEY_PREVIOUS"));
  if (next) {
    const id = validateKeyId(nextId);
    if (entries.has(id)) throw new Error(`Duplicate encryption key id: ${id}`);
    entries.set(id, parseKey(next, "TOKEN_ENCRYPTION_KEY_NEXT"));
  }

  if (entries.size === 0) {
    if (env.NODE_ENV === "production") {
      throw new Error("TOKEN_ENCRYPTION_KEY or TOKEN_ENCRYPTION_KEYRING_JSON is required in production");
    }
    entries.set("ephemeral", crypto.randomBytes(KEY_LENGTH));
    return makeKeyring("ephemeral", entries);
  }

  return makeKeyring(next ? nextId : currentId, entries);
}

export function getKeyringStatus(keyring: EncryptionKeyring = parseKeyringEnv()): KeyringStatus {
  const fingerprints: Record<string, string> = {};
  for (const [keyId, key] of keyring.keys) {
    fingerprints[keyId] = crypto.createHash("sha256").update(key).digest("hex").slice(0, 12);
  }
  return {
    activeKeyId: keyring.activeKeyId,
    keyIds: [...keyring.keys.keys()].sort(),
    fingerprints,
  };
}

export function resetKeyringCacheForTests(): void {
  // Kept as a named test seam for callers that need to reset environment-based
  // configuration. The crypto module owns the actual cache.
}
