import type { Firestore } from "@google-cloud/firestore";
import { randomUUID } from "node:crypto";
import { encryptCredential, decryptCredential } from "./connections.js";
import type { OAuthAssetDiscoveryCandidate, OAuthDiscoveryInspection, OAuthDiscoveryTransactionStore } from "./oauth-discovery.js";
import { PlatformDenied } from "./models.js";

type DiscoveryRecord = {
  transactionId: string; tenantId: string; clientId: string; operatorId: string;
  profileId: string; appId: string; credential: ReturnType<typeof encryptCredential>;
  inspection: OAuthDiscoveryInspection; candidates: OAuthAssetDiscoveryCandidate[];
  expiresAt: number; state: "PENDING" | "CONSUMED"; consumedAt: number | null;
  createdAt: number; expireTime: Date;
};

const safeRecord = (value: DiscoveryRecord) => ({
  profileId: value.profileId, appId: value.appId,
  inspection: structuredClone(value.inspection), candidates: structuredClone(value.candidates),
  expiresAt: value.expiresAt,
});

/** Firestore-backed, server-only storage for the pre-enrollment OAuth credential. */
export class FirestoreOAuthDiscoveryTransactionStore implements OAuthDiscoveryTransactionStore {
  constructor(private readonly db: Firestore, private readonly now: () => number = Date.now) {}
  private ref(id: string) { return this.db.collection("platform_oauth_discovery_transactions").doc(id); }
  async create(input: Parameters<OAuthDiscoveryTransactionStore["create"]>[0]): Promise<void> {
    if (!input.transactionId || input.expiresAt <= this.now() || input.expiresAt > input.inspection.expiresAt) throw new PlatformDenied("OAUTH_DISCOVERY_EXPIRY_INVALID");
    const credential = encryptCredential({ id: input.transactionId, tenantId: input.tenantId, operatorId: input.operatorId, provider: input.inspection.provider, appId: input.appId, keyVersion: "primary" }, input.token);
    const record: DiscoveryRecord = { ...structuredClone(input), credential, state: "PENDING", consumedAt: null, createdAt: this.now(), expireTime: new Date(input.expiresAt) };
    delete (record as unknown as { token?: string }).token;
    await this.ref(input.transactionId).create(record);
  }
  async read(input: Parameters<OAuthDiscoveryTransactionStore["read"]>[0]) {
    const snap = await this.ref(input.transactionId).get();
    if (!snap.exists) return null;
    const row = snap.data() as DiscoveryRecord;
    if (row.tenantId !== input.tenantId || row.clientId !== input.clientId || row.operatorId !== input.operatorId || row.state !== "PENDING" || row.expiresAt <= input.now) return null;
    return safeRecord(row);
  }
  async readSecret(input: Parameters<OAuthDiscoveryTransactionStore["readSecret"]>[0]) {
    const snap = await this.ref(input.transactionId).get(); if (!snap.exists) return null;
    const row = snap.data() as DiscoveryRecord;
    if (row.tenantId !== input.tenantId || row.clientId !== input.clientId || row.operatorId !== input.operatorId || row.state !== "PENDING" || row.expiresAt <= input.now) return null;
    return { token: decryptCredential(row.credential), inspection: structuredClone(row.inspection), candidates: structuredClone(row.candidates), expiresAt: row.expiresAt };
  }
  async consume(input: Parameters<OAuthDiscoveryTransactionStore["consume"]>[0]) {
    let result: Awaited<ReturnType<OAuthDiscoveryTransactionStore["consume"]>> = null;
    await this.db.runTransaction(async tx => {
      const ref = this.ref(input.transactionId), snap = await tx.get(ref);
      if (!snap.exists) return;
      const row = snap.data() as DiscoveryRecord;
      if (row.tenantId !== input.tenantId || row.clientId !== input.clientId || row.operatorId !== input.operatorId || row.state !== "PENDING" || row.expiresAt <= input.now) return;
      tx.update(ref, { state: "CONSUMED", consumedAt: input.now });
      result = { token: decryptCredential(row.credential), inspection: structuredClone(row.inspection), candidates: structuredClone(row.candidates), expiresAt: row.expiresAt };
    });
    return result;
  }
}

/** Deterministic test/local fallback. Production wiring must use Firestore. */
export class InMemoryOAuthDiscoveryTransactionStore implements OAuthDiscoveryTransactionStore {
  private readonly rows = new Map<string, DiscoveryRecord>();
  constructor(private readonly now: () => number = Date.now) {}
  async create(input: Parameters<OAuthDiscoveryTransactionStore["create"]>[0]) {
    if (this.rows.has(input.transactionId)) throw new PlatformDenied("OAUTH_DISCOVERY_TRANSACTION_EXISTS");
    const credential = encryptCredential({ id: input.transactionId, tenantId: input.tenantId, operatorId: input.operatorId, provider: input.inspection.provider, appId: input.appId, keyVersion: "primary" }, input.token);
    this.rows.set(input.transactionId, { ...structuredClone(input), credential, state: "PENDING", consumedAt: null, createdAt: this.now(), expireTime: new Date(input.expiresAt) } as DiscoveryRecord);
  }
  async read(input: Parameters<OAuthDiscoveryTransactionStore["read"]>[0]) {
    const row = this.rows.get(input.transactionId);
    if (!row || row.tenantId !== input.tenantId || row.clientId !== input.clientId || row.operatorId !== input.operatorId || row.state !== "PENDING" || row.expiresAt <= input.now) return null;
    return safeRecord(row);
  }
  async readSecret(input: Parameters<OAuthDiscoveryTransactionStore["readSecret"]>[0]) {
    const row = this.rows.get(input.transactionId);
    if (!row || row.tenantId !== input.tenantId || row.clientId !== input.clientId || row.operatorId !== input.operatorId || row.state !== "PENDING" || row.expiresAt <= input.now) return null;
    return { token: decryptCredential(row.credential), inspection: structuredClone(row.inspection), candidates: structuredClone(row.candidates), expiresAt: row.expiresAt };
  }
  async consume(input: Parameters<OAuthDiscoveryTransactionStore["consume"]>[0]) {
    const row = this.rows.get(input.transactionId);
    if (!row || row.tenantId !== input.tenantId || row.clientId !== input.clientId || row.operatorId !== input.operatorId || row.state !== "PENDING" || row.expiresAt <= input.now) return null;
    row.state = "CONSUMED"; row.consumedAt = input.now;
    return { token: decryptCredential(row.credential), inspection: structuredClone(row.inspection), candidates: structuredClone(row.candidates), expiresAt: row.expiresAt };
  }
}

export function newDiscoveryRegistrationId(): string { return randomUUID(); }

