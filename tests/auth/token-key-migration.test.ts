import { afterEach, describe, expect, it } from "vitest";
import {
  decryptToken,
  encryptToken,
  resetKeyCacheForTests,
} from "../../src/auth/crypto.js";
import {
  runTokenKeyMigration,
  verifyTokenKeyMigration,
} from "../../src/auth/token-key-migration.js";
import type { EncryptionKeyring } from "../../src/auth/keyring.js";

type StoredDoc = { data: Record<string, unknown>; version: number };

class FakeSnapshot {
  constructor(
    public readonly ref: FakeDocRef,
    private readonly stored: StoredDoc | undefined,
  ) {}

  get exists(): boolean {
    return this.stored !== undefined;
  }

  data(): Record<string, unknown> | undefined {
    return this.stored ? structuredClone(this.stored.data) : undefined;
  }
}

class FakeDocRef {
  constructor(
    private readonly db: FakeFirestore,
    public readonly path: string,
  ) {}

  get id(): string {
    return this.path.split("/").at(-1)!;
  }

  collection(name: string): FakeCollection {
    return new FakeCollection(this.db, `${this.path}/${name}`);
  }

  async get(): Promise<FakeSnapshot> {
    return new FakeSnapshot(this, this.db.docs.get(this.path));
  }

  async set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void> {
    this.db.write(this.path, data, options?.merge ?? false);
  }

  async update(data: Record<string, unknown>): Promise<void> {
    if (!this.db.docs.has(this.path)) throw new Error("not-found");
    this.db.write(this.path, data, true);
  }
}

class FakeCollection {
  constructor(
    private readonly db: FakeFirestore,
    private readonly path: string,
  ) {}

  doc(id: string): FakeDocRef {
    return new FakeDocRef(this.db, `${this.path}/${id}`);
  }

  async get(): Promise<{ docs: FakeSnapshot[]; empty: boolean }> {
    const prefix = `${this.path}/`;
    const docs = [...this.db.docs.entries()]
      .filter(([path]) => path.startsWith(prefix) && path.slice(prefix.length).split("/").length === 1)
      .map(([path, stored]) => new FakeSnapshot(new FakeDocRef(this.db, path), stored));
    return { docs, empty: docs.length === 0 };
  }
}

class FakeTransaction {
  private readonly reads = new Map<string, number | undefined>();
  private readonly writes: Array<{ ref: FakeDocRef; data: Record<string, unknown>; mode: "create" | "set" | "update" }> = [];

  constructor(private readonly db: FakeFirestore) {}

  async get(ref: FakeDocRef): Promise<FakeSnapshot> {
    const stored = this.db.docs.get(ref.path);
    this.reads.set(ref.path, stored?.version);
    return new FakeSnapshot(ref, stored);
  }

  create(ref: FakeDocRef, data: Record<string, unknown>): void {
    this.writes.push({ ref, data, mode: "create" });
  }

  set(ref: FakeDocRef, data: Record<string, unknown>): void {
    this.writes.push({ ref, data, mode: "set" });
  }

  update(ref: FakeDocRef, data: Record<string, unknown>): void {
    this.writes.push({ ref, data, mode: "update" });
  }

  commit(): void {
    this.db.beforeCommit?.(this.writes.map((write) => write.ref.path));
    for (const [path, version] of this.reads) {
      if (this.db.docs.get(path)?.version !== version) throw new Error("ABORTED");
    }
    for (const write of this.writes) {
      if (write.mode === "create" && this.db.docs.has(write.ref.path)) throw new Error("already-exists");
      this.db.write(write.ref.path, write.data, write.mode !== "create");
    }
  }
}

class FakeFirestore {
  readonly docs = new Map<string, StoredDoc>();
  beforeCommit: ((paths: string[]) => void) | undefined;

  collection(name: string): FakeCollection {
    return new FakeCollection(this, name);
  }

  collectionGroup(name: string): { get: () => Promise<{ docs: FakeSnapshot[] }> } {
    return {
      get: async () => ({
        docs: [...this.docs.entries()]
          .filter(([path]) => path.split("/").at(-2) === name)
          .map(([path, stored]) => new FakeSnapshot(new FakeDocRef(this, path), stored)),
      }),
    };
  }

  async runTransaction<T>(callback: (transaction: FakeTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const transaction = new FakeTransaction(this);
      try {
        const result = await callback(transaction);
        transaction.commit();
        return result;
      } catch (error) {
        if (error instanceof Error && error.message === "ABORTED" && attempt < 4) continue;
        throw error;
      }
    }
    throw new Error("transaction retry limit exceeded");
  }

  write(path: string, data: Record<string, unknown>, merge: boolean): void {
    const previous = this.docs.get(path);
    this.docs.set(path, {
      version: (previous?.version ?? 0) + 1,
      data: merge ? { ...(previous?.data ?? {}), ...structuredClone(data) } : structuredClone(data),
    });
  }

  async terminate(): Promise<void> {}
}

const oldKeyring: EncryptionKeyring = {
  activeKeyId: "primary",
  keys: new Map([["primary", Buffer.alloc(32, 1)]]),
};

const dualKeyring: EncryptionKeyring = {
  activeKeyId: "next",
  keys: new Map([
    ["primary", Buffer.alloc(32, 1)],
    ["next", Buffer.alloc(32, 2)],
  ]),
};

function asFirestore(db: FakeFirestore) {
  return db as unknown as import("@google-cloud/firestore").Firestore;
}

function seedMeta(db: FakeFirestore, name: string, payload: Record<string, unknown>): FakeDocRef {
  const ref = db.collection("users").doc("user-a").collection("meta_tokens").doc(name);
  db.write(ref.path, payload, false);
  return ref;
}

describe("controlled token encryption migration", () => {
  afterEach(() => resetKeyCacheForTests());

  it("keeps dry-run read-only and validates legacy decryptability", async () => {
    const db = new FakeFirestore();
    const ref = seedMeta(db, "legacy", {
      encryptedToken: encryptToken("legacy-token", undefined, oldKeyring),
      kind: "system_user",
    });
    const before = await ref.get();

    const report = await runTokenKeyMigration({ db: asFirestore(db), keyring: dualKeyring });
    const after = await ref.get();

    expect(report.dryRun).toBe(true);
    expect(report.candidates).toBe(1);
    expect(report.failed).toBe(0);
    expect(after.data()).toEqual(before.data());
    expect([...db.docs.keys()].some((path) => path.startsWith("_lumin_migrations/"))).toBe(false);
  });

  it("migrates all supported credential collections and verifies with the active key", async () => {
    const db = new FakeFirestore();
    const meta = seedMeta(db, "legacy", {
      encryptedToken: encryptToken("meta-token", undefined, oldKeyring),
      kind: "system_user",
    });
    const apify = db.collection("users").doc("user-a").collection("apify_tokens").doc("default");
    db.write(apify.path, { encryptedToken: encryptToken("apify-token", "apify_token:user-a:default", oldKeyring) }, false);
    const gemini = db.collection("users").doc("user-a").collection("gemini_keys").doc("default");
    db.write(gemini.path, {
      encryptedKey: encryptToken("gemini-key", "gemini_key:user-a:default", dualKeyring),
      keyVersion: "next",
    }, false);

    const report = await runTokenKeyMigration({
      db: asFirestore(db),
      keyring: dualKeyring,
      dryRun: false,
      operationId: "op-supported-collections",
    });
    expect(report.failed).toBe(0);
    expect(report.rotated).toBe(2);
    expect(report.alreadyCurrent).toBe(1);

    const metaAfter = (await meta.get()).data()!;
    expect(metaAfter.keyVersion).toBe("next");
    expect((metaAfter.encryptedToken as { keyVersion?: string }).keyVersion).toBe("next");
    expect(decryptToken(metaAfter.encryptedToken as never, "mcp_token:user-a:legacy", "next", dualKeyring)).toBe("meta-token");
    expect((await verifyTokenKeyMigration(asFirestore(db), dualKeyring)).failed).toBe(0);
  });

  it("recovers from a partial failure by resuming the same operation", async () => {
    const db = new FakeFirestore();
    seedMeta(db, "good", { encryptedToken: encryptToken("good-token", undefined, oldKeyring) });
    seedMeta(db, "bad", { encryptedToken: { ciphertext: "bad", iv: "bad", tag: "bad" } });

    const first = await runTokenKeyMigration({
      db: asFirestore(db),
      keyring: dualKeyring,
      dryRun: false,
      operationId: "op-recovery",
    });
    expect(first.failed).toBe(1);
    expect(first.rotated).toBe(1);

    const bad = db.collection("users").doc("user-a").collection("meta_tokens").doc("bad");
    await bad.set({ encryptedToken: encryptToken("recovered-token", undefined, oldKeyring) });
    const second = await runTokenKeyMigration({
      db: asFirestore(db),
      keyring: dualKeyring,
      dryRun: false,
      operationId: "op-recovery",
      resume: true,
    });
    expect(second.failed).toBe(0);
    expect(second.verified).toBe(2);
    expect((await verifyTokenKeyMigration(asFirestore(db), dualKeyring)).failed).toBe(0);
  });

  it("retries a transaction when a concurrent writer changes the record", async () => {
    const db = new FakeFirestore();
    const ref = seedMeta(db, "concurrent", { encryptedToken: encryptToken("original", undefined, oldKeyring) });
    let injected = false;
    db.beforeCommit = (paths) => {
      if (injected || !paths.includes(ref.path)) return;
      injected = true;
      db.write(ref.path, { encryptedToken: encryptToken("latest-writer", undefined, oldKeyring) }, true);
    };

    const report = await runTokenKeyMigration({
      db: asFirestore(db),
      keyring: dualKeyring,
      dryRun: false,
      operationId: "op-concurrency",
    });
    expect(injected).toBe(true);
    expect(report.failed).toBe(0);
    const after = (await ref.get()).data()!;
    expect(decryptToken(after.encryptedToken as never, "mcp_token:user-a:concurrent", "next", dualKeyring)).toBe("latest-writer");
  });
});
