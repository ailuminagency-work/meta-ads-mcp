import { describe, expect, it } from "vitest";
import type { Firestore } from "@google-cloud/firestore";
import {
  FirestoreRecoveryIncidentStore,
  recoveryIncidentScopeHash,
  type RecoveryIncidentScope,
} from "../../src/platform/oauth-recovery-incident.js";

const scope: RecoveryIncidentScope = {
  tenantId: "tenant-a", clientId: "client-a", operatorId: "operator-a", provider: "META",
  connectionId: "connection-a", profileId: "meta-readonly", incidentId: "incident-a",
};

class FakeDb {
  private readonly rows = new Map<string, Record<string, unknown>>();
  collection() {
    return { doc: (id: string) => ({ id, path: id, get: async () => {
      const row = this.rows.get(id);
      return { exists: Boolean(row), data: () => row };
    } }) };
  }
  async runTransaction<T>(fn: (tx: {
    get: (ref: { id: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
    create: (ref: { id: string }, row: Record<string, unknown>) => void;
    update: (ref: { id: string }, patch: Record<string, unknown>) => void;
  }) => Promise<T>): Promise<T> {
    const tx = {
      get: async (ref: { id: string }) => {
        const row = this.rows.get(ref.id);
        return { exists: Boolean(row), data: () => row };
      },
      create: (ref: { id: string }, row: Record<string, unknown>) => {
        if (this.rows.has(ref.id)) throw new Error("already exists");
        this.rows.set(ref.id, { ...row });
      },
      update: (ref: { id: string }, patch: Record<string, unknown>) => {
        const row = this.rows.get(ref.id);
        if (!row) throw new Error("missing");
        this.rows.set(ref.id, { ...row, ...patch });
      },
    };
    return fn(tx);
  }
  async get(ref: { id: string }) {
    const row = this.rows.get(ref.id);
    return { exists: Boolean(row), data: () => row };
  }
  tamper(id: string, patch: Record<string, unknown>) {
    const row = this.rows.get(id);
    if (!row) throw new Error("missing");
    this.rows.set(id, { ...row, ...patch });
  }
}

describe("OAuth recovery incident binding", () => {
  it("hashes the complete scope and rejects unsafe path identifiers", () => {
    expect(recoveryIncidentScopeHash(scope)).toMatch(/^[a-f0-9]{64}$/);
    expect(() => recoveryIncidentScopeHash({ ...scope, clientId: "other" })).not.toThrow();
    expect(() => recoveryIncidentScopeHash({ ...scope, clientId: "../other" })).toThrow("RECOVERY_INCIDENT_SCOPE_INVALID");
  });

  it("keeps attempt budgets and action ceilings inside one incident", async () => {
    const db = new FakeDb();
    const store = new FirestoreRecoveryIncidentStore(db as unknown as Firestore);
    await store.open({ scope, reason: "META_PROVIDER_TEMPORARILY_UNAVAILABLE", now: 1000, expiresAt: 2000, maxTotalAttempts: 2 });
    expect(await store.claim({ scope, action: "probe_provider_health", maxAttempts: 2, now: 1100 })).toBe(true);
    expect(await store.claim({ scope, action: "probe_provider_health", maxAttempts: 2, now: 1200 })).toBe(true);
    expect(await store.claim({ scope, action: "probe_provider_health", maxAttempts: 2, now: 1300 })).toBe(false);
    expect(await store.readAttempted(scope)).toEqual(["probe_provider_health", "probe_provider_health"]);
  });

  it("does not allow an incident to be reused for another client or after expiry", async () => {
    const db = new FakeDb();
    const store = new FirestoreRecoveryIncidentStore(db as unknown as Firestore);
    await store.open({ scope, reason: "ORIGIN_MISMATCH", now: 1000, expiresAt: 2000 });
    await expect(store.claim({ scope: { ...scope, clientId: "client-b" }, action: "audit_canonical_redirect", maxAttempts: 1, now: 1100 }))
      .rejects.toThrow("RECOVERY_INCIDENT_REQUIRED");
    expect(await store.claim({ scope, action: "audit_canonical_redirect", maxAttempts: 1, now: 2000 })).toBe(false);
  });

  it("rejects malformed persisted records before a claim", async () => {
    const db = new FakeDb();
    const store = new FirestoreRecoveryIncidentStore(db as unknown as Firestore);
    await store.open({ scope, reason: "ORIGIN_MISMATCH", now: 1000, expiresAt: 2000 });
    const id = recoveryIncidentScopeHash(scope);
    db.tamper(id, { expiresAt: Number.NaN });
    await expect(store.claim({ scope, action: "audit_canonical_redirect", maxAttempts: 1, now: 1100 }))
      .rejects.toThrow("RECOVERY_INCIDENT_BINDING_INVALID");
    db.tamper(id, { expiresAt: 2000, status: "BAD" });
    await expect(store.get(scope)).rejects.toThrow("RECOVERY_INCIDENT_BINDING_INVALID");
  });

  it("enforces the catalog ceiling and rejects invalid claim ordering", async () => {
    const db = new FakeDb();
    const store = new FirestoreRecoveryIncidentStore(db as unknown as Firestore);
    await store.open({ scope, reason: "ORIGIN_MISMATCH", now: 1000, expiresAt: 3000 });
    await expect(store.claim({ scope, action: "audit_canonical_redirect", maxAttempts: 2, now: 1100 }))
      .rejects.toThrow("RECOVERY_INCIDENT_CLAIM_INVALID");
    await expect(store.claim({ scope, action: "not-a-tool" as never, maxAttempts: 1, now: 1100 }))
      .rejects.toThrow("RECOVERY_INCIDENT_CLAIM_INVALID");
    expect(await store.claim({ scope, action: "audit_canonical_redirect", maxAttempts: 1, now: 1100 })).toBe(true);
    await expect(store.claim({ scope, action: "audit_canonical_redirect", maxAttempts: 1, now: 1000 }))
      .rejects.toThrow("RECOVERY_INCIDENT_CLAIM_INVALID");
  });

  it("rejects untrusted reason text and refuses to read a tampered reason", async () => {
    const db = new FakeDb();
    const store = new FirestoreRecoveryIncidentStore(db as unknown as Firestore);
    await expect(store.open({ scope, reason: "access_token=SECRET" , now: 1000, expiresAt: 2000 }))
      .rejects.toThrow("RECOVERY_INCIDENT_REASON_INVALID");
    await store.open({ scope, reason: "ORIGIN_MISMATCH", now: 1000, expiresAt: 2000 });
    db.tamper(recoveryIncidentScopeHash(scope), { reason: "token=SECRET" });
    await expect(store.get(scope)).rejects.toThrow("RECOVERY_INCIDENT_BINDING_INVALID");
  });

  it("transitions an incident with an immutable revision CAS", async () => {
    const db = new FakeDb();
    const store = new FirestoreRecoveryIncidentStore(db as unknown as Firestore);
    const opened = await store.open({ scope, reason: "ORIGIN_MISMATCH", now: 1000, expiresAt: 3000 });
    const held = await store.hold({ scope, expectedRevision: opened.revision, now: 1100 });
    expect(held.status).toBe("HOLD");
    expect(held.revision).toBe(2);
    expect((await store.get(scope))?.status).toBe("HOLD");
    await expect(store.resolve({ scope, expectedRevision: opened.revision, now: 1200 }))
      .rejects.toThrow("RECOVERY_INCIDENT_TRANSITION_REJECTED");
    await expect(store.exhaust({ scope, expectedRevision: held.revision, now: 1000 }))
      .rejects.toThrow("RECOVERY_INCIDENT_TRANSITION_REJECTED");
  });

  it("supports each terminal lifecycle outcome only from OPEN", async () => {
    const statuses = ["RESOLVED", "EXHAUSTED", "HOLD"] as const;
    for (const status of statuses) {
      const db = new FakeDb();
      const store = new FirestoreRecoveryIncidentStore(db as unknown as Firestore);
      const opened = await store.open({
        scope, reason: "ORIGIN_MISMATCH", now: 1000, expiresAt: 3000,
        ...(status === "EXHAUSTED" ? { maxTotalAttempts: 0 } : {}),
      });
      const result = status === "RESOLVED"
        ? await store.resolve({ scope, expectedRevision: opened.revision, now: 1100 })
        : status === "EXHAUSTED"
          ? await store.exhaust({ scope, expectedRevision: opened.revision, now: 1100 })
          : await store.hold({ scope, expectedRevision: opened.revision, now: 1100 });
      expect(result.status).toBe(status);
      expect(result.updatedAt).toBe(1100);
    }
  });

  it("does not transition an expired incident or allow exhaustion before its budget is spent", async () => {
    const db = new FakeDb();
    const store = new FirestoreRecoveryIncidentStore(db as unknown as Firestore);
    const opened = await store.open({ scope, reason: "ORIGIN_MISMATCH", now: 1000, expiresAt: 2000 });
    await expect(store.resolve({ scope, expectedRevision: opened.revision, now: 2000 }))
      .rejects.toThrow("RECOVERY_INCIDENT_TRANSITION_REJECTED");
    await expect(store.exhaust({ scope, expectedRevision: opened.revision, now: 1100 }))
      .rejects.toThrow("RECOVERY_INCIDENT_TRANSITION_REJECTED");
  });
});



