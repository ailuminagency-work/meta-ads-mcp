import { beforeEach, describe, expect, it } from "vitest";
import { decryptToken, encryptToken, type EncryptedPayload } from "../../src/auth/crypto.js";
import type { EncryptionKeyring } from "../../src/auth/keyring.js";
import { runTokenKeyMigration, verifyTokenKeyMigration } from "../../src/auth/token-key-migration.js";
import { K1, K2, K3 } from "../fixtures/crypto/compat-harness.js";
import { FakeFirestore } from "../fixtures/crypto/fake-firestore.js";

const USER = "synthetic-label-user";
const OP = "label-operation";
const path = (name: string) => `users/${USER}/meta_tokens/${name}`;
const aad = (name: string) => `mcp_token:${USER}:${name}`;
const keyring = (active: string): EncryptionKeyring => ({ activeKeyId: active, keys: new Map([["primary", K1], ["next", K2]]) });
const only = (id: string, key: Buffer): EncryptionKeyring => ({ activeKeyId: id, keys: new Map([[id, key]]) });
const metadata = { kind: "user", expiresAt: 1_900_000_000, scopes: ["ads_read"], isDefault: true, metaUserId: "1", createdAt: 5, updatedAt: 6 };

let db: FakeFirestore;

function envelope(token: string, name: string, key: Buffer, innerLabel: string | undefined, bindIdentity = true): EncryptedPayload {
  const sealed = encryptToken(token, bindIdentity ? aad(name) : undefined, only("sealing", key));
  const { keyVersion: _unused, ...bare } = sealed;
  return innerLabel === undefined ? bare : { ...bare, keyVersion: innerLabel };
}

function seed(name: string, payload: EncryptedPayload, outerLabel: string | undefined): void {
  db.seed(path(name), { encryptedToken: payload, ...(outerLabel === undefined ? {} : { keyVersion: outerLabel }), ...metadata });
}

const dryRun = (active: string) => runTokenKeyMigration({ db: db as never, keyring: keyring(active), dryRun: true });
const apply = (active: string, extra: Record<string, unknown> = {}) =>
  runTokenKeyMigration({ db: db as never, keyring: keyring(active), dryRun: false, operationId: OP, ...extra });
const ledgerRecords = () => [...db.docs.keys()].filter((p) => p.startsWith(`_lumin_migrations/token_encryption/operations/${OP}/records/`));

beforeEach(() => { db = new FakeFirestore(); });

describe("migration tolerates a stored outer keyVersion that disagrees with the envelope, like the runtime read path", () => {
  const CASES: Array<{ title: string; sealedWith: Buffer; from: string; inner: string | undefined; outer: string | undefined; target: string }> = [
    { title: "versionless envelope sealed with the primary key, outer label says next", sealedWith: K1, from: "primary", inner: undefined, outer: "next", target: "next" },
    { title: "versionless envelope sealed with the next key, outer label says primary", sealedWith: K2, from: "next", inner: undefined, outer: "primary", target: "next" },
    { title: "inner label primary and correct, outer label says next", sealedWith: K1, from: "primary", inner: "primary", outer: "next", target: "next" },
    { title: "inner label next and correct, outer label says primary (reverse migration)", sealedWith: K2, from: "next", inner: "next", outer: "primary", target: "primary" },
    { title: "inner label is the wrong one and the outer label is the right one", sealedWith: K2, from: "next", inner: "primary", outer: "next", target: "primary" },
    { title: "versionless envelope sealed with the primary key and no outer label", sealedWith: K1, from: "primary", inner: undefined, outer: undefined, target: "next" },
  ];

  for (const c of CASES) {
    it(`${c.title}: dry run verifies, apply rewrites both labels, verify passes`, async () => {
      seed("personal", envelope("synthetic-token", "personal", c.sealedWith, c.inner), c.outer);

      const preview = await dryRun(c.target);
      expect(preview).toMatchObject({ failed: 0, verified: 1, total: 1 });
      expect(preview.failures).toEqual([]);
      expect(db.writeLog).toEqual([]);

      const report = await apply(c.target);
      expect(report).toMatchObject({ failed: 0, rotated: 1, verified: 1 });
      const stored = db.read(path("personal"))!;
      expect(stored.keyVersion).toBe(c.target);
      expect((stored.encryptedToken as EncryptedPayload).keyVersion).toBe(c.target);
      expect(stored.keyMigration).toMatchObject({ operationId: OP, fromKeyVersion: c.from, legacyAad: false });
      expect(decryptToken(stored.encryptedToken as EncryptedPayload, aad("personal"), c.target, keyring(c.target))).toBe("synthetic-token");
      expect((await verifyTokenKeyMigration(db as never, keyring(c.target))).failed).toBe(0);
    });
  }

  it("keeps every unrelated field of the document", async () => {
    seed("personal", envelope("synthetic-token", "personal", K1, undefined), "next");
    const before = db.read(path("personal"))!;
    await apply("next");
    const after = db.read(path("personal"))!;
    for (const field of ["kind", "expiresAt", "scopes", "isDefault", "metaUserId", "createdAt"]) expect(after[field]).toEqual(before[field]);
    expect(Object.keys(after).sort()).toEqual([...Object.keys(before), "keyMigration"].sort());
  });

  it("legacy no-AAD ciphertext with a versionless envelope and a lying outer label is re-sealed with the identity AAD", async () => {
    seed("legacy", envelope("synthetic-legacy", "legacy", K1, undefined, false), "next");
    expect(await dryRun("next")).toMatchObject({ failed: 0, verified: 1 });
    expect(await apply("next")).toMatchObject({ failed: 0, rotated: 1 });
    const stored = db.read(path("legacy"))!;
    expect(stored.keyMigration).toMatchObject({ legacyAad: true, fromKeyVersion: "primary" });
    expect(decryptToken(stored.encryptedToken as EncryptedPayload, aad("legacy"), "next", keyring("next"))).toBe("synthetic-legacy");
  });

  it("a single bad record does not stop the good ones, and the good one is rewritten", async () => {
    seed("good", envelope("synthetic-good", "good", K1, undefined), "next");
    seed("bad", envelope("synthetic-bad", "bad", K3, undefined), "next");
    const report = await apply("next");
    expect(report).toMatchObject({ failed: 1, rotated: 1 });
    expect((db.read(path("good"))!.encryptedToken as EncryptedPayload).keyVersion).toBe("next");
    expect(db.read(path("bad"))!.keyVersion).toBe("next");
    expect((db.read(path("bad"))!.encryptedToken as EncryptedPayload).keyVersion).toBeUndefined();
  });
});

describe("migration still fails closed and writes nothing for a record no keyring key can authenticate", () => {
  const BAD: Array<{ title: string; payload: () => EncryptedPayload; outer: string | undefined }> = [
    { title: "sealed with a key that is not in the keyring, versionless, outer label disagrees", payload: () => envelope("synthetic-t", "personal", K3, undefined), outer: "next" },
    { title: "sealed with a key that is not in the keyring, inner and outer labels disagree", payload: () => envelope("synthetic-t", "personal", K3, "primary"), outer: "next" },
    { title: "sealed with a key that is not in the keyring, no labels at all", payload: () => envelope("synthetic-t", "personal", K3, undefined), outer: undefined },
    { title: "tampered tag with disagreeing labels", payload: () => { const e = envelope("synthetic-t", "personal", K1, "primary"); return { ...e, tag: Buffer.alloc(16, 7).toString("base64") }; }, outer: "next" },
    { title: "tampered ciphertext with a versionless envelope and a lying outer label", payload: () => { const e = envelope("synthetic-t", "personal", K1, undefined); const bytes = Buffer.from(e.ciphertext, "base64"); bytes[0] ^= 1; return { ...e, ciphertext: bytes.toString("base64") }; }, outer: "next" },
    { title: "sealed for a different identity (wrong AAD) with disagreeing labels", payload: () => envelope("synthetic-t", "someone-else", K1, "primary"), outer: "next" },
    { title: "non-string inner version with a lying outer label", payload: () => ({ ...envelope("synthetic-t", "personal", K1, undefined), keyVersion: 7 as unknown as string }), outer: "next" },
    { title: "declared version that is not in the keyring and cannot be bypassed when labels agree", payload: () => envelope("synthetic-t", "personal", K1, "retired"), outer: "retired" },
    { title: "labels agree on a key that does not match the ciphertext: the declared key is honoured, no other key is tried", payload: () => envelope("synthetic-t", "personal", K2, "primary"), outer: "primary" },
  ];

  for (const c of BAD) {
    it(`${c.title}`, async () => {
      seed("personal", c.payload(), c.outer);
      const snapshot = structuredClone(db.read(path("personal")));

      const preview = await dryRun("next");
      expect(preview.failed).toBe(1);
      expect(preview.verified).toBe(0);
      expect(preview.failures).toEqual([{ recordId: expect.stringMatching(/^[0-9a-f]{16}$/), reason: "decrypt_failed" }]);
      expect(db.writeLog).toEqual([]);

      const report = await apply("next");
      expect(report).toMatchObject({ failed: 1, rotated: 0, verified: 0 });
      expect(report.failures).toEqual([{ recordId: expect.stringMatching(/^[0-9a-f]{16}$/), reason: "record_failed" }]);
      expect(db.read(path("personal"))).toEqual(snapshot);
      expect(db.writeLog.map((w) => w.path)).not.toContain(path("personal"));
      expect(ledgerRecords()).toEqual([]);
      expect(db.read(`_lumin_migrations/token_encryption/operations/${OP}`)!.status).toBe("failed");
    });
  }

  it("an unreadable record with agreeing labels on the declared key leaves the failure code and message free of values", async () => {
    seed("personal", envelope("synthetic-secret-plaintext", "personal", K3, undefined), "next");
    const report = await apply("next");
    expect(JSON.stringify(report)).not.toContain("synthetic-secret-plaintext");
    expect(JSON.stringify(report)).not.toContain(USER);
  });
});
