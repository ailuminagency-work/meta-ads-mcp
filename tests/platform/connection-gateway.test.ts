import { describe, expect, it } from "vitest";
import { ConnectionStrategyGateway } from "../../src/platform/connection-gateway.js";
import type { MetaAsset, OperationContext, OperationPlan } from "../../src/platform/models.js";
import type { PlatformRepository } from "../../src/platform/repository.js";

function fixture() {
  const asset: MetaAsset = { key: "META_MARKETING:app:AD_ACCOUNT:101", id: "101", type: "AD_ACCOUNT", tenantId: "t", clientId: "c", provider: "META_MARKETING", appId: "app", parents: [], verifiedAt: 1_000, revokedAt: null, revision: 1 };
  const connection = { id: "conn", tenantId: "t", operatorId: "op", provider: "META_MARKETING" as const, authStrategy: "facebook_business", credentialId: "cred", appId: "app", tokenType: "user" as const, scopes: ["ads_read"], assetKeys: [asset.key], expiresAt: 10_000, revokedAt: null, verifiedAt: 1_000, revision: 1 };
  const grant = { id: "grant", tenantId: "t", clientId: "c", assetKey: asset.key, connectionId: "conn", capabilities: ["marketing.read"], actions: ["READ" as const], tasks: [], verifiedAt: 1_000, expiresAt: 10_000, revokedAt: null, revision: 1 };
  const context: OperationContext = { principal: { tenantId: "t", operatorId: "op" }, clientId: "c", provider: "META_MARKETING", tool: "marketing_list_accounts", requestId: "r" };
  const plan: OperationPlan = { assets: [{ type: "AD_ACCOUNT", id: "101" }], parameters: {}, classes: ["READ"], capability: "marketing.read", requiredScopes: ["ads_read"], tokenTypes: ["user"] };
  const repository = { list: async (collection: string) => collection === "connections" ? [connection] : collection === "grants" ? [grant] : [], isAppUserLifecycleLocked: async () => false, isWhatsAppSetupPhoneLocked: async () => false } as unknown as PlatformRepository;
  return { asset, connection, context, plan, repository };
}

describe("connection strategy gateway", () => {
  it("reuses one exact authorized connection before proposing consent", async () => {
    const f = fixture();
    const result = await new ConnectionStrategyGateway(f.repository).evaluate({ context: f.context, plan: f.plan, assets: [f.asset], now: 2_000 });
    expect(result).toMatchObject({ status: "ELIGIBLE", selectedMethod: "existing_authorized", reason: "EXACT_AUTHORIZED_CONNECTION_REUSED" });
    expect(result.alternatives).toHaveLength(0);
  });

  it("returns a bounded owner handoff when no connection is eligible", async () => {
    const f = fixture();
    const repository = { ...f.repository, list: async () => [] } as unknown as PlatformRepository;
    const result = await new ConnectionStrategyGateway(repository).evaluate({ context: f.context, plan: f.plan, assets: [f.asset], now: 2_000 });
    expect(result.status).toBe("OWNER_ACTION_REQUIRED");
    expect(result.selectedMethod).toBe("fresh_authorization");
    expect(result.alternatives.map(a => a.method)).toEqual(["agency_partner", "system_user", "direct_user_oauth", "facebook_business_login", "fresh_authorization"]);
  });

  it("stops on selected-connection security denial instead of falling back", async () => {
    const f = fixture();
    const result = await new ConnectionStrategyGateway(f.repository).evaluate({ context: f.context, plan: f.plan, assets: [f.asset], now: 2_000, selectedConnectionId: "wrong" });
    expect(result).toMatchObject({ status: "SECURITY_HOLD", selectedMethod: null, reason: "SELECTED_CONNECTION_UNAVAILABLE" });
    expect(result.alternatives).toHaveLength(0);
  });
});

