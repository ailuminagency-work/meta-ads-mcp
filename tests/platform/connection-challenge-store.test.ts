import { describe, expect, it } from "vitest";
import { InMemoryConnectionChallengeStore, TransactionalConnectionChallengeStore, FirestoreConnectionChallengeStore, type ChallengeDatabase } from "../../src/platform/connection-challenge-store.js";
import type { ConnectionChallenge } from "../../src/platform/connection-profiles.js";
import type { Firestore } from "@google-cloud/firestore";

const now = 1000000;
const record: ConnectionChallenge = { id: "a".repeat(64), nonceHash: "b".repeat(64), principal: { tenantId: "tenant-fixture", operatorId: "operator-fixture" }, clientId: "client-fixture", profileId: "profile-fixture", profileHash: "c".repeat(64), redirectUri: "https://fixture.invalid/connect/callback", expiresAt: now + 600000, consumedAt: null };
const { id: _id, nonceHash: _nonce, expiresAt: _expiry, consumedAt: _consumed, ...expected } = record;
void _id; void _nonce; void _expiry; void _consumed;

describe("atomic production connection challenge store", () => {
  it("allows only one concurrent callback winner", async () => {
    const store = new InMemoryConnectionChallengeStore(() => now);
    await store.create(record);
    const results = await Promise.all([store.consume(record.id, record.nonceHash, expected, now), store.consume(record.id, record.nonceHash, expected, now)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.find(Boolean)?.consumedAt).toBe(now);
  });
  it("rejects duplicate creation rather than replacing a pending challenge", async () => {
    const store = new InMemoryConnectionChallengeStore(() => now);
    await store.create(record);
    await expect(store.create({ ...record, clientId: "foreign-client" })).rejects.toThrow("ALREADY_EXISTS");
    expect(await store.consume(record.id, record.nonceHash, expected, now)).not.toBeNull();
  });
  it.each([
    { clientId: "foreign" }, { principal: { ...record.principal, tenantId: "foreign" } },
    { principal: { ...record.principal, operatorId: "foreign" } }, { profileHash: "d".repeat(64) },
    { redirectUri: "https://fixture.invalid/other" }, { profileId: "foreign" },
  ])("rejects substituted binding %j without consuming the correct state", async replacement => {
    const store = new InMemoryConnectionChallengeStore(() => now);
    await store.create(record);
    expect(await store.consume(record.id, record.nonceHash, { ...expected, ...replacement }, now)).toBeNull();
    expect(await store.consume(record.id, record.nonceHash, expected, now)).not.toBeNull();
  });
  it("rejects wrong nonce, expired state and clock rollback", async () => {
    let current = now;
    const store = new InMemoryConnectionChallengeStore(() => current);
    await store.create(record);
    expect(await store.consume(record.id, "f".repeat(64), expected, now)).toBeNull();
    current = record.expiresAt;
    expect(await store.consume(record.id, record.nonceHash, expected, current)).toBeNull();
    await expect(store.consume(record.id, record.nonceHash, expected, now)).rejects.toThrow("INVALID_CONNECTION_CHALLENGE_LOOKUP");
  });
  it.each([{ expiresAt: Infinity }, { expiresAt: now - 1 }, { expiresAt: now + 600001 }, { consumedAt: now }, { id: "../unsafe" }, { redirectUri: "https://fixture.invalid/callback?access_token=private" }])("rejects malformed challenge record %j", async replacement => {
    const store = new InMemoryConnectionChallengeStore(() => now);
    await expect(store.create({ ...record, ...replacement })).rejects.toThrow("INVALID_CONNECTION_CHALLENGE_RECORD");
  });
  it("propagates storage failure without claiming challenge consumption", async () => {
    const database: ChallengeDatabase = { transaction: async () => { throw new Error("storage unavailable"); } };
    const store = new TransactionalConnectionChallengeStore(database, () => now);
    await expect(store.create(record)).rejects.toThrow("storage unavailable");
    await expect(store.consume(record.id, record.nonceHash, expected, now)).rejects.toThrow("storage unavailable");
  });
  it("rechecks time inside a delayed transaction before consuming", async () => {
    let current = now, consumed = false;
    const database: ChallengeDatabase = { transaction: async run => run({ get: async () => { current += 600001; return record; }, create: () => {}, consume: () => { consumed = true; } }) };
    const store = new TransactionalConnectionChallengeStore(database, () => current);
    await expect(store.consume(record.id, record.nonceHash, expected, now)).rejects.toThrow("INVALID_CONNECTION_CHALLENGE_LOOKUP");
    expect(consumed).toBe(false);
  });
  it("uses hashed doc IDs and timestamp TTL with transactional consumption", async () => {
    const records = new Map<string, Record<string, unknown>>();
    const paths: string[] = [];
    const db = { collection: (name: string) => ({ doc: (id: string) => { paths.push(`${name}/${id}`); return id; } }), runTransaction: async (run: (tx: unknown) => Promise<unknown>) => run({ get: async (id: string) => ({ exists: records.has(id), data: () => records.get(id) }), create: (id: string, value: Record<string, unknown>) => { records.set(id, value); }, update: (id: string, value: Record<string, unknown>) => { records.set(id, { ...records.get(id), ...value }); } }) } as unknown as Firestore;
    const store = new FirestoreConnectionChallengeStore(db, () => now);
    await store.create(record);
    expect(records.get(record.id)?.expireTime).toEqual(new Date(record.expiresAt));
    expect(await store.consume(record.id, record.nonceHash, expected, now)).not.toBeNull();
    expect(records.get(record.id)?.consumedAt).toBe(now);
    expect(paths.every(path => /^platform_connection_challenges\/[a-f0-9]{64}$/.test(path))).toBe(true);
  });
});
