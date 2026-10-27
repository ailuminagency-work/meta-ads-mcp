import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import { PRODUCT_CONTRACTS } from "../../src/platform/products/contracts.js";
import type { OperationContext } from "../../src/platform/models.js";
import { establishManualEligibilityFixture } from "./manual-eligibility-fixture.js";

export const pagesContract = PRODUCT_CONTRACTS.find(c => c.tool === "pages_create_feed")!;
export const tenantId = "tenant-fixture", clientId = "client-fixture";
export const actor = { tenantId, operatorId: "actor-fixture" }, human = { tenantId, operatorId: "human-fixture" };
export const pagesCtx: OperationContext = { principal: actor, clientId, tool: pagesContract.tool, provider: pagesContract.provider, requestId: "request-fixture" };
export const pagesInput = { message: "Synthetic reviewed action" };

export function writesEnabledEnv(stub: (name: string, value: string) => void): void {
  stub("LUMIN_PLATFORM_WRITES_ENABLED", "true");
  stub("AGENCY_WRITES_ENABLED", "true");
  stub("TOKEN_ENCRYPTION_KEY", "c".repeat(64));
}

/** One writer, one approver and one registered Page with a current WRITE_CONTENT grant: the smallest real approval journey. */
export async function pagesApprovalFixture(): Promise<InMemoryPlatformRepository> {
  const repo = new InMemoryPlatformRepository(), now = Date.now();
  for (const principal of [actor, human]) await repo.put("operatorIndex", "_index", principal.operatorId, principal);
  await repo.put("tenants", tenantId, tenantId, { id: tenantId, status: "ACTIVE", migrationState: "READY", policyRevision: 1, registryRevision: 1 });
  await repo.put("clients", tenantId, clientId, { id: clientId, tenantId, status: "ACTIVE", revision: 1, verifiedBusinessIds: [] });
  await repo.put("members", tenantId, actor.operatorId, { operatorId: actor.operatorId, tenantId, roles: ["writer"], allowedClientIds: [clientId], disabledAt: null, revision: 1 });
  await repo.put("members", tenantId, human.operatorId, { operatorId: human.operatorId, tenantId, roles: ["approver"], allowedClientIds: [clientId], disabledAt: null, revision: 1 });
  await repo.put("assets", tenantId, "page-fixture", { key: "page-fixture", id: "123", type: "PAGE", tenantId, clientId, provider: pagesContract.provider, appId: "300", parents: [], verifiedAt: now, revokedAt: null, revision: 1 });
  await repo.put("connections", tenantId, "connection-fixture", { id: "connection-fixture", tenantId, operatorId: actor.operatorId, provider: pagesContract.provider, authStrategy: "fixture", credentialId: "credential-fixture", appId: "300", tokenType: "page", subjectId: "123", scopes: [...pagesContract.requiredScopes], assetKeys: ["page-fixture"], expiresAt: now + 3600000, revokedAt: null, verifiedAt: now, revision: 1, eligibility: [] });
  await repo.put("grants", tenantId, "grant-fixture", { id: "grant-fixture", tenantId, clientId, assetKey: "page-fixture", connectionId: "connection-fixture", capabilities: [pagesContract.id], actions: [...pagesContract.operationClasses], tasks: pagesContract.requiredTasks ?? [], verifiedAt: now, expiresAt: now + 3600000, revokedAt: null, revision: 1 });
  await establishManualEligibilityFixture(repo, tenantId, clientId, "connection-fixture");
  return repo;
}
