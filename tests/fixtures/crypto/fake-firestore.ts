type Plain = Record<string, unknown>;
interface Stored { data: Plain; version: number }

function isPlain(value: unknown): value is Plain {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (isPlain(value)) {
    const out: Plain = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested !== undefined) out[key] = clean(nested);
    }
    return out;
  }
  return value;
}

function deepMerge(base: Plain, patch: Plain): Plain {
  const out: Plain = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlain(value) && isPlain(out[key]) ? deepMerge(out[key] as Plain, value) : value;
  }
  return out;
}

export class FakeSnapshot {
  constructor(public readonly ref: FakeDocRef, private readonly stored: Stored | undefined) {}
  get exists(): boolean { return this.stored !== undefined; }
  get id(): string { return this.ref.id; }
  data(): Plain | undefined { return this.stored ? structuredClone(this.stored.data) : undefined; }
}

export class FakeDocRef {
  constructor(private readonly db: FakeFirestore, public readonly path: string) {}
  get id(): string { return this.path.split("/").at(-1)!; }
  collection(name: string): FakeCollection { return new FakeCollection(this.db, `${this.path}/${name}`); }
  async get(): Promise<FakeSnapshot> { return new FakeSnapshot(this, this.db.docs.get(this.path)); }
  async set(data: Plain, options?: { merge?: boolean }): Promise<void> { this.db.commitWrite(this.path, "set", data, options?.merge === true); }
  async update(data: Plain): Promise<void> { this.db.commitWrite(this.path, "update", data, true); }
  async delete(): Promise<void> { this.db.deleteDoc(this.path); }
}

class FakeQuery {
  constructor(
    private readonly db: FakeFirestore,
    private readonly path: string,
    private readonly filters: Array<[string, unknown]> = [],
    private readonly max = Infinity,
  ) {}
  where(field: string, op: string, value: unknown): FakeQuery {
    if (op !== "==") throw new Error(`unsupported operator ${op}`);
    return new FakeQuery(this.db, this.path, [...this.filters, [field, value]], this.max);
  }
  limit(count: number): FakeQuery { return new FakeQuery(this.db, this.path, this.filters, count); }
  async get(): Promise<{ docs: FakeSnapshot[]; empty: boolean; size: number }> {
    const prefix = `${this.path}/`;
    const docs = [...this.db.docs.entries()]
      .filter(([path]) => path.startsWith(prefix) && path.slice(prefix.length).split("/").length === 1)
      .filter(([, stored]) => this.filters.every(([field, value]) => stored.data[field] === value))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(0, this.max)
      .map(([path, stored]) => new FakeSnapshot(new FakeDocRef(this.db, path), stored));
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

export class FakeCollection extends FakeQuery {
  constructor(private readonly owner: FakeFirestore, private readonly collectionPath: string) {
    super(owner, collectionPath);
  }
  doc(id: string): FakeDocRef { return new FakeDocRef(this.owner, `${this.collectionPath}/${id}`); }
}

export class FakeBatch {
  private readonly ops: Array<() => void> = [];
  constructor(private readonly db: FakeFirestore) {}
  update(ref: FakeDocRef, data: Plain): void { this.ops.push(() => this.db.commitWrite(ref.path, "update", data, true)); }
  set(ref: FakeDocRef, data: Plain, options?: { merge?: boolean }): void { this.ops.push(() => this.db.commitWrite(ref.path, "set", data, options?.merge === true)); }
  delete(ref: FakeDocRef): void { this.ops.push(() => this.db.deleteDoc(ref.path)); }
  async commit(): Promise<void> {
    const snapshot = new Map([...this.db.docs].map(([path, stored]) => [path, structuredClone(stored)]));
    try { for (const op of this.ops) op(); } catch (error) {
      this.db.docs.clear();
      for (const [path, stored] of snapshot) this.db.docs.set(path, stored);
      throw error;
    }
  }
}

export class FakeTransaction {
  private readonly reads = new Map<string, number | undefined>();
  private readonly writes: Array<{ ref: FakeDocRef; mode: "create" | "set" | "update" | "delete"; data?: Plain }> = [];
  constructor(private readonly db: FakeFirestore) {}
  async get(ref: FakeDocRef): Promise<FakeSnapshot> {
    const stored = this.db.docs.get(ref.path);
    this.reads.set(ref.path, stored?.version);
    return new FakeSnapshot(ref, stored);
  }
  create(ref: FakeDocRef, data: Plain): void { this.writes.push({ ref, mode: "create", data }); }
  set(ref: FakeDocRef, data: Plain): void { this.writes.push({ ref, mode: "set", data }); }
  update(ref: FakeDocRef, data: Plain): void { this.writes.push({ ref, mode: "update", data }); }
  delete(ref: FakeDocRef): void { this.writes.push({ ref, mode: "delete" }); }
  commit(): void {
    this.db.beforeCommit?.(this.writes.map((write) => write.ref.path));
    for (const [path, version] of this.reads) {
      if (this.db.docs.get(path)?.version !== version) throw new Error("ABORTED");
    }
    const snapshot = new Map([...this.db.docs].map(([path, stored]) => [path, structuredClone(stored)]));
    try {
      for (const write of this.writes) {
        if (write.mode === "create" && this.db.docs.has(write.ref.path)) throw new Error("already-exists");
        if (write.mode === "delete") this.db.deleteDoc(write.ref.path);
        else this.db.commitWrite(write.ref.path, write.mode === "update" ? "update" : "set", write.data!, write.mode === "update");
      }
    } catch (error) {
      this.db.docs.clear();
      for (const [path, stored] of snapshot) this.db.docs.set(path, stored);
      throw error;
    }
  }
}

/** Minimal in-memory Firestore double with Firestore's set/merge/update semantics and optimistic transactions. */
export class FakeFirestore {
  readonly docs = new Map<string, Stored>();
  beforeCommit: ((paths: string[]) => void) | undefined;
  writeLog: Array<{ path: string; mode: "set" | "update" | "delete" }> = [];
  failWritesTo: ((path: string) => boolean) | undefined;

  collection(name: string): FakeCollection { return new FakeCollection(this, name); }

  collectionGroup(name: string): { get: () => Promise<{ docs: FakeSnapshot[] }> } {
    return {
      get: async () => ({
        docs: [...this.docs.entries()]
          .filter(([path]) => path.split("/").length % 2 === 0 && path.split("/").at(-2) === name)
          .map(([path, stored]) => new FakeSnapshot(new FakeDocRef(this, path), stored)),
      }),
    };
  }

  batch(): FakeBatch { return new FakeBatch(this); }

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

  commitWrite(path: string, mode: "set" | "update", data: Plain, merge: boolean): void {
    if (this.failWritesTo?.(path)) throw new Error("injected write failure");
    const previous = this.docs.get(path);
    if (mode === "update" && !previous) throw new Error("not-found");
    const incoming = clean(data) as Plain;
    const next = !merge ? incoming : mode === "update" ? { ...(previous?.data ?? {}), ...incoming } : deepMerge(previous?.data ?? {}, incoming);
    this.docs.set(path, { version: (previous?.version ?? 0) + 1, data: structuredClone(next) });
    this.writeLog.push({ path, mode });
  }

  deleteDoc(path: string): void {
    if (this.failWritesTo?.(path)) throw new Error("injected write failure");
    this.docs.delete(path);
    this.writeLog.push({ path, mode: "delete" });
  }

  seed(path: string, data: Plain): void {
    this.docs.set(path, { version: (this.docs.get(path)?.version ?? 0) + 1, data: structuredClone(clean(data) as Plain) });
  }

  read(path: string): Plain | undefined {
    const stored = this.docs.get(path);
    return stored ? structuredClone(stored.data) : undefined;
  }

  async terminate(): Promise<void> {}
}
