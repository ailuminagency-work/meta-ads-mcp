import { createHash } from "node:crypto";
import type { Firestore } from "@google-cloud/firestore";
import { PlatformDenied } from "./models.js";
import type { RecoveryAttemptLedger } from "./oauth-recovery-runner.js";
import { RECOVERY_TOOLS, type RecoveryToolId } from "./oauth-recovery-toolbox.js";

const COLLECTION = "platform_oauth_recovery_incidents";
const MAX_ID = 128;

export type RecoveryIncidentStatus = "OPEN" | "RESOLVED" | "EXHAUSTED" | "HOLD";

export interface RecoveryIncidentScope {
  readonly tenantId: string;
  readonly clientId: string;
  readonly operatorId: string;
  readonly provider: "META";
  readonly connectionId: string | null;
  readonly profileId: string;
  readonly incidentId: string;
}

export interface RecoveryIncidentRecord extends RecoveryIncidentScope {
  readonly version: 1;
  readonly scopeHash: string;
  readonly reason: string;
  readonly status: RecoveryIncidentStatus;
  readonly attempted: readonly RecoveryToolId[];
  readonly maxTotalAttempts: number;
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly expiresAt: number;
}

export interface RecoveryIncidentStore {
  get(scope: RecoveryIncidentScope): Promise<RecoveryIncidentRecord | null>;
  open(input: {
    readonly scope: RecoveryIncidentScope;
    readonly reason: string;
    readonly now: number;
    readonly expiresAt: number;
    readonly maxTotalAttempts?: number;
  }): Promise<RecoveryIncidentRecord>;
  claim(input: {
    readonly scope: RecoveryIncidentScope;
    readonly action: RecoveryToolId;
    readonly maxAttempts: number;
    readonly now: number;
  }): Promise<boolean>;
  readAttempted(scope: RecoveryIncidentScope): Promise<readonly RecoveryToolId[]>;
}

function validId(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID && !/[\\/]/.test(value);
}

function assertScope(scope: RecoveryIncidentScope): void {
  if (!validId(scope.tenantId) || !validId(scope.clientId) || !validId(scope.operatorId) ||
      scope.provider !== "META" || (scope.connectionId !== null && !validId(scope.connectionId)) ||
      !validId(scope.profileId) || !validId(scope.incidentId)) {
    throw new PlatformDenied("RECOVERY_INCIDENT_SCOPE_INVALID");
  }
}

export function recoveryIncidentScopeHash(scope: RecoveryIncidentScope): string {
  assertScope(scope);
  return createHash("sha256").update(JSON.stringify([
    scope.tenantId, scope.clientId, scope.operatorId, scope.provider,
    scope.connectionId, scope.profileId, scope.incidentId,
  ])).digest("hex");
}

function assertWindow(now: number, expiresAt: number): void {
  if (!Number.isSafeInteger(now) || now <= 0 || !Number.isSafeInteger(expiresAt) || expiresAt <= now) {
    throw new PlatformDenied("RECOVERY_INCIDENT_WINDOW_INVALID");
  }
}

function assertRecord(row: RecoveryIncidentRecord, scope: RecoveryIncidentScope): void {
  assertScope(scope);
  const validStatuses: readonly RecoveryIncidentStatus[] = ["OPEN", "RESOLVED", "EXHAUSTED", "HOLD"];
  const validActions = new Set(Object.keys(RECOVERY_TOOLS));
  if (row.version !== 1 || row.scopeHash !== recoveryIncidentScopeHash(scope) ||
      row.tenantId !== scope.tenantId || row.clientId !== scope.clientId ||
      row.operatorId !== scope.operatorId || row.provider !== scope.provider ||
      row.connectionId !== scope.connectionId || row.profileId !== scope.profileId ||
      row.incidentId !== scope.incidentId || !validStatuses.includes(row.status) || !validId(row.reason) ||
      !Array.isArray(row.attempted) || row.attempted.some(action => typeof action !== "string" || !validActions.has(action)) ||
      !Number.isSafeInteger(row.revision) || row.revision < 1 ||
      !Number.isSafeInteger(row.maxTotalAttempts) || row.maxTotalAttempts < 0 || row.maxTotalAttempts > 3 ||
      row.attempted.length > row.maxTotalAttempts ||
      !Number.isSafeInteger(row.createdAt) || row.createdAt <= 0 ||
      !Number.isSafeInteger(row.updatedAt) || row.updatedAt < row.createdAt ||
      !Number.isSafeInteger(row.expiresAt) || row.expiresAt <= row.updatedAt) {
    throw new PlatformDenied("RECOVERY_INCIDENT_BINDING_INVALID");
  }
}

/** Firestore-backed, tenant/client/operator-bound attempt ledger. */
export class FirestoreRecoveryIncidentStore implements RecoveryIncidentStore {
  constructor(private readonly db: Firestore) {}

  private ref(scope: RecoveryIncidentScope) {
    return this.db.collection(COLLECTION).doc(recoveryIncidentScopeHash(scope));
  }

  async get(scope: RecoveryIncidentScope): Promise<RecoveryIncidentRecord | null> {
    assertScope(scope);
    const snapshot = await this.ref(scope).get();
    if (!snapshot.exists) return null;
    const row = snapshot.data() as RecoveryIncidentRecord;
    assertRecord(row, scope);
    return row;
  }

  async open(input: {
    readonly scope: RecoveryIncidentScope;
    readonly reason: string;
    readonly now: number;
    readonly expiresAt: number;
    readonly maxTotalAttempts?: number;
  }): Promise<RecoveryIncidentRecord> {
    assertScope(input.scope);
    assertWindow(input.now, input.expiresAt);
    if (!validId(input.reason) || input.reason.length > MAX_ID) throw new PlatformDenied("RECOVERY_INCIDENT_REASON_INVALID");
    const maxTotalAttempts = input.maxTotalAttempts ?? 3;
    if (!Number.isSafeInteger(maxTotalAttempts) || maxTotalAttempts < 0 || maxTotalAttempts > 3) {
      throw new PlatformDenied("RECOVERY_INCIDENT_BUDGET_INVALID");
    }
    return this.db.runTransaction(async tx => {
      const ref = this.ref(input.scope);
      const existing = await tx.get(ref);
      if (existing.exists) {
        const row = existing.data() as RecoveryIncidentRecord;
        assertRecord(row, input.scope);
        if (row.reason !== input.reason || row.expiresAt <= input.now) throw new PlatformDenied("RECOVERY_INCIDENT_REOPEN_REJECTED");
        return row;
      }
      const row: RecoveryIncidentRecord = {
        version: 1, ...input.scope, scopeHash: recoveryIncidentScopeHash(input.scope),
        reason: input.reason, status: "OPEN", attempted: [], maxTotalAttempts,
        revision: 1, createdAt: input.now, updatedAt: input.now, expiresAt: input.expiresAt,
      };
      tx.create(ref, row);
      return row;
    });
  }

  async claim(input: {
    readonly scope: RecoveryIncidentScope;
    readonly action: RecoveryToolId;
    readonly maxAttempts: number;
    readonly now: number;
  }): Promise<boolean> {
    assertScope(input.scope);
    const tool = RECOVERY_TOOLS[input.action as RecoveryToolId];
    if (!tool || !Number.isSafeInteger(input.now) || input.now <= 0 || !Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > tool.maxAttempts) {
      throw new PlatformDenied("RECOVERY_INCIDENT_CLAIM_INVALID");
    }
    return this.db.runTransaction(async tx => {
      const ref = this.ref(input.scope);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) throw new PlatformDenied("RECOVERY_INCIDENT_REQUIRED");
      const row = snapshot.data() as RecoveryIncidentRecord;
      assertRecord(row, input.scope);
      if (input.now < row.updatedAt) throw new PlatformDenied("RECOVERY_INCIDENT_CLAIM_INVALID");
      if (row.status !== "OPEN" || row.expiresAt <= input.now || row.attempted.length >= row.maxTotalAttempts) return false;
      if (row.attempted.filter(action => action === input.action).length >= input.maxAttempts) return false;
      tx.update(ref, {
        attempted: [...row.attempted, input.action],
        revision: row.revision + 1,
        updatedAt: input.now,
      });
      return true;
    });
  }

  async readAttempted(scope: RecoveryIncidentScope): Promise<readonly RecoveryToolId[]> {
    const row = await this.get(scope);
    if (!row) throw new PlatformDenied("RECOVERY_INCIDENT_REQUIRED");
    return row.attempted;
  }

  /** Adapter for the bounded runner; scope is fixed at construction. */
  ledger(scope: RecoveryIncidentScope): RecoveryAttemptLedger {
    return {
      readAttempted: () => this.readAttempted(scope),
      claimAttempt: (action, maxAttempts) => this.claim({ scope, action, maxAttempts, now: Date.now() }),
    };
  }
}


