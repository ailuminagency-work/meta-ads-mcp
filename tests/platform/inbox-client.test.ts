import {applyProductTaskRequirements} from "../../src/platform/product-task-requirements.js";
import {establishManualEligibilityFixture} from "./manual-eligibility-fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetaGraphClient, contractPlanParameters } from "../../src/platform/clients.js";
import { PRODUCT_CONTRACTS } from "../../src/platform/products/contracts.js";
import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import { authorizeOperation, runWithExecutionPermit } from "../../src/platform/execution.js";
import { encryptCredential } from "../../src/platform/connections.js";
import type { AssetGrant, Connection, MetaAsset, OperationContext, OperationPlan } from "../../src/platform/models.js";
beforeEach(() => { vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 4).toString("hex")); vi.stubEnv("INSTAGRAM_API_VERSION", "v26.0"); });
afterEach(() => vi.unstubAllEnvs());
async function fixture(tool: string) {
  const now = Date.now(), repo = new InMemoryPlatformRepository(), contract = PRODUCT_CONTRACTS.find(c => c.tool === tool)!;
  const ctx: OperationContext = { principal: { tenantId: "t", operatorId: "o" }, clientId: "c", provider: contract.provider, tool, requestId: "r" };
  const messenger = tool === "messenger_get_message", instagramLogin = tool === "instagram_login_get_message";
  const root: MetaAsset = { key: "root", id: "222", type: messenger ? "PAGE" : "INSTAGRAM_ACCOUNT", tenantId: "t", clientId: "c", provider: contract.provider, appId: "a", parents: [], verifiedAt: now - 1000, revokedAt: null, revision: 1 };
  const page: MetaAsset = { ...root, key: "page", id: "444", type: "PAGE" };
  if (!messenger && !instagramLogin) root.parents = [{ type: "PAGE", id: "444" }];
  const conversation: MetaAsset = { ...root, key: "conversation", id: "conversation_123", type: "CONVERSATION", parents: [{ type: root.type, id: root.id }] };
  const message: MetaAsset = { ...root, key: "message", id: "mid_123", type: "MESSAGE", parents: [{ type: "CONVERSATION", id: conversation.id }] };
  const assets = [root, conversation, message, ...(!messenger && !instagramLogin ? [page] : [])];
  const connection: Connection = { id: "connection", tenantId: "t", operatorId: "o", provider: contract.provider, authStrategy: "fixture", credentialId: "credential", appId: "a", subjectId: !messenger && !instagramLogin ? page.id : root.id, tokenType: instagramLogin ? "instagram" : "page", ...(instagramLogin ? {metaAppUserId:"901"} : {}), scopes: contract.requiredScopes, assetKeys: assets.map(a => a.key), expiresAt: now + 3600000, revokedAt: null, verifiedAt: now - 1000, revision: 1, eligibility: contract.manualRequirements.map(requirement => ({ requirement, source: contract.documentation[0], checkedAt: now - 1000, expiresAt: now + 3600000, verified: true })) };
  await repo.put("tenants", "t", "t", { id: "t", status: "ACTIVE", policyRevision: 1, registryRevision: 1, migrationState: "READY" });
  await repo.put("members", "t", "o", { operatorId: "o", tenantId: "t", roles: ["reader"], allowedClientIds: ["c"], revision: 1, disabledAt: null });
await repo.put("operatorIndex","_index","o",{operatorId:"o",tenantId:"t"});
  await repo.put("clients", "t", "c", { id: "c", tenantId: "t", status: "ACTIVE", revision: 1, verifiedBusinessIds: [] });
  await repo.put("connections", "t", connection.id, connection);
  await repo.put("credentials", "t", "credential", encryptCredential({ id: "credential", tenantId: "t", operatorId: "o", provider: contract.provider, appId: "a", keyVersion: "primary" }, "synthetic-inbox-fixture"));
  for (const asset of assets) {
    await repo.put("assets", "t", asset.key, asset);
    const grant: AssetGrant = { id: `grant-${asset.key}`, tenantId: "t", clientId: "c", assetKey: asset.key, connectionId: connection.id, capabilities: [contract.id], actions: ["READ"], tasks: !messenger||asset.type==="PAGE"?(contract.requiredTasks??[]):[], verifiedAt: now - 1000, expiresAt: now + 3600000, revokedAt: null, revision: 1 };
    await repo.put("grants", "t", grant.id, grant);
  }
  if(contract.eligibilityPolicies)await establishManualEligibilityFixture(repo,"t","c",connection.id);
  const plan: OperationPlan = { parameters: contractPlanParameters(contract, message.id, {}), assets: [{ type: "MESSAGE", id: message.id }], classes: ["READ"], capability: contract.id, requiredScopes: contract.requiredScopes, tokenTypes: contract.tokenTypes, requiredTasks: contract.requiredTasks };
  const permit = await authorizeOperation(repo, ctx, applyProductTaskRequirements(plan,contract,assets), { writesEnabled: false });
  return { repo, permit, contract, connection, message };
}
const response = { id: "mid_123", created_time: "2026-10-16T12:00:00+0000", from: { id: "111", username: "excluded-person" }, to: { data: [{ id: "222", username: "excluded-business" }] }, message: "Please send a deck quote.", attachment: { private: true }, access_token: "excluded" };
describe("actual guarded private inbox client", () => {
  it.each(["messenger_get_message", "instagram_get_message", "instagram_login_get_message"])("reads and normalizes %s with exact provider credentials", async tool => {
    const f = await fixture(tool), fetcher = vi.fn(async () => new Response(JSON.stringify(response)));
    const result = await runWithExecutionPermit(f.permit, () => new MetaGraphClient(f.contract.provider, fetcher).request(f.contract, f.message.id));
    expect(result).toEqual({ id: "mid_123", created_time: response.created_time, from: { id: "111" }, to: { data: [{ id: "222" }] }, message: response.message, message_truncated: false, message_credentials_redacted: false });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.hostname).toBe(tool === "instagram_login_get_message" ? "graph.instagram.com" : "graph.facebook.com");
    expect(url.searchParams.get("fields")).toBe("id,created_time,from,to,message");
    expect(url.searchParams.has("access_token")).toBe(false);
    expect(await f.repo.list("audit", "t")).toEqual([]);
  });
  it("denies provider message identity and participant substitutions", async () => {
    for (const body of [{ ...response, id: "other-message" }, { ...response, to: { data: [{ id: "999" }] } }]) {
      const f = await fixture("messenger_get_message"), fetcher = vi.fn(async () => new Response(JSON.stringify(body)));
      await expect(runWithExecutionPermit(f.permit, () => new MetaGraphClient(f.contract.provider, fetcher).request(f.contract, f.message.id))).rejects.toThrow(/INBOX_RESPONSE_ID_MISMATCH|INBOX_PARTICIPANT_PROVENANCE_REQUIRED/);
    }
  });
  it("denies private output when the connection is revoked during the provider read", async () => {
    const f = await fixture("messenger_get_message");
    const fetcher = vi.fn(async () => { await f.repo.put("connections", "t", f.connection.id, { ...f.connection, revokedAt: Date.now(), revision: 2 }); return new Response(JSON.stringify(response)); });
    await expect(runWithExecutionPermit(f.permit, () => new MetaGraphClient(f.contract.provider, fetcher).request(f.contract, f.message.id))).rejects.toThrow("AUTHORIZATION_CHANGED");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
