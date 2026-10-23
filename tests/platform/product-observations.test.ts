import { describe, expect, it } from "vitest";
import { InMemoryPlatformRepository, type ControlCommit } from "../../src/platform/repository.js";
import { authorizeOperation, runWithExecutionPermit } from "../../src/platform/execution.js";
import { recordProductObservation } from "../../src/platform/product-observations.js";
import { PRODUCT_CONTRACTS } from "../../src/platform/products/contracts.js";
import { contractPlanParameters } from "../../src/platform/clients.js";
import type { AssetGrant, Connection, MetaAsset, OperationContext, OperationPlan } from "../../src/platform/models.js";

class RacingRepository extends InMemoryPlatformRepository {
  beforeCommit?: () => Promise<void>;
  override async commitControlPlane(input: ControlCommit): Promise<void> {
    await this.beforeCommit?.();
    return super.commitControlPlane(input);
  }
}
async function fixture(tool = "threads_list_replies", repository = new RacingRepository()) {
  const now = Date.now(), repo = repository, contract = PRODUCT_CONTRACTS.find(c => c.tool === tool)!;
  const ctx: OperationContext = { principal: { tenantId: "t", operatorId: "o" }, clientId: "c", provider: "META_THREADS", tool, requestId: "r" };
  const account: MetaAsset = { key: "account", id: "10", type: "THREADS_ACCOUNT", tenantId: "t", clientId: "c", provider: "META_THREADS", appId: "a", parents: [], verifiedAt: now - 1000, revokedAt: null, revision: 1 };
  const root: MetaAsset = { ...account, key: "root", id: "20", type: tool === "threads_get_post_status" ? "MEDIA" : "POST", parents: [{ type: "THREADS_ACCOUNT", id: "10" }] };
  const children: MetaAsset[] = ["30", "31", "32"].map(id => ({ ...account, id, key: `reply-${id}`, type: "POST", parents: [{ type: "POST", id: "20" }] }));
  const connection: Connection = { id: "connection", tenantId: "t", operatorId: "o", provider: "META_THREADS", authStrategy: "fixture", credentialId: "unused", appId: "a", subjectId: "10", tokenType: "threads", scopes: contract.requiredScopes, assetKeys: [account, root, ...children].map(a => a.key), expiresAt: now + 3600000, revokedAt: null, verifiedAt: now - 1000, revision: 1 };
  await repo.put("tenants", "t", "t", { id: "t", status: "ACTIVE", policyRevision: 1, registryRevision: 1, migrationState: "READY" });
  await repo.put("members", "t", "o", { operatorId: "o", tenantId: "t", roles: ["reader"], allowedClientIds: ["c"], revision: 1, disabledAt: null });
await repo.put("operatorIndex","_index","o",{operatorId:"o",tenantId:"t"});
  await repo.put("clients", "t", "c", { id: "c", tenantId: "t", status: "ACTIVE", revision: 1, verifiedBusinessIds: [] });
  await repo.put("connections", "t", connection.id, connection);
  const grants: AssetGrant[] = [];
  for (const asset of [account, root, ...children]) {
    await repo.put("assets", "t", asset.key, asset);
    if (asset.id === "32") continue;
    const grant: AssetGrant = { id: `grant-${asset.id}`, tenantId: "t", clientId: "c", assetKey: asset.key, connectionId: connection.id, capabilities: [contract.id], actions: ["READ"], tasks: [], verifiedAt: now - 1000, expiresAt: now + 3600000, revokedAt: null, revision: 1 };
    await repo.put("grants", "t", grant.id, grant); grants.push(grant);
  }
  const plan: OperationPlan = { parameters: contractPlanParameters(contract, root.id, {}), assets: [{ type: root.type, id: root.id }], classes: ["READ"], capability: contract.id, requiredScopes: contract.requiredScopes, tokenTypes: contract.tokenTypes };
  const permit = await authorizeOperation(repo, ctx, plan, { writesEnabled: false, selectedConnectionId: connection.id });
  const response = { data: children.map(child => ({ id: child.id, is_reply: true, hide_status: "NOT_HUSHED", root_post: { id: root.id }, replied_to: { id: root.id } })) };
  return { repo, contract, permit, root, children, grants, response };
}
describe("trusted product observation CAS", () => {
  it("updates authorized registered child evidence atomically without changing grants or freshness", async () => {
    const f = await fixture();
    await runWithExecutionPermit(f.permit, () => recordProductObservation(f.repo, f.permit, f.contract, f.root.id, f.response));
    for (const child of f.children) {
      const after = (await f.repo.get("assets", "t", child.key))!;
      expect(after.revision).toBe(child.id === "32" ? 1 : 2);
      expect(after.verifiedAt).toBe(child.verifiedAt);
      expect(after.replyEvidence?.rootPostId).toBe(child.id === "32" ? undefined : f.root.id);
    }
    expect(await f.repo.list("grants", "t")).toEqual(f.grants);
    expect(await f.repo.list("controlAudit", "t")).toHaveLength(1);
  });
  it("rolls back the whole batch when a child grant is revoked at commit", async () => {
    const f = await fixture();
    f.repo.beforeCommit = async () => { const grant = f.grants.find(g => g.id === "grant-30")!; await f.repo.put("grants", "t", grant.id, { ...grant, revokedAt: Date.now(), revision: 2 }); };
    await expect(runWithExecutionPermit(f.permit, () => recordProductObservation(f.repo, f.permit, f.contract, f.root.id, f.response))).rejects.toThrow("CONTROL_AUTHORIZATION_CHANGED");
    expect((await f.repo.get("assets", "t", "reply-30"))!.revision).toBe(1);
    expect((await f.repo.get("assets", "t", "reply-31"))!.revision).toBe(1);
    expect(await f.repo.list("controlAudit", "t")).toHaveLength(0);
  });
  it("denies original authorization revocation before any observation write", async () => {
    const f = await fixture();
    const rootGrant = f.grants.find(g => g.id === "grant-20")!;
    await f.repo.put("grants", "t", rootGrant.id, { ...rootGrant, revokedAt: Date.now(), revision: 2 });
    await expect(runWithExecutionPermit(f.permit, () => recordProductObservation(f.repo, f.permit, f.contract, f.root.id, f.response))).rejects.toThrow("AUTHORIZATION_CHANGED");
    expect(await f.repo.list("controlAudit", "t")).toHaveLength(0);
  });
  it("records container state while preserving its existing one-shot publication claim", async () => {
    const f = await fixture("threads_get_post_status");
    await runWithExecutionPermit(f.permit, () => recordProductObservation(f.repo, f.permit, f.contract, f.root.id, { id: f.root.id, status: "FINISHED" }));
    const after = (await f.repo.get("assets", "t", f.root.key))!;
    expect(after.publishingEvidence?.status).toBe("FINISHED");
    expect(after.verifiedAt).toBe(f.root.verifiedAt);
    expect(after.publicationClaim).toEqual(f.root.publicationClaim);
  });
});
