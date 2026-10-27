import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "../../src/auth/crypto.js";
import type { EncryptionKeyring } from "../../src/auth/keyring.js";
import { runTokenKeyMigration, verifyTokenKeyMigration } from "../../src/auth/token-key-migration.js";
import { ENVS, impls, K1, K2, MAIN_GCM_AUTH_ERROR, restoreKeyEnv, useKeyEnv } from "../fixtures/crypto/compat-harness.js";
import { FakeFirestore } from "../fixtures/crypto/fake-firestore.js";

const keyring = (active: string): EncryptionKeyring => ({ activeKeyId: active, keys: new Map([["primary", K1], ["next", K2]]) });
const USER = "synthetic-rollback-user";
const path = (name: string) => `users/${USER}/meta_tokens/${name}`;
const OP = "reviewed-operation";
let db: FakeFirestore;

const metadata = { kind: "user", expiresAt: 1_900_000_000, scopes: ["ads_read"], isDefault: true, metaUserId: "1", createdAt: 5, updatedAt: 6 };

function seedMain(name: string, token: string): void {
  useKeyEnv(ENVS.k1Only);
  db.seed(path(name), { encryptedToken: impls.main.encrypt(token, `mcp_token:${USER}:${name}`), ...metadata });
}

const apply = (active: string, operationId = OP, extra: Record<string, unknown> = {}) =>
  runTokenKeyMigration({ db: db as never, keyring: keyring(active), dryRun: false, operationId, ...extra });

beforeEach(() => { db = new FakeFirestore(); });
afterEach(() => restoreKeyEnv());

describe("forward migration preserves everything except the encrypted envelope", () => {
  it("changes only the envelope, key version, updatedAt and migration metadata", async () => {
    seedMain("personal", "synthetic-token");
    const before = db.read(path("personal"))!;
    const report = await apply("next");
    expect(report).toMatchObject({ failed: 0, rotated: 1 });
    const after = db.read(path("personal"))!;
    for (const field of ["kind", "expiresAt", "scopes", "isDefault", "metaUserId", "createdAt"]) expect(after[field]).toEqual(before[field]);
    expect(Object.keys(after).sort()).toEqual([...Object.keys(before), "keyMigration", "keyVersion"].sort());
    expect(after.keyMigration).toMatchObject({ operationId: OP, fromKeyVersion: "primary", legacyAad: false });
    expect(decryptToken(after.encryptedToken as never, `mcp_token:${USER}:personal`, "next", keyring("next"))).toBe("synthetic-token");
  });

  it("re-encrypts legacy no-AAD records WITH the identity-bound AAD, which main@251249e still reads once it holds the new key", async () => {
    useKeyEnv(ENVS.k1Only);
    db.seed(path("legacy"), { encryptedToken: impls.main.encrypt("synthetic-legacy"), ...metadata });
    expect(await apply("next")).toMatchObject({ failed: 0, rotated: 1 });
    expect(db.read(path("legacy"))!.keyMigration).toMatchObject({ legacyAad: true });
    useKeyEnv(ENVS.k2Only);
    expect(impls.main.decrypt(db.read(path("legacy"))!.encryptedToken as never, `mcp_token:${USER}:legacy`)).toBe("synthetic-legacy");
  });
});

describe("compare-and-set behaviour under concurrent writers", () => {
  it("keeps the latest writer's token when a re-login lands between the read and the commit", async () => {
    seedMain("personal", "synthetic-before");
    let injected = false;
    db.beforeCommit = (paths) => {
      if (injected || !paths.includes(path("personal"))) return;
      injected = true;
      useKeyEnv(ENVS.k1Only);
      db.seed(path("personal"), { encryptedToken: impls.main.encrypt("synthetic-after-relogin", `mcp_token:${USER}:personal`), ...metadata });
    };
    expect(await apply("next")).toMatchObject({ failed: 0, rotated: 1 });
    expect(injected).toBe(true);
    const stored = db.read(path("personal"))!;
    expect(decryptToken(stored.encryptedToken as never, `mcp_token:${USER}:personal`, "next", keyring("next"))).toBe("synthetic-after-relogin");
  });

  it("does not resurrect a record that is deleted after discovery", async () => {
    seedMain("personal", "synthetic-token");
    const original = db.collectionGroup.bind(db);
    db.collectionGroup = ((name: string) => {
      const group = original(name);
      return { ...group, get: async () => { const snapshot = await group.get(); if (name === "meta_tokens") db.docs.delete(path("personal")); return snapshot; } };
    }) as never;
    const report = await apply("next");
    expect(report.failed).toBe(1);
    expect(report.rotated).toBe(0);
    expect(db.docs.has(path("personal"))).toBe(false);
    expect(db.read(`_lumin_migrations/token_encryption/operations/${OP}`)!.status).toBe("failed");
  });
});

describe("a failed or finished migration never leaves an unnoticed mixed state", () => {
  it("surfaces every record the single-key runtime cannot read through verify, and verify passes again once reversed", async () => {
    seedMain("a", "synthetic-a");
    seedMain("b", "synthetic-b");
    await apply("next");
    expect((await verifyTokenKeyMigration(db as never, keyring("primary"))).failed).toBe(2);
    useKeyEnv(ENVS.k1Only);
    expect(() => impls.main.decrypt(db.read(path("a"))!.encryptedToken as never, `mcp_token:${USER}:a`)).toThrow(MAIN_GCM_AUTH_ERROR);

    expect(await apply("primary", "reverse-operation")).toMatchObject({ failed: 0, rotated: 2 });
    expect((await verifyTokenKeyMigration(db as never, keyring("primary"))).failed).toBe(0);
    for (const name of ["a", "b"]) {
      expect(impls.main.decrypt(db.read(path(name))!.encryptedToken as never, `mcp_token:${USER}:${name}`)).toBe(`synthetic-${name}`);
    }
  });

  it("flags a record that main rewrote after the migration as off the active key", async () => {
    seedMain("personal", "synthetic-token");
    await apply("next");
    seedMain("personal", "synthetic-relogin-on-main");
    const verification = await verifyTokenKeyMigration(db as never, keyring("next"));
    expect(verification).toMatchObject({ failed: 1 });
    expect(verification.failures[0].reason).toBe("active_key_verification_failed");
  });

  it("is idempotent: a finished operation cannot be rerun and a fresh one writes no record", async () => {
    seedMain("personal", "synthetic-token");
    await apply("next");
    await expect(apply("next")).rejects.toThrow("already completed");
    db.writeLog.length = 0;
    const second = await apply("next", "second-operation");
    expect(second).toMatchObject({ failed: 0, rotated: 0, alreadyCurrent: 1 });
    expect(db.writeLog.filter((entry) => entry.path.startsWith("users/"))).toEqual([]);
  });

  it("never writes anything while only inventorying (dry run) or verifying", async () => {
    seedMain("personal", "synthetic-token");
    db.writeLog.length = 0;
    await runTokenKeyMigration({ db: db as never, keyring: keyring("next") });
    await verifyTokenKeyMigration(db as never, keyring("next"));
    expect(db.writeLog).toEqual([]);
  });

  it("refuses to apply under a keyring that cannot decrypt the corpus, writing nothing", async () => {
    seedMain("personal", "synthetic-token");
    const wrong: EncryptionKeyring = { activeKeyId: "next", keys: new Map([["primary", Buffer.alloc(32, 9)], ["next", K2]]) };
    const before = db.read(path("personal"));
    const report = await runTokenKeyMigration({ db: db as never, keyring: wrong, dryRun: false, operationId: "wrong-keyring-op" });
    expect(report).toMatchObject({ failed: 1, rotated: 0 });
    expect(db.read(path("personal"))).toEqual(before);
    expect(encryptToken("x", undefined, wrong).keyVersion).toBe("next");
  });
});
