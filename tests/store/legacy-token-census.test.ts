import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encryptToken } from "../../src/auth/crypto.js";
import type { EncryptionKeyring } from "../../src/auth/keyring.js";
import { inspectLegacyTokenCensus } from "../../src/store/legacy-token-census.js";
import { ENVS, impls, K1, K2, restoreKeyEnv, useKeyEnv } from "../fixtures/crypto/compat-harness.js";
import { FakeFirestore } from "../fixtures/crypto/fake-firestore.js";

const keyring = (active: string): EncryptionKeyring => ({ activeKeyId: active, keys: new Map([["primary", K1], ["next", K2]]) });
const USER = "synthetic-census-user-4242";
const SECRET = "synthetic-census-secret-value";
let db: FakeFirestore;

beforeEach(() => { db = new FakeFirestore(); });
afterEach(() => restoreKeyEnv());

function seedMeta(name: string, payload: unknown, extra: Record<string, unknown> = {}): void {
  db.seed(`users/${USER}/meta_tokens/${name}`, { encryptedToken: payload, kind: "user", ...extra });
}

describe("legacy token census", () => {
  it("counts main-written, primary-key and next-key records and names the rollback blockers", async () => {
    useKeyEnv(ENVS.k1Only);
    seedMeta("main-aad", impls.main.encrypt(SECRET, `mcp_token:${USER}:main-aad`));
    seedMeta("main-legacy", impls.main.encrypt(SECRET));
    seedMeta("line-primary", encryptToken(SECRET, `mcp_token:${USER}:line-primary`, keyring("primary")), { keyVersion: "primary" });
    seedMeta("line-next", encryptToken(SECRET, `mcp_token:${USER}:line-next`, keyring("next")), { keyVersion: "next" });
    db.seed(`users/${USER}/apify_tokens/default`, { encryptedToken: encryptToken(SECRET, `apify_token:${USER}:default`, keyring("next")), keyVersion: "next" });
    db.seed(`users/${USER}/gemini_keys/default`, { encryptedKey: encryptToken(SECRET, `gemini_key:${USER}:default`, keyring("primary")), keyVersion: "primary" });

    const census = await inspectLegacyTokenCensus(db as never, keyring("next"));
    expect(census).toMatchObject({ readOnly: true, activeKeyId: "next", keyIds: ["next", "primary"], truncated: false, recordsNeedingNonPrimaryKey: 2 });
    expect(census.collections.meta_tokens).toMatchObject({
      records: 4, invalid: 0, decryptable: 4, undecryptable: 0, aadBound: 3, aadLegacy: 1,
      byDecryptingKey: { primary: 3, next: 1 }, byDeclaredVersion: { legacy: 2, primary: 1, next: 1 },
    });
    expect(census.collections.apify_tokens.byDecryptingKey).toEqual({ next: 1 });
    expect(census.collections.gemini_keys.byDecryptingKey).toEqual({ primary: 1 });
  });

  it("reports undecryptable, malformed and misplaced records without raising", async () => {
    useKeyEnv(ENVS.k1Only);
    seedMeta("tampered", { ...impls.main.encrypt(SECRET, `mcp_token:${USER}:tampered`), tag: Buffer.alloc(16).toString("base64") });
    seedMeta("wrong-name", impls.main.encrypt(SECRET, `mcp_token:${USER}:another-name`));
    seedMeta("malformed", "not-an-envelope");
    db.seed("other/client/meta_tokens/stray", { encryptedToken: impls.main.encrypt(SECRET) });
    seedMeta("retired-version", { ...encryptToken(SECRET, `mcp_token:${USER}:retired-version`, keyring("next")), keyVersion: "retired" });

    const census = await inspectLegacyTokenCensus(db as never, keyring("next"));
    expect(census.collections.meta_tokens).toMatchObject({ records: 5, invalid: 2, decryptable: 0, undecryptable: 3 });
    expect(census.recordsNeedingNonPrimaryKey).toBe(0);
  });

  it("flags a stale outer key version that disagrees with the envelope", async () => {
    useKeyEnv(ENVS.k1Only);
    seedMeta("stale", impls.main.encrypt(SECRET, `mcp_token:${USER}:stale`), { keyVersion: "primary" });
    const census = await inspectLegacyTokenCensus(db as never, keyring("next"));
    expect(census.collections.meta_tokens.outerVersionDisagrees).toBe(1);
    expect(census.collections.meta_tokens.decryptable).toBe(1);
  });

  it("judges decryptability like the runtime read path: a versionless envelope beside a wrong outer label is still readable", async () => {
    useKeyEnv(ENVS.k1Only);
    seedMeta("lying-outer", impls.main.encrypt(SECRET, `mcp_token:${USER}:lying-outer`), { keyVersion: "next" });
    const census = await inspectLegacyTokenCensus(db as never, keyring("next"));
    expect(census.collections.meta_tokens).toMatchObject({ records: 1, decryptable: 1, undecryptable: 0, outerVersionDisagrees: 1, byDecryptingKey: { primary: 1 } });
    expect(census.recordsNeedingNonPrimaryKey).toBe(0);
  });

  it("performs no writes and discloses no identifier, name, ciphertext or plaintext", async () => {
    useKeyEnv(ENVS.k1Only);
    const envelope = encryptToken(SECRET, `mcp_token:${USER}:named-token`, keyring("next"));
    seedMeta("named-token", envelope, { keyVersion: "next", metaUserName: "Synthetic Person" });
    db.writeLog.length = 0;
    const census = await inspectLegacyTokenCensus(db as never, keyring("next"));
    expect(db.writeLog).toEqual([]);
    const text = JSON.stringify(census);
    for (const forbidden of [USER, "named-token", SECRET, envelope.ciphertext, envelope.iv, envelope.tag, "Synthetic Person"]) expect(text).not.toContain(forbidden);
  });

  it("stops at the bound and marks the result truncated", async () => {
    useKeyEnv(ENVS.k1Only);
    for (let index = 0; index < 5; index++) seedMeta(`token-${index}`, impls.main.encrypt(SECRET, `mcp_token:${USER}:token-${index}`));
    const census = await inspectLegacyTokenCensus(db as never, keyring("next"), { kind: "all" }, 3);
    expect(census.truncated).toBe(true);
    expect(census.limitPerCollection).toBe(3);
    expect(census.collections.meta_tokens.records).toBe(3);
  });

  it("can be scoped to one user's own records without touching anyone else's", async () => {
    useKeyEnv(ENVS.k1Only);
    seedMeta("mine", impls.main.encrypt(SECRET, `mcp_token:${USER}:mine`));
    db.seed("users/synthetic-other-user/meta_tokens/theirs", { encryptedToken: encryptToken(SECRET, "mcp_token:synthetic-other-user:theirs", keyring("next")), keyVersion: "next" });
    const own = await inspectLegacyTokenCensus(db as never, keyring("next"), { kind: "user", fbUserId: USER });
    expect(own).toMatchObject({ subject: "one-user", limitPerCollection: 50, recordsNeedingNonPrimaryKey: 0 });
    expect(own.collections.meta_tokens).toMatchObject({ records: 1, decryptable: 1, byDecryptingKey: { primary: 1 } });
    const everyone = await inspectLegacyTokenCensus(db as never, keyring("next"));
    expect(everyone).toMatchObject({ subject: "all-users", recordsNeedingNonPrimaryKey: 1 });
  });
});
