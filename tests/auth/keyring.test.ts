import { afterEach, describe, expect, it } from "vitest";
import {
  configureKeyringForTests,
  decryptToken,
  decryptTokenDetailed,
  encryptToken,
  resetKeyCacheForTests,
} from "../../src/auth/crypto.js";
import { parseKeyringEnv, type EncryptionKeyring } from "../../src/auth/keyring.js";

const OLD = Buffer.alloc(32, 1);
const NEXT = Buffer.alloc(32, 2);
const keyring: EncryptionKeyring = {
  activeKeyId: "next",
  keys: new Map([
    ["primary", OLD],
    ["next", NEXT],
  ]),
};

describe("versioned token encryption keyring", () => {
  afterEach(() => resetKeyCacheForTests());

  it("uses the active version for new ciphertext and retains the old version for reads", () => {
    configureKeyringForTests(keyring);
    const encrypted = encryptToken("token", "tenant:credential");
    expect(encrypted.keyVersion).toBe("next");
    expect(decryptToken(encrypted, "tenant:credential")).toBe("token");

    configureKeyringForTests({ activeKeyId: "next", keys: new Map([["primary", OLD], ["next", NEXT]]) });
    const legacy = encryptToken("old-token", "tenant:credential", { activeKeyId: "primary", keys: new Map([["primary", OLD]]) });
    expect(decryptTokenDetailed(legacy, "tenant:credential", undefined, keyring).keyVersion).toBe("primary");
  });

  it("requires the declared version instead of silently trying another key", () => {
    configureKeyringForTests(keyring);
    const encrypted = encryptToken("token", undefined, { activeKeyId: "primary", keys: new Map([["primary", OLD]]) });
    expect(() => decryptToken(encrypted, undefined, "missing-version")).toThrow(/not available/);
  });

  it("parses sealed-secret split variables without requiring the old value to be displayed", () => {
    const parsed = parseKeyringEnv({
      NODE_ENV: "production",
      TOKEN_ENCRYPTION_KEY: OLD.toString("hex"),
      TOKEN_ENCRYPTION_KEY_NEXT: NEXT.toString("hex"),
    });
    expect(parsed.activeKeyId).toBe("next");
    expect([...parsed.keys.keys()]).toEqual(["primary", "next"]);
  });

  it("rejects a malformed keyring", () => {
    expect(() => parseKeyringEnv({ NODE_ENV: "production", TOKEN_ENCRYPTION_KEY: "not-a-key" })).toThrow(/64 hex/);
  });
});
