import { createHash } from "node:crypto";
import type { Firestore } from "@google-cloud/firestore";
import { describe, expect, it } from "vitest";
import { encryptToken } from "../../src/auth/crypto.js";
import type { EncryptionKeyring } from "../../src/auth/keyring.js";
import { runPlatformCredentialKeyMigration, verifyPlatformCredentialKeyMigration } from "../../src/auth/platform-credential-key-migration.js";

type Row = { value: Record<string, unknown>; version: number };

class FakeDb {
  rows = new Map<string, Row>();
  beforeCommit?: () => void;
  ref(path: string) {
    return { path, get: async () => this.snapshot(path), update: async (patch: Record<string, unknown>) => this.write(path, patch, true),
      collection: (name: string) => this.collection(`${path}/${name}`) };
  }
  collection(path: string) {
    return { doc: (id: string) => this.ref(`${path}/${id}`) };
  }
  collectionGroup(name: string) {
    return { get: async () => ({ docs: [...this.rows.keys()].filter((path) => path.split("/").at(-2) === name).map((path) => this.snapshot(path)) }) };
  }
  snapshot(path: string) {
    const row = this.rows.get(path);
    return { ref: this.ref(path), exists: Boolean(row), data: () => row ? structuredClone(row.value) : undefined };
  }
  write(path: string, value: Record<string, unknown>, merge = false) {
    const previous = this.rows.get(path);
    this.rows.set(path, { version: (previous?.version ?? 0) + 1,
      value: structuredClone(merge ? { ...previous?.value, ...value } : value) });
  }
  async runTransaction<T>(callback: (tx: {
    get: (ref: { path: string }) => Promise<ReturnType<FakeDb["snapshot"]>>;
    create: (ref: { path: string }, value: Record<string, unknown>) => void;
    update: (ref: { path: string }, value: Record<string, unknown>) => void;
  }) => Promise<T>): Promise<T> {
    const reads = new Map<string, number | undefined>();
    const writes: Array<{ path: string; value: Record<string, unknown>; create: boolean }> = [];
    const result = await callback({
      get: async (ref) => { reads.set(ref.path, this.rows.get(ref.path)?.version); return this.snapshot(ref.path); },
      create: (ref, value) => writes.push({ path: ref.path, value, create: true }),
      update: (ref, value) => writes.push({ path: ref.path, value, create: false }),
    });
    this.beforeCommit?.();
    for (const [path, version] of reads) if (this.rows.get(path)?.version !== version) throw new Error("ABORTED");
    for (const write of writes) {
      if (write.create && this.rows.has(write.path)) throw new Error("ALREADY_EXISTS");
      if (!write.create && !this.rows.has(write.path)) throw new Error("NOT_FOUND");
    }
    for (const write of writes) this.write(write.path, write.value, !write.create);
    return result;
  }
}

const old: EncryptionKeyring = { activeKeyId: "primary", keys: new Map([["primary", Buffer.alloc(32, 1)]]) };
const dual: EncryptionKeyring = { activeKeyId: "next", keys: new Map([["primary", Buffer.alloc(32, 1)], ["next", Buffer.alloc(32, 2)]]) };
const hash = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const tenant = "staging-tenant", id = "synthetic-credential";
const path = `platform_v1/${hash(["tenants", tenant, tenant])}/credentials/${hash(["credentials", tenant, id])}`;
const identity = { id, tenantId: tenant, operatorId: "synthetic-operator", provider: "META_MARKETING", appId: "synthetic-app", envelopeVersion: 1, keyVersion: "primary" };
const aad = JSON.stringify(["lumin-platform-credential", 1, tenant, identity.operatorId, identity.provider, identity.appId, id]);
const asFirestore = (db: FakeDb) => db as unknown as Firestore;
const seeded = () => {
  const db = new FakeDb();
  db.write(path, { ...identity, payload: encryptToken("synthetic-token", aad, old) });
  return db;
};

describe("platform credential key migration", () => {
  it("dry-runs, rotates only the nested crypto key, and independently verifies", async () => {
    const db = seeded(), original = JSON.stringify(db.rows.get(path)?.value);
    const dry = await runPlatformCredentialKeyMigration({ db: asFirestore(db), keyring: dual });
    expect(dry).toMatchObject({ total: 1, candidates: 1, verified: 1, failed: 0, rotated: 0 });
    expect(JSON.stringify(db.rows.get(path)?.value)).toBe(original);
    const applied = await runPlatformCredentialKeyMigration({ db: asFirestore(db), keyring: dual, dryRun: false, operationId: "controlled-test" });
    expect(applied).toMatchObject({ total: 1, candidates: 1, rotated: 1, verified: 1, failed: 0 });
    expect(db.rows.get(path)?.value).toMatchObject({ ...identity, payload: { keyVersion: "next" } });
    expect(await verifyPlatformCredentialKeyMigration(asFirestore(db), dual)).toMatchObject({ total: 1, verified: 1, failed: 0 });
    expect(await runPlatformCredentialKeyMigration({ db: asFirestore(db), keyring: dual, dryRun: false, operationId: "second-test" }))
      .toMatchObject({ candidates: 0, alreadyCurrent: 1, verified: 1, failed: 0 });
  });

  it.each(["wrong-tenant", "wrong-doc-id", "wrong-aad", "wrong-envelope", "unknown-key", "foreign-path"])(
    "fails closed for %s without changing a credential", async (attack) => {
      const db = seeded();
      const current = structuredClone(db.rows.get(path)!.value);
      let target = path;
      if (attack === "wrong-tenant") current.tenantId = "other-tenant";
      if (attack === "wrong-doc-id") current.id = "other-id";
      if (attack === "wrong-aad") current.operatorId = "other-operator";
      if (attack === "wrong-envelope") current.keyVersion = "next";
      if (attack === "unknown-key") current.payload = { ...(current.payload as object), keyVersion: "absent" };
      if (attack === "foreign-path") target = `foreign/${hash(["tenants", tenant, tenant])}/credentials/${hash(["credentials", tenant, id])}`;
      db.rows.delete(path);
      db.write(target, current);
      const before = JSON.stringify(db.rows.get(target)?.value);
      const report = await runPlatformCredentialKeyMigration({ db: asFirestore(db), keyring: dual, dryRun: false });
      expect(report).toMatchObject({ total: 1, rotated: 0, verified: 0, failed: 1 });
      expect(JSON.stringify(db.rows.get(target)?.value)).toBe(before);
      expect(await verifyPlatformCredentialKeyMigration(asFirestore(db), dual)).toMatchObject({ failed: 1 });
    },
  );

  it("rejects a concurrent replacement before committing the migration", async () => {
    const db = seeded();
    let replaced = false;
    db.beforeCommit = () => {
      if (replaced || ![...db.rows.keys()].some((key) => key.includes("/operations/"))) return;
      replaced = true;
      db.write(path, { ...identity, payload: encryptToken("replacement", aad, old) });
    };
    const report = await runPlatformCredentialKeyMigration({ db: asFirestore(db), keyring: dual, dryRun: false });
    expect(report).toMatchObject({ total: 1, rotated: 0, verified: 0, failed: 1 });
    expect(db.rows.get(path)?.value).toMatchObject({ payload: { keyVersion: "primary" } });
    expect([...db.rows.keys()].some((key) => key.includes("/records/"))).toBe(false);
  });

  it("refuses to apply any records when discovery finds an invalid sibling", async () => {
    const db = seeded();
    db.write(`platform_v1/${hash(["tenants", tenant, tenant])}/credentials/invalid`, { ...identity, id: "invalid", payload: null });
    const report = await runPlatformCredentialKeyMigration({ db: asFirestore(db), keyring: dual, dryRun: false });
    expect(report).toMatchObject({ total: 2, candidates: 1, rotated: 0, failed: 1 });
    expect(db.rows.get(path)?.value).toMatchObject({ payload: { keyVersion: "primary" } });
  });
});
