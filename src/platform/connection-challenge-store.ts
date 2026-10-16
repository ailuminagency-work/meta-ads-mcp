import type { Firestore } from "@google-cloud/firestore";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { ConnectionChallenge, ConnectionChallengeStore } from "./connection-profiles.js";
import { PlatformDenied } from "./models.js";
import { canonicalJson } from "./policy.js";

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const redirectUri = z.string().max(2048).refine(value => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && (!url.port || url.port === "443"); }
  catch { return false; }
});
const bindingSchema = z.object({ principal: z.object({ operatorId: identifier, tenantId: identifier }).strict(), clientId: identifier, profileId: identifier, profileHash: digest, redirectUri }).strict();
const challengeSchema = bindingSchema.extend({ id: digest, nonceHash: digest, expiresAt: timestamp, consumedAt: timestamp.nullable() }).strict();
type ExpectedChallenge = Omit<ConnectionChallenge, "id" | "nonceHash" | "expiresAt" | "consumedAt">;

export interface ChallengeTransaction {
  get(id: string): Promise<unknown | null>;
  create(id: string, record: ConnectionChallenge): void;
  consume(id: string, consumedAt: number): void;
}
export interface ChallengeDatabase { transaction<T>(run: (tx: ChallengeTransaction) => Promise<T>): Promise<T> }

export class TransactionalConnectionChallengeStore implements ConnectionChallengeStore {
  constructor(private readonly database: ChallengeDatabase, private readonly clock: () => number = Date.now) {}

  async create(input: ConnectionChallenge): Promise<void> {
    const parsed = challengeSchema.safeParse(input), now = this.clock();
    if (!parsed.success || !Number.isSafeInteger(now) || now <= 0 || parsed.data.consumedAt !== null || parsed.data.expiresAt <= now || parsed.data.expiresAt > now + 600000) throw new PlatformDenied("INVALID_CONNECTION_CHALLENGE_RECORD");
    const record = parsed.data;
    await this.database.transaction(async tx => {
      if (await tx.get(record.id)) throw new PlatformDenied("CONNECTION_CHALLENGE_ALREADY_EXISTS");
      const commitTime = this.clock();
      if (!Number.isSafeInteger(commitTime) || commitTime <= 0 || record.expiresAt <= commitTime || record.expiresAt > commitTime + 600000) throw new PlatformDenied("INVALID_CONNECTION_CHALLENGE_RECORD");
      tx.create(record.id, record);
    });
  }

  async consume(id: string, nonceHash: string, expected: ExpectedChallenge, now: number): Promise<ConnectionChallenge | null> {
    const binding = bindingSchema.safeParse(expected), actualNow = this.clock();
    if (!digest.safeParse(id).success || !digest.safeParse(nonceHash).success || !binding.success || !Number.isSafeInteger(now) || !Number.isSafeInteger(actualNow) || now <= 0 || actualNow <= 0 || Math.abs(now - actualNow) > 60000) throw new PlatformDenied("INVALID_CONNECTION_CHALLENGE_LOOKUP");
    return this.database.transaction(async tx => {
      const stored = await tx.get(id);
      const transactionNow = this.clock();
      if (!Number.isSafeInteger(transactionNow) || transactionNow <= 0 || Math.abs(now - transactionNow) > 60000) throw new PlatformDenied("INVALID_CONNECTION_CHALLENGE_LOOKUP");
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
      const { expireTime: ignoredTtl, ...value } = stored as Record<string, unknown>;
      void ignoredTtl;
      const parsed = challengeSchema.safeParse(value);
      if (!parsed.success) return null;
      const record = parsed.data;
      if (record.id !== id || !timingSafeEqual(Buffer.from(record.nonceHash, "hex"), Buffer.from(nonceHash, "hex")) || record.consumedAt !== null || record.expiresAt <= Math.max(now, transactionNow) || record.expiresAt > transactionNow + 600000) return null;
      const { id: ignoredId, nonceHash: ignoredNonce, expiresAt: ignoredExpiry, consumedAt: ignoredConsumed, ...storedBinding } = record;
      void ignoredId; void ignoredNonce; void ignoredExpiry; void ignoredConsumed;
      if (canonicalJson(storedBinding) !== canonicalJson(binding.data)) return null;
      tx.consume(id, Math.max(now, transactionNow));
      return { ...record, consumedAt: Math.max(now, transactionNow) };
    });
  }
}

function firestoreDatabase(db: Firestore): ChallengeDatabase {
  const collection = db.collection("platform_connection_challenges");
  return { transaction: run => db.runTransaction(async transaction => run({
    get: async id => { const snapshot = await transaction.get(collection.doc(id)); return snapshot.exists ? snapshot.data() : null; },
    create: (id, record) => { transaction.create(collection.doc(id), { ...record, expireTime: new Date(record.expiresAt) }); },
    consume: (id, consumedAt) => { transaction.update(collection.doc(id), { consumedAt }); },
  })) };
}

export class FirestoreConnectionChallengeStore extends TransactionalConnectionChallengeStore {
  constructor(db: Firestore, clock: () => number = Date.now) { super(firestoreDatabase(db), clock); }
}

// This durable store is not an OAuth callback or code-exchange adapter. Product
// onboarding remains HOLD until trusted transport and token inspection exist.

class MemoryDatabase implements ChallengeDatabase {
  private records = new Map<string, ConnectionChallenge>();
  private tail: Promise<unknown> = Promise.resolve();
  transaction<T>(run: (tx: ChallengeTransaction) => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => {
      const records = new Map([...this.records].map(([id, record]) => [id, structuredClone(record)]));
      const result = await run({
        get: async id => structuredClone(records.get(id) ?? null),
        create: (id, record) => { if (records.has(id)) throw new PlatformDenied("CONNECTION_CHALLENGE_ALREADY_EXISTS"); records.set(id, structuredClone(record)); },
        consume: (id, consumedAt) => { const record = records.get(id); if (!record) throw new PlatformDenied("CONNECTION_CHALLENGE_MISSING"); records.set(id, { ...record, consumedAt }); },
      });
      this.records = records;
      return result;
    });
    this.tail = next.catch(() => {});
    return next;
  }
}

export class InMemoryConnectionChallengeStore extends TransactionalConnectionChallengeStore {
  constructor(clock: () => number = Date.now) { super(new MemoryDatabase(), clock); }
}
