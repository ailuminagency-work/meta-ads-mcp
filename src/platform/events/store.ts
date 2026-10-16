import { createHash, randomUUID } from "node:crypto";
import type { Firestore } from "@google-cloud/firestore";
import type { AssetBinding, ClaimedEvent, EventStore, NormalizedEvent, StoredEvent } from "./types.js";
import { scopeKey } from "./types.js";

export interface AtomicTransaction {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): void;
}
export interface AtomicDatabase {
  transaction<T>(run: (transaction: AtomicTransaction) => Promise<T>): Promise<T>;
  due(scope: AssetBinding, now: number, limit: number): Promise<StoredEvent[]>;
}

function eventKey(scope: AssetBinding, id: string): string {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("invalid_event_id");
  return "event_" + createHash("sha256").update(scopeKey(scope) + id).digest("hex");
}
function checkpointKey(scope: AssetBinding, adapter: string): string {
  return "checkpoint_" + createHash("sha256").update(scopeKey(scope) + JSON.stringify(adapter)).digest("hex");
}

export class TransactionalEventStore implements EventStore {
  constructor(private readonly database: AtomicDatabase) {}

  async due(scope: AssetBinding, now: number, limit: number): Promise<string[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("invalid_due_limit");
    const records = await this.database.due(scope, now, limit);
    return records.filter(record => scopeKey(record.event) === scopeKey(scope) && record.event.expiresAt > now).map(record => record.event.id);
  }

  async enqueue(events: NormalizedEvent[]): Promise<{ inserted: number; duplicates: number }> {
    if (!events.length || events.length > 100) throw new Error("invalid_event_batch_size");
    return this.database.transaction(async tx => {
      const unique = new Map(events.map(event => [eventKey(event, event.id), event]));
      const existing = await Promise.all([...unique.keys()].map(key => tx.get<StoredEvent>(key)));
      let inserted = 0;
      [...unique.entries()].forEach(([key, event], index) => {
        if (existing[index]) return;
        tx.set<StoredEvent>(key, { event, status: "pending", attempts: 0, nextAttemptAt: event.receivedAt });
        inserted++;
      });
      return { inserted, duplicates: events.length - inserted };
    });
  }

  async claim(scope: AssetBinding, id: string, now: number, leaseMs: number): Promise<ClaimedEvent | null> {
    if (!Number.isFinite(leaseMs) || leaseMs < 1000 || leaseMs > 300_000) throw new Error("invalid_lease");
    return this.database.transaction(async tx => {
      const key = eventKey(scope, id), record = await tx.get<StoredEvent>(key);
      if (!record || record.event.expiresAt <= now || record.status === "delivered" || record.status === "dead_letter" || record.nextAttemptAt > now || (record.status === "processing" && (record.leaseUntil ?? 0) > now)) return null;
      const leaseToken = randomUUID();
      const claimed: StoredEvent = { ...record, status: "processing", attempts: record.attempts + 1, leaseUntil: now + leaseMs, leaseToken };
      tx.set(key, claimed);
      return { record: claimed, leaseToken };
    });
  }

  async finish(scope: AssetBinding, id: string, leaseToken: string, now: number, outcome: "delivered" | "retry" | "dead_letter", nextAttemptAt = now, adapterId = "default"): Promise<boolean> {
    return this.database.transaction(async tx => {
      const key = eventKey(scope, id), record = await tx.get<StoredEvent>(key);
      if (!record || record.status !== "processing" || record.leaseToken !== leaseToken || (record.leaseUntil ?? 0) <= now || record.event.expiresAt <= now) return false;
      const finished = { ...record, status: outcome, nextAttemptAt };
      delete finished.leaseToken;
      delete finished.leaseUntil;
      if (outcome !== "delivered") finished.lastErrorCode = "adapter_failed";
      tx.set(key, finished);
      if (outcome === "delivered") tx.set(checkpointKey(scope, adapterId), { id, completedAt: now });
      return true;
    });
  }

  async replay(scope: AssetBinding, id: string, now: number): Promise<boolean> {
    return this.database.transaction(async tx => {
      const key = eventKey(scope, id), record = await tx.get<StoredEvent>(key);
      if (!record || record.event.expiresAt <= now || record.status !== "dead_letter") return false;
      tx.set(key, { ...record, status: "retry", attempts: 0, nextAttemptAt: now });
      return true;
    });
  }

  checkpoint(scope: AssetBinding, adapterId: string): Promise<string | null> {
    return this.database.transaction(async tx => (await tx.get<{ id: string }>(checkpointKey(scope, adapterId)))?.id ?? null);
  }
}

export function firestoreEventDatabase(firestore: Firestore): AtomicDatabase {
  const collection = firestore.collection("platform_webhook_events");
  return {
    due: async (scope, now, limit) => {
      const base = collection.where("event.tenantId", "==", scope.tenantId).where("event.clientId", "==", scope.clientId).where("event.product", "==", scope.product).where("event.assetId", "==", scope.assetId);
      const pending = base.where("status", "in", ["pending", "retry"]).where("nextAttemptAt", "<=", now).orderBy("nextAttemptAt").limit(limit);
      const expired = base.where("status", "==", "processing").where("leaseUntil", "<=", now).orderBy("leaseUntil").limit(limit);
      const results = await Promise.all([pending.get(), expired.get()]);
      return results.flatMap(result => result.docs.map(doc => doc.data() as StoredEvent)).filter(record => record.event.expiresAt > now).slice(0, limit);
    },
    transaction: run => firestore.runTransaction(async transaction => run({
    get: async <T>(key: string): Promise<T | null> => {
      const snapshot = await transaction.get(collection.doc(key));
      return snapshot.exists ? snapshot.data() as T : null;
    },
    set: <T>(key: string, value: T): void => {
      const record = value as Record<string, unknown>;
      const expiresAt = (record.event as NormalizedEvent | undefined)?.expiresAt;
      transaction.set(collection.doc(key), { ...record, ...(expiresAt === undefined ? {} : { expireTime: new Date(expiresAt) }) });
    },
  })) };
}

export class InMemoryAtomicDatabase implements AtomicDatabase {
  private records = new Map<string, unknown>();
  private tail: Promise<unknown> = Promise.resolve();
  async due(scope: AssetBinding, now: number, limit: number): Promise<StoredEvent[]> {
    await this.tail;
    return [...this.records.values()].filter((value): value is StoredEvent => {
      const record = value as StoredEvent;
      return !!record.event && scopeKey(record.event) === scopeKey(scope) && record.event.expiresAt > now && record.nextAttemptAt <= now && (["pending", "retry"].includes(record.status) || (record.status === "processing" && (record.leaseUntil ?? 0) <= now));
    }).slice(0, limit).map(record => structuredClone(record));
  }
  transaction<T>(run: (transaction: AtomicTransaction) => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const snapshot = new Map(this.records);
      const value = await run({
        get: async <V>(key: string): Promise<V | null> => structuredClone(snapshot.get(key) as V ?? null),
        set: <V>(key: string, value: V): void => { snapshot.set(key, structuredClone(value)); },
      });
      this.records = snapshot;
      return value;
    });
    this.tail = result.catch(() => {});
    return result;
  }
}
