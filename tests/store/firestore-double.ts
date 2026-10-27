import type { Firestore } from "@google-cloud/firestore";

type Data = Record<string, unknown>;

interface WriteOptions {
  merge?: boolean;
}

export interface FirestoreDouble {
  db: Firestore;
  /** Every stored document keyed by its full path, for assertions and for seeding legacy data. */
  data: Map<string, Data>;
}

/**
 * In-memory stand-in for the slice of Firestore the auth stores use: documents,
 * sub-collections, equality queries, batches and serialized transactions.
 * `update` on a missing document throws, as the real client does.
 */
export function createFirestoreDouble(options: { writeLatencyMs?: number } = {}): FirestoreDouble {
  const data = new Map<string, Data>();
  const delay = () =>
    options.writeLatencyMs ? new Promise<void>((resolve) => setTimeout(resolve, options.writeLatencyMs)) : undefined;
  let transactionTail: Promise<unknown> = Promise.resolve();

  const lastSegment = (path: string) => path.split("/").at(-1)!;
  const clone = <T>(value: T): T => structuredClone(value);
  const dropUndefined = (value: Data): Data =>
    Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));

  function snapshot(path: string) {
    return {
      exists: data.has(path),
      id: lastSegment(path),
      ref: docRef(path),
      data: () => (data.has(path) ? clone(data.get(path)) : undefined),
    };
  }

  function writeSet(path: string, value: Data, options?: WriteOptions): void {
    const next = dropUndefined(clone(value));
    data.set(path, options?.merge ? { ...(data.get(path) ?? {}), ...next } : next);
  }

  function writeUpdate(path: string, fields: Data): void {
    if (!data.has(path)) {
      throw Object.assign(new Error(`NOT_FOUND: no document to update: ${path}`), { code: 5 });
    }
    data.set(path, { ...data.get(path)!, ...dropUndefined(clone(fields)) });
  }

  function docRef(path: string): any {
    return {
      id: lastSegment(path),
      path,
      collection: (name: string) => collectionRef(`${path}/${name}`),
      get: async () => snapshot(path),
      set: async (value: Data, writeOptions?: WriteOptions) => {
        await delay();
        writeSet(path, value, writeOptions);
      },
      update: async (fields: Data) => writeUpdate(path, fields),
      delete: async () => {
        data.delete(path);
      },
    };
  }

  function children(path: string, filters: Array<[string, unknown]>, max: number) {
    const depth = path.split("/").length + 1;
    const docs = [...data.keys()]
      .filter((p) => p.startsWith(`${path}/`) && p.split("/").length === depth)
      .filter((p) => filters.every(([field, expected]) => data.get(p)?.[field] === expected))
      .sort()
      .slice(0, max)
      .map((p) => snapshot(p));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }

  function query(path: string, filters: Array<[string, unknown]> = [], max = Infinity): any {
    return {
      where: (field: string, op: string, value: unknown) => {
        if (op !== "==") throw new Error(`unsupported operator in test double: ${op}`);
        return query(path, [...filters, [field, value]], max);
      },
      limit: (n: number) => query(path, filters, n),
      get: async () => children(path, filters, max),
    };
  }

  function collectionRef(path: string): any {
    return {
      ...query(path),
      id: lastSegment(path),
      path,
      doc: (id: string) => docRef(`${path}/${id}`),
    };
  }

  const db = {
    collection: (name: string) => collectionRef(name),
    batch: () => {
      const operations: Array<() => void> = [];
      return {
        update: (ref: { path: string }, fields: Data) => {
          operations.push(() => writeUpdate(ref.path, fields));
        },
        set: (ref: { path: string }, value: Data, options?: WriteOptions) => {
          operations.push(() => writeSet(ref.path, value, options));
        },
        delete: (ref: { path: string }) => {
          operations.push(() => {
            data.delete(ref.path);
          });
        },
        commit: async () => {
          for (const operation of operations) operation();
        },
      };
    },
    runTransaction: <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
      const run = transactionTail.then(async () => {
        const pending: Array<() => void> = [];
        const result = await work({
          get: async (ref: { path: string }) => snapshot(ref.path),
          set: (ref: { path: string }, value: Data, options?: WriteOptions) => {
            pending.push(() => writeSet(ref.path, value, options));
          },
          update: (ref: { path: string }, fields: Data) => {
            pending.push(() => writeUpdate(ref.path, fields));
          },
          delete: (ref: { path: string }) => {
            pending.push(() => {
              data.delete(ref.path);
            });
          },
        });
        for (const operation of pending) operation();
        return result;
      });
      transactionTail = run.catch(() => undefined);
      return run;
    },
  };

  return { db: db as unknown as Firestore, data };
}
