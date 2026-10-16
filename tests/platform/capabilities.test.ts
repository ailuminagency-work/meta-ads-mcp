import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capabilityStatus, MANUAL_ACTIONS } from "../../src/platform/capabilities.js";
import { PRODUCT_CONTRACTS, type ProductContract } from "../../src/platform/products/contracts.js";
import { configurePlatformRepository } from "../../src/platform/runtime.js";
import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import type { AssetGrant, Connection, Credential, MetaAsset, OperationContext } from "../../src/platform/models.js";

const now = 1_800_000_000_000;
const contract = PRODUCT_CONTRACTS.find(c => c.tool === "threads_get_post")!;
const ctx: OperationContext = { principal: { tenantId: "tenant", operatorId: "operator" }, clientId: "client-a", tool: "meta_capability_status", provider: "META_MARKETING", requestId: "request" };
async function fixture(c: ProductContract = contract) {
  const repo = new InMemoryPlatformRepository();
  configurePlatformRepository(repo);
  await repo.put("tenants", "tenant", "tenant", { id: "tenant", status: "ACTIVE", migrationState: "READY", registryRevision: 1, policyRevision: 1 });
  await repo.put("members", "tenant", "operator", { tenantId: "tenant", operatorId: "operator", roles: ["admin"], allowedClientIds: ["client-a"], disabledAt: null, revision: 1 });
  await repo.put("clients", "tenant", "client-a", { tenantId: "tenant", id: "client-a", status: "ACTIVE", revision: 1, verifiedBusinessIds: [] });
  const parent: MetaAsset = { key: "parent", type: "BUSINESS", id: "101", tenantId: "tenant", clientId: "client-a", provider: c.provider, appId: "app", parents: [], verifiedAt: now - 1000, revokedAt: null, revision: 1 };
  const target: MetaAsset = { ...parent, key: "target", type: c.assetType, id: "202", parents: [{ type: parent.type, id: parent.id }] };
  const connection: Connection = { id: "narrow", tenantId: "tenant", operatorId: "operator", provider: c.provider, appId: "app", credentialId: "credential", authStrategy: "fixture", tokenType: c.tokenTypes[0], scopes: [...c.requiredScopes], assetKeys: [parent.key, target.key], expiresAt: now + 60_000, revokedAt: null, verifiedAt: now - 1000, revision: 1, eligibility: c.manualRequirements.map(requirement => ({ requirement, verified: true, source: c.documentation[0], checkedAt: now - 1000, expiresAt: now + 60_000 })) };
  const credential: Credential = { id: "credential", tenantId: "tenant", operatorId: "operator", provider: c.provider, appId: "app", keyVersion: "primary", envelopeVersion: 1, payload: { ciphertext: "not-decrypted", iv: "not-decrypted", tag: "not-decrypted" } };
  await repo.put("credentials", "tenant", credential.id, credential);
  for (const asset of [parent, target]) await repo.put("assets", "tenant", asset.key, asset);
  await repo.put("connections", "tenant", connection.id, connection);
  const grants: AssetGrant[] = [parent, target].map(asset => ({ id: asset.key, tenantId: "tenant", clientId: "client-a", assetKey: asset.key, connectionId: connection.id, capabilities: [c.id], actions: [...c.operationClasses], tasks: [...c.requiredTasks ?? []], verifiedAt: now - 1000, expiresAt: now + 60_000, revokedAt: null, revision: 1 }));
  for (const grant of grants) await repo.put("grants", "tenant", grant.id, grant);
  return { repo, parent, target, connection, grants, credential };
}
beforeEach(() => { vi.stubEnv("LUMIN_PLATFORM_ENABLED", "true"); vi.stubEnv("LUMIN_PLATFORM_WRITES_ENABLED", "false"); vi.stubEnv("AGENCY_WRITES_ENABLED", "false"); });
afterEach(() => { configurePlatformRepository(undefined); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("capability dry-run matches authorization boundaries", () => {
  it("uses exact provider and narrow selected connection without writing audit or operations", async () => {
    const { repo, connection, grants } = await fixture();
    await repo.put("connections", "tenant", "broad", { ...connection, id: "broad", scopes: [...connection.scopes, "extra_scope"] });
    for (const grant of grants) await repo.put("grants", "tenant", `${grant.id}-broad`, { ...grant, id: `${grant.id}-broad`, connectionId: "broad" });
    const prepare = vi.spyOn(repo, "prepareOperation"); const put = vi.spyOn(repo, "put"); const finish = vi.spyOn(repo, "finishOperation");
    const result = await capabilityStatus(ctx, contract, now);
    expect(result.status).toBe("AVAILABLE"); expect(result.readAvailable).toBe(true);
    expect(result.grantedPermissions).toEqual(["threads_basic"]); expect(result.connectedAssetIds).toEqual(["202"]);
    expect(prepare).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled(); expect(finish).not.toHaveBeenCalled();
    expect(await repo.list("audit", "tenant")).toEqual([]); expect(await repo.list("operations", "tenant")).toEqual([]);
  });
  it("does not combine partial scope grants from separate connections", async () => {
    const multi = PRODUCT_CONTRACTS.find(c => c.tool === "instagram_login_conversations")!;
    const { repo, connection } = await fixture(multi);
    await repo.put("connections", "tenant", "narrow", { ...connection, scopes: [multi.requiredScopes[0]] });
    await repo.put("connections", "tenant", "other", { ...connection, id: "other", scopes: [multi.requiredScopes[1]] });
    const result = await capabilityStatus(ctx, multi, now);
    expect(result.status).toBe("PERMISSION_REQUIRED"); expect(result.grantedPermissions).toEqual([]);
  });
  it.each(["parent", "target"])("excludes stale %s asset evidence", async key => {
    const { repo, parent, target } = await fixture(); const asset = key === "parent" ? parent : target;
    await repo.put("assets", "tenant", key, { ...asset, verifiedAt: now - 61 * 60_000 });
    const result = await capabilityStatus(ctx, contract, now);
    expect(result.status).not.toBe("AVAILABLE"); expect(result.connectedAssetIds).toEqual([]);
  });
  it.each(["cross-client", "foreign-app", "wrong-provider", "revoked"])("rejects %s parent chains", async attack => {
    const { repo, parent } = await fixture();
    await repo.put("assets", "tenant", "parent", { ...parent, ...(attack === "cross-client" ? { clientId: "client-b" } : attack === "foreign-app" ? { appId: "other" } : attack === "wrong-provider" ? { provider: "META_MARKETING" as const } : { revokedAt: now }) });
    expect((await capabilityStatus(ctx, contract, now)).readAvailable).toBe(false);
  });
  it.each(["missing", "stale", "wrong-connection", "expired"])("requires every ancestor grant (%s)", async attack => {
    const { repo, grants } = await fixture(); const grant = grants[0];
    await repo.put("grants", "tenant", grant.id, { ...grant, ...(attack === "missing" ? { capabilities: [] } : attack === "stale" ? { verifiedAt: now - 61 * 60_000 } : attack === "wrong-connection" ? { connectionId: "other" } : { expiresAt: now - 1 }) });
    const result = await capabilityStatus(ctx, contract, now);
    expect(result.status).not.toBe("AVAILABLE"); expect(result.connectedAssetIds).toEqual([]);
  });
  it.each(["missing", "stale", "future", "expired", "unverified", "untrusted-source"])("requires independent eligibility evidence (%s)", async attack => {
    const { repo, connection } = await fixture(); const evidence = connection.eligibility![0];
    const eligibility = attack === "missing" ? [] : [{ ...evidence, ...(attack === "stale" ? { checkedAt: now - 61 * 60_000 } : attack === "future" ? { checkedAt: now + 1 } : attack === "expired" ? { expiresAt: now - 1 } : attack === "unverified" ? { verified: false } : { source: "https://developers.facebook.com.attacker.invalid/proof" }) }];
    await repo.put("connections", "tenant", "narrow", { ...connection, eligibility });
    expect((await capabilityStatus(ctx, contract, now)).status).toBe("UNVERIFIED");
  });
  it("does not silently choose a broader credential to bypass narrow connection eligibility", async () => {
    const { repo, connection, grants } = await fixture();
    await repo.put("connections", "tenant", "narrow", { ...connection, eligibility: [] });
    await repo.put("connections", "tenant", "broad", { ...connection, id: "broad", scopes: [...connection.scopes, "unneeded_scope"] });
    for (const grant of grants) await repo.put("grants", "tenant", `${grant.id}-broad`, { ...grant, id: `${grant.id}-broad`, connectionId: "broad" });
    const result = await capabilityStatus(ctx, contract, now);
    expect(result.status).toBe("UNVERIFIED"); expect(result.grantedPermissions).toEqual(["threads_basic"]);
  });
  it("requires valid credential identity without decrypting the envelope", async () => {
    const { repo, credential } = await fixture();
    await repo.put("credentials", "tenant", "credential", { ...credential, appId: "other" });
    expect((await capabilityStatus(ctx, contract, now)).status).toBe("UNVERIFIED");
  });
  it("honors write roles and returns consent required without consuming approvals", async () => {
    vi.stubEnv("LUMIN_PLATFORM_WRITES_ENABLED", "true"); vi.stubEnv("AGENCY_WRITES_ENABLED", "true");
    const write = PRODUCT_CONTRACTS.find(c => c.tool === "pages_create_feed")!;
    const { repo } = await fixture(write);
    const result = await capabilityStatus(ctx, write, now);
    expect(result.status).toBe("USER_CONSENT_REQUIRED"); expect(result.writeAvailable).toBe(false);
    expect(await repo.list("operations", "tenant")).toEqual([]); expect(await repo.list("approvals", "tenant")).toEqual([]);
    await repo.put("members", "tenant", "operator", { tenantId: "tenant", operatorId: "operator", roles: ["reader"], allowedClientIds: ["client-a"], disabledAt: null, revision: 1 });
    expect((await capabilityStatus(ctx, write, now)).status).toBe("DISABLED_BY_LUMIN_POLICY");
  });
  it("does not report assets for disabled or cross-client memberships", async () => {
    const { repo } = await fixture();
    await repo.put("members", "tenant", "operator", { tenantId: "tenant", operatorId: "operator", roles: ["admin"], allowedClientIds: ["client-b"], disabledAt: null, revision: 1 });
    const result = await capabilityStatus(ctx, contract, now);
    expect(result.status).toBe("ASSET_ACCESS_REQUIRED"); expect(result.connectedAssetIds).toEqual([]); expect(result.grantedPermissions).toEqual([]);
  });
  it("distinguishes expired tokens, preserves manual actions and propagates repository failures", async () => {
    const { repo, connection } = await fixture();
    await repo.put("connections", "tenant", "narrow", { ...connection, expiresAt: now - 1 });
    expect((await capabilityStatus(ctx, contract, now)).status).toBe("TOKEN_EXPIRED");
    expect(MANUAL_ACTIONS.map(action => action.id)).toContain("app_publication");
    repo.list = async () => { throw new Error("fixture registry unavailable"); };
    await expect(capabilityStatus(ctx, contract, now)).rejects.toThrow("registry unavailable");
  });
});
