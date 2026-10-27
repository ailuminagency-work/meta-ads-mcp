import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decryptToken,
  decryptTokenDetailed,
  encryptToken,
  resetKeyCacheForTests,
} from "../../src/auth/crypto.js";
import { parseKeyringEnv, type EncryptionKeyring } from "../../src/auth/keyring.js";
import { flipBase64Byte, hex, impls, K1, K2, restoreKeyEnv, useKeyEnv, ENVS, type Envelope } from "../fixtures/crypto/compat-harness.js";

const PLAINTEXT = "synthetic-plaintext-do-not-leak";
const AAD = "mcp_token:synthetic-user:personal";
const ring: EncryptionKeyring = { activeKeyId: "primary", keys: new Map([["primary", K1], ["next", K2]]) };

function seal(aad: string | null = AAD, keyring = ring): Envelope {
  return encryptToken(PLAINTEXT, aad ?? undefined, keyring) as Envelope;
}

function withTag(envelope: Envelope, tag: Buffer): Envelope {
  return { ...envelope, tag: tag.toString("base64") };
}

function messages(error: unknown): string {
  const parts: string[] = [];
  for (let current: unknown = error, depth = 0; current && depth < 5; depth++) {
    if (current instanceof Error) {
      parts.push(current.name, current.message, current.stack ?? "");
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join("\n");
}

function failure(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the operation to be rejected");
}

afterEach(() => {
  vi.restoreAllMocks();
  restoreKeyEnv();
  resetKeyCacheForTests();
});

describe("GCM authentication tag is pinned to 16 bytes on every path", () => {
  it("passes authTagLength 16 to both createCipheriv and createDecipheriv", () => {
    const cipherSpy = vi.spyOn(crypto, "createCipheriv");
    const decipherSpy = vi.spyOn(crypto, "createDecipheriv");
    const envelope = seal();
    decryptToken(envelope, AAD, undefined, ring);
    expect(cipherSpy).toHaveBeenCalledTimes(1);
    expect(cipherSpy.mock.calls[0][3]).toEqual({ authTagLength: 16 });
    expect(decipherSpy).toHaveBeenCalledTimes(1);
    expect(decipherSpy.mock.calls[0][3]).toEqual({ authTagLength: 16 });
  });

  it("produces exactly 16-byte tags and 12-byte IVs", () => {
    const envelope = seal();
    expect(Buffer.from(envelope.tag, "base64")).toHaveLength(16);
    expect(Buffer.from(envelope.iv, "base64")).toHaveLength(12);
  });

  it("accepts the genuine 16-byte tag", () => {
    expect(decryptToken(seal(), AAD, undefined, ring)).toBe(PLAINTEXT);
  });

  it.each([0, 1, 4, 8, 12, 13, 14, 15])("rejects a tag truncated to %i bytes", (length) => {
    const envelope = seal();
    const truncated = withTag(envelope, Buffer.from(envelope.tag, "base64").subarray(0, length));
    const error = failure(() => decryptToken(truncated, AAD, undefined, ring));
    expect(error.message).toBe("Encrypted token could not be authenticated");
    expect((error.cause as Error).message).toBe("Malformed encrypted token payload");
  });

  it.each([17, 20, 32])("rejects a tag extended to %i bytes, including a genuine tag with appended bytes", (length) => {
    const envelope = seal();
    const real = Buffer.from(envelope.tag, "base64");
    const extended = withTag(envelope, Buffer.concat([real, Buffer.alloc(length - 16)]));
    expect(failure(() => decryptToken(extended, AAD, undefined, ring)).message).toBe("Encrypted token could not be authenticated");
  });

  it("rejects a missing, empty or non-string tag, iv or ciphertext without a type error", () => {
    const envelope = seal();
    for (const broken of [
      { ...envelope, tag: "" },
      { ...envelope, tag: undefined },
      { ...envelope, tag: 7 },
      { ...envelope, iv: null },
      { ...envelope, iv: "" },
      { ...envelope, ciphertext: undefined },
      { ...envelope, ciphertext: { nested: "object" } },
    ]) {
      const error = failure(() => decryptToken(broken as unknown as Envelope, AAD, undefined, ring));
      expect(error.message).toBe("Encrypted token could not be authenticated");
      expect((error.cause as Error).message).toBe("Malformed encrypted token payload");
    }
    expect(failure(() => decryptToken(null as unknown as Envelope, AAD, undefined, ring)).message).toBe("Encrypted token could not be authenticated");
  });

  it("rejects a non-string keyVersion member as malformed", () => {
    const envelope = { ...seal(), keyVersion: 7 } as unknown as Envelope;
    expect(failure(() => decryptToken(envelope, AAD, undefined, ring)).message).toBe("Malformed encrypted token payload");
  });

  it("rejects every single-bit flip of the 16-byte tag", () => {
    const envelope = seal();
    for (let bit = 0; bit < 128; bit++) {
      const flipped = flipBase64Byte(envelope.tag, Math.floor(bit / 8), 1 << (bit % 8));
      expect(() => decryptToken({ ...envelope, tag: flipped }, AAD, undefined, ring), `tag bit ${bit}`).toThrow("Encrypted token could not be authenticated");
    }
  });

  it("rejects a flipped bit in every ciphertext byte and in every IV byte", () => {
    const envelope = seal();
    const length = Buffer.from(envelope.ciphertext, "base64").length;
    for (let index = 0; index < length; index++) {
      expect(() => decryptToken({ ...envelope, ciphertext: flipBase64Byte(envelope.ciphertext, index) }, AAD, undefined, ring), `ciphertext byte ${index}`).toThrow("Encrypted token could not be authenticated");
    }
    for (let index = 0; index < 12; index++) {
      expect(() => decryptToken({ ...envelope, iv: flipBase64Byte(envelope.iv, index) }, AAD, undefined, ring), `iv byte ${index}`).toThrow("Encrypted token could not be authenticated");
    }
  });

  it("rejects the wrong, a missing and an unexpected AAD", () => {
    const bound = seal(AAD);
    expect(() => decryptToken(bound, "mcp_token:other-user:personal", undefined, ring)).toThrow("could not be authenticated");
    expect(() => decryptToken(bound, "mcp_token:synthetic-user:other-name", undefined, ring)).toThrow("could not be authenticated");
    expect(() => decryptToken(bound, undefined, undefined, ring)).toThrow("could not be authenticated");
    const legacy = seal(null);
    expect(() => decryptToken(legacy, AAD, undefined, ring)).toThrow("could not be authenticated");
    expect(decryptToken(legacy, undefined, undefined, ring)).toBe(PLAINTEXT);
  });

  it("rejects a wrong key and a wrong declared key version without trying another key", () => {
    const underNext = seal(AAD, { activeKeyId: "next", keys: ring.keys });
    expect(underNext.keyVersion).toBe("next");
    expect(decryptTokenDetailed(underNext, AAD, undefined, ring).keyVersion).toBe("next");
    expect(failure(() => decryptToken({ ...underNext, keyVersion: "primary" }, AAD, undefined, ring)).message).toBe("Encrypted token could not be authenticated");
    expect(failure(() => decryptToken(underNext, AAD, "primary", ring)).message).toBe("Encrypted token could not be authenticated");
    expect(failure(() => decryptToken(underNext, AAD, "missing", ring)).message).toBe("Encryption key version is not available: missing");
    expect(failure(() => decryptToken(underNext, AAD, undefined, { activeKeyId: "primary", keys: new Map([["primary", K1]]) })).message).toBe("Encryption key version is not available: next");
    const wrongKeyOnly: EncryptionKeyring = { activeKeyId: "next", keys: new Map([["next", Buffer.alloc(32, 0x44)]]) };
    expect(failure(() => decryptToken(underNext, AAD, undefined, wrongKeyOnly)).message).toBe("Encrypted token could not be authenticated");
  });

  it("main@251249e accepts truncated tags that the release line rejects (audit finding reproduced)", () => {
    useKeyEnv(ENVS.k1Only);
    const envelope = impls.main.encrypt(PLAINTEXT, AAD);
    for (const length of [4, 8, 12, 13, 14, 15]) {
      const truncated = withTag(envelope, Buffer.from(envelope.tag, "base64").subarray(0, length));
      expect(impls.main.decrypt(truncated, AAD)).toBe(PLAINTEXT);
      expect(() => impls.line.decrypt(truncated, AAD)).toThrow("Encrypted token could not be authenticated");
    }
    const extended = withTag(envelope, Buffer.concat([Buffer.from(envelope.tag, "base64"), Buffer.alloc(1)]));
    expect(() => impls.main.decrypt(extended, AAD)).toThrow("Invalid authentication tag length: 17");
  });
});

describe("failure messages never carry plaintext, ciphertext, keys or the AAD", () => {
  const forbidden = (envelope: Envelope): string[] => [
    PLAINTEXT, AAD, hex(K1), hex(K2), K1.toString("base64"), K2.toString("base64"),
    envelope.ciphertext, envelope.iv, envelope.tag,
  ];

  it("holds across truncated, extended, flipped, wrong-AAD, wrong-key and wrong-version failures", () => {
    const envelope = seal();
    const real = Buffer.from(envelope.tag, "base64");
    const attempts: Array<() => unknown> = [
      () => decryptToken(withTag(envelope, real.subarray(0, 8)), AAD, undefined, ring),
      () => decryptToken(withTag(envelope, Buffer.concat([real, Buffer.alloc(1)])), AAD, undefined, ring),
      () => decryptToken({ ...envelope, tag: flipBase64Byte(envelope.tag, 0) }, AAD, undefined, ring),
      () => decryptToken({ ...envelope, ciphertext: flipBase64Byte(envelope.ciphertext, 0) }, AAD, undefined, ring),
      () => decryptToken(envelope, "wrong-aad", undefined, ring),
      () => decryptToken(envelope, AAD, undefined, { activeKeyId: "other", keys: new Map([["other", Buffer.alloc(32, 9)]]) }),
      () => decryptToken(envelope, AAD, "missing-version", ring),
      () => decryptToken({ ...envelope, keyVersion: hex(K1) }, AAD, undefined, ring),
    ];
    for (const attempt of attempts) {
      const text = messages(failure(attempt));
      for (const secret of forbidden(envelope)) expect(text).not.toContain(secret);
    }
  });

  it("does not echo a key-shaped or oversized key version taken from a stored document", () => {
    const envelope = seal();
    const keyShaped = failure(() => decryptToken({ ...envelope, keyVersion: hex(K1) }, AAD, undefined, ring));
    expect(keyShaped.message).toBe("Encryption key version is not available: [redacted]");
    const oversized = failure(() => decryptToken({ ...envelope, keyVersion: "x".repeat(500) }, AAD, undefined, ring));
    expect(oversized.message).toBe("Encryption key version is not available: [redacted]");
    const injected = failure(() => decryptToken({ ...envelope, keyVersion: "a\nforged log line" }, AAD, undefined, ring));
    expect(injected.message).not.toContain("forged log line");
  });

  it("does not echo a key-shaped key id taken from keyring configuration", () => {
    const swapped = JSON.stringify({ activeKeyId: "primary", keys: { [hex(K1)]: "primary" } });
    const error = failure(() => parseKeyringEnv({ NODE_ENV: "production", TOKEN_ENCRYPTION_KEYRING_JSON: swapped }));
    expect(messages(error)).not.toContain(hex(K1));
    const longId = "k".repeat(200);
    const oversized = failure(() => parseKeyringEnv({ NODE_ENV: "production", TOKEN_ENCRYPTION_KEYRING_JSON: JSON.stringify({ activeKeyId: longId, keys: { [longId]: hex(K1) } }) }));
    expect(oversized.message).toBe("Invalid encryption key id");
    const missingActive = failure(() => parseKeyringEnv({ NODE_ENV: "production", TOKEN_ENCRYPTION_KEYRING_JSON: JSON.stringify({ activeKeyId: hex(K2), keys: { primary: hex(K1) } }) }));
    expect(messages(missingActive)).not.toContain(hex(K2));
    const duplicate = failure(() => parseKeyringEnv({
      NODE_ENV: "production", TOKEN_ENCRYPTION_KEY: hex(K1), TOKEN_ENCRYPTION_KEY_NEXT: hex(K2), TOKEN_ENCRYPTION_KEY_NEXT_ID: "primary",
    }));
    expect(duplicate.message).toBe("Duplicate encryption key id: primary");
    expect(messages(duplicate)).not.toContain(hex(K1));
    expect(messages(duplicate)).not.toContain(hex(K2));
  });

  it("does not echo key bytes when a configured key is malformed", () => {
    const bad = `${hex(K1).slice(0, 62)}zz`;
    const error = failure(() => parseKeyringEnv({ NODE_ENV: "production", TOKEN_ENCRYPTION_KEY: bad }));
    expect(error.message).toBe("TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
    expect(messages(error)).not.toContain(bad);
  });
});
