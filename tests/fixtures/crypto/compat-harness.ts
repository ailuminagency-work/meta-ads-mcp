import * as lineCrypto from "../../../src/auth/crypto.js";
import * as mainCrypto from "./main-251249e/auth/crypto.js";
import * as stagingCrypto from "./staging-1f08563/auth/crypto.js";

/** Synthetic key material only; each key is 32 repeated bytes. */
export const K1 = Buffer.alloc(32, 0x11);
export const K2 = Buffer.alloc(32, 0x22);
export const K3 = Buffer.alloc(32, 0x33);
export const hex = (key: Buffer): string => key.toString("hex");

const KEY_ENV_NAMES = [
  "TOKEN_ENCRYPTION_KEY",
  "TOKEN_ENCRYPTION_KEY_ID",
  "TOKEN_ENCRYPTION_KEY_NEXT",
  "TOKEN_ENCRYPTION_KEY_NEXT_ID",
  "TOKEN_ENCRYPTION_KEY_PREVIOUS",
  "TOKEN_ENCRYPTION_KEY_PREVIOUS_ID",
  "TOKEN_ENCRYPTION_KEYRING_JSON",
] as const;

export type KeyEnv = Partial<Record<(typeof KEY_ENV_NAMES)[number], string>>;

export const ENVS = {
  k1Only: { TOKEN_ENCRYPTION_KEY: hex(K1) },
  k2Only: { TOKEN_ENCRYPTION_KEY: hex(K2) },
  k1PlusNext: { TOKEN_ENCRYPTION_KEY: hex(K1), TOKEN_ENCRYPTION_KEY_NEXT: hex(K2) },
  k1PlusNextCustomId: { TOKEN_ENCRYPTION_KEY: hex(K1), TOKEN_ENCRYPTION_KEY_NEXT: hex(K2), TOKEN_ENCRYPTION_KEY_NEXT_ID: "k2026" },
  jsonActiveNext: { TOKEN_ENCRYPTION_KEYRING_JSON: JSON.stringify({ activeKeyId: "next", keys: { primary: hex(K1), next: hex(K2) } }) },
  jsonActivePrimary: { TOKEN_ENCRYPTION_KEYRING_JSON: JSON.stringify({ activeKeyId: "primary", keys: { primary: hex(K1), next: hex(K2) } }) },
} satisfies Record<string, KeyEnv>;

const saved = new Map<string, string | undefined>();

export function resetAllCryptoCaches(): void {
  mainCrypto.resetKeyCacheForTests();
  stagingCrypto.resetKeyCacheForTests();
  lineCrypto.resetKeyCacheForTests();
}

/** Replace only the encryption variables, then drop every implementation's cached key. */
export function useKeyEnv(env: KeyEnv): void {
  for (const name of KEY_ENV_NAMES) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    delete process.env[name];
  }
  for (const [name, value] of Object.entries(env)) process.env[name] = value;
  resetAllCryptoCaches();
}

export function restoreKeyEnv(): void {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
  resetAllCryptoCaches();
}

export interface Envelope { ciphertext: string; iv: string; tag: string; keyVersion?: string }

export interface CryptoImpl {
  name: "main@251249e" | "staging@1f08563" | "release-line";
  encrypt(plaintext: string, aad?: string): Envelope;
  decrypt(envelope: Envelope, aad?: string): string;
}

export const impls: Record<"main" | "staging" | "line", CryptoImpl> = {
  main: { name: "main@251249e", encrypt: mainCrypto.encryptToken, decrypt: mainCrypto.decryptToken },
  staging: { name: "staging@1f08563", encrypt: stagingCrypto.encryptToken as CryptoImpl["encrypt"], decrypt: stagingCrypto.decryptToken as CryptoImpl["decrypt"] },
  line: { name: "release-line", encrypt: lineCrypto.encryptToken as CryptoImpl["encrypt"], decrypt: lineCrypto.decryptToken as CryptoImpl["decrypt"] },
};

export const MAIN_GCM_AUTH_ERROR = "Unsupported state or unable to authenticate data";
export const LINE_AUTH_ERROR = "Encrypted token could not be authenticated";

export type Outcome = "OK" | "MAIN_GCM_AUTH" | "LINE_AUTH" | `KEY_VERSION_UNAVAILABLE:${string}` | `OTHER:${string}`;

export function classify(run: () => string, expectedPlaintext: string): Outcome {
  try {
    return run() === expectedPlaintext ? "OK" : "OTHER:wrong-plaintext";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === MAIN_GCM_AUTH_ERROR) return "MAIN_GCM_AUTH";
    if (message === LINE_AUTH_ERROR) return "LINE_AUTH";
    const unavailable = /^Encryption key version is not available: (.+)$/.exec(message);
    if (unavailable) return `KEY_VERSION_UNAVAILABLE:${unavailable[1]}`;
    return `OTHER:${message}`;
  }
}

export function flipBase64Byte(value: string, index: number, mask = 0x01): string {
  const bytes = Buffer.from(value, "base64");
  bytes[index % bytes.length] ^= mask;
  return bytes.toString("base64");
}
