import { afterEach, describe, expect, it } from "vitest";
import { getKeyringStatus, parseKeyringEnv } from "../../src/auth/keyring.js";
import {
  ENVS,
  K1,
  K2,
  classify,
  hex,
  impls,
  restoreKeyEnv,
  useKeyEnv,
  type Envelope,
  type KeyEnv,
} from "../fixtures/crypto/compat-harness.js";

const PLAINTEXT = "synthetic-token-active-key";
const AAD = "mcp_token:synthetic-user:personal";

const asEnv = (env: KeyEnv): NodeJS.ProcessEnv => ({ NODE_ENV: "production", ...env });
const writeWith = (env: KeyEnv): Envelope => {
  useKeyEnv(env);
  return JSON.parse(JSON.stringify(impls.line.encrypt(PLAINTEXT, AAD))) as Envelope;
};
const mainReads = (envelope: Envelope) => {
  useKeyEnv(ENVS.k1Only);
  return classify(() => impls.main.decrypt(envelope, AAD), PLAINTEXT);
};

describe("which key is ACTIVE (written under) for each keyring configuration", () => {
  afterEach(() => restoreKeyEnv());

  it("setting TOKEN_ENCRYPTION_KEY_NEXT alone makes `next` the active key", () => {
    const keyring = parseKeyringEnv(asEnv(ENVS.k1PlusNext));
    expect(keyring.activeKeyId).toBe("next");
    expect([...keyring.keys.keys()]).toEqual(["primary", "next"]);
  });

  it("a custom TOKEN_ENCRYPTION_KEY_NEXT_ID becomes the active key id", () => {
    const keyring = parseKeyringEnv(asEnv(ENVS.k1PlusNextCustomId));
    expect(keyring.activeKeyId).toBe("k2026");
    expect([...keyring.keys.keys()]).toEqual(["primary", "k2026"]);
  });

  it("TOKEN_ENCRYPTION_KEY_NEXT_ID without a next key changes nothing: primary stays active and next is not in the keyring", () => {
    const keyring = parseKeyringEnv(asEnv({ TOKEN_ENCRYPTION_KEY: hex(K1), TOKEN_ENCRYPTION_KEY_NEXT_ID: "k2026" }));
    expect(keyring.activeKeyId).toBe("primary");
    expect([...keyring.keys.keys()]).toEqual(["primary"]);
  });

  it("the previous key never becomes active", () => {
    const keyring = parseKeyringEnv(asEnv({ TOKEN_ENCRYPTION_KEY: hex(K2), TOKEN_ENCRYPTION_KEY_PREVIOUS: hex(K1) }));
    expect(keyring.activeKeyId).toBe("primary");
    expect([...keyring.keys.keys()].sort()).toEqual(["previous", "primary"]);
  });

  it("a JSON keyring with activeKeyId primary and both keys keeps primary active and still reads next", () => {
    const keyring = parseKeyringEnv(asEnv(ENVS.jsonActivePrimary));
    expect(keyring.activeKeyId).toBe("primary");
    expect([...keyring.keys.keys()].sort()).toEqual(["next", "primary"]);
    expect(getKeyringStatus(keyring).activeKeyId).toBe("primary");
  });

  it("the JSON keyring wins over the split variables", () => {
    const keyring = parseKeyringEnv(asEnv({ ...ENVS.jsonActivePrimary, ...ENVS.k1PlusNext }));
    expect(keyring.activeKeyId).toBe("primary");
  });
});

describe("what a rollback to main@251249e can read after each configuration has written", () => {
  afterEach(() => restoreKeyEnv());

  it("split variables with TOKEN_ENCRYPTION_KEY_NEXT: new records carry keyVersion next and main cannot read them", () => {
    const envelope = writeWith(ENVS.k1PlusNext);
    expect(envelope.keyVersion).toBe("next");
    expect(mainReads(envelope)).toBe("MAIN_GCM_AUTH");
  });

  it("JSON keyring with activeKeyId primary: new records are written under primary and main reads them", () => {
    const envelope = writeWith(ENVS.jsonActivePrimary);
    expect(envelope.keyVersion).toBe("primary");
    expect(mainReads(envelope)).toBe("OK");
  });

  it("JSON keyring with activeKeyId primary still reads records already written under next", () => {
    const nextRecord = writeWith(ENVS.k1PlusNext);
    expect(nextRecord.keyVersion).toBe("next");
    useKeyEnv(ENVS.jsonActivePrimary);
    expect(classify(() => impls.line.decrypt(nextRecord, AAD), PLAINTEXT)).toBe("OK");
  });

  it("the safe configuration reads next records AND keeps writing records that main reads", () => {
    const nextRecord = writeWith({ TOKEN_ENCRYPTION_KEY: hex(K1), TOKEN_ENCRYPTION_KEY_NEXT: hex(K2) });
    useKeyEnv(ENVS.jsonActivePrimary);
    expect(classify(() => impls.line.decrypt(nextRecord, AAD), PLAINTEXT)).toBe("OK");
    const fresh = JSON.parse(JSON.stringify(impls.line.encrypt("synthetic-refreshed", AAD))) as Envelope;
    expect(fresh.keyVersion).toBe("primary");
    useKeyEnv(ENVS.k1Only);
    expect(impls.main.decrypt(fresh, AAD)).toBe("synthetic-refreshed");
  });
});
