import { PlatformDenied, type Operation } from "./models.js";
import type { PlatformRepository } from "./repository.js";

/**
 * One record per (tenant, plan hash), written in the same transaction that prepares the operation. It is released only
 * when that operation finishes SUCCEEDED or FAILED: after UNKNOWN or PARTIAL a provider write may have happened, so the
 * identical plan is not approved or sent again until it is reconciled (a terminal UNKNOWN or PARTIAL operation never
 * changes state, so such a plan stays locked and a changed plan is a different hash).
 */
export interface OperationPlanLock {
  id: string;
  tenantId: string;
  clientId: string;
  actorId: string;
  tool: string;
  operationId: string;
  state: "HELD" | "RELEASED";
  createdAt: number;
  releasedAt: number | null;
  releasedResult: "SUCCEEDED" | "FAILED" | null;
}

export const PRIOR_ATTEMPT_UNRECONCILED = "PRIOR_ATTEMPT_UNRECONCILED";

/** The lock key of an operation: the hash of what it sends. Operations stored before the key existed, and plans without non-sent evidence, use the plan hash itself. */
export function planLockKey(operation: Pick<Operation, "planHash" | "lockHash">): string {
  return operation.lockHash ?? operation.planHash;
}

export function newPlanLock(operation: Pick<Operation, "planHash" | "lockHash" | "tenantId" | "clientId" | "actorId" | "tool" | "id">, createdAt: number): OperationPlanLock {
  return { id: planLockKey(operation), tenantId: operation.tenantId, clientId: operation.clientId, actorId: operation.actorId, tool: operation.tool, operationId: operation.id, state: "HELD", createdAt, releasedAt: null, releasedResult: null };
}

export function releasedPlanLock(lock: OperationPlanLock, result: "SUCCEEDED" | "FAILED", releasedAt: number): OperationPlanLock {
  return { ...lock, state: "RELEASED", releasedAt, releasedResult: result };
}

/** True when the lock belongs to this operation and a SUCCEEDED or FAILED outcome may release it. */
export function releasesPlanLock(lock: OperationPlanLock | null | undefined, operationId: string, result: string): boolean {
  return !!lock && lock.state === "HELD" && lock.operationId === operationId && (result === "SUCCEEDED" || result === "FAILED");
}

export function isPlanLockHeld(lock: OperationPlanLock | null | undefined): boolean {
  return !!lock && lock.state === "HELD";
}

export async function assertNoUnreconciledAttempt(repo: PlatformRepository, tenantId: string, planHash: string): Promise<void> {
  if (isPlanLockHeld(await repo.get("operationPlanLocks", tenantId, planHash))) throw new PlatformDenied(PRIOR_ATTEMPT_UNRECONCILED);
}
