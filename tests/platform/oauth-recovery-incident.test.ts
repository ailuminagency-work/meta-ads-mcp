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
});


