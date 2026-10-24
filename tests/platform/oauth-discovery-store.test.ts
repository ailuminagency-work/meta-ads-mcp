import { describe, expect, it, vi } from "vitest";
import { InMemoryOAuthDiscoveryTransactionStore } from "../../src/platform/oauth-discovery-store.js";

describe("OAuth discovery transaction storage", () => {
  it("keeps the token out of the read view and consumes it exactly once", async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "a".repeat(64));
    const clock = vi.fn(() => 1000), store = new InMemoryOAuthDiscoveryTransactionStore(clock);
    await store.create({ transactionId: "tx", tenantId: "tenant", clientId: "client", operatorId: "operator", profileId: "marketing", appId: "300", token: "server-only-token", inspection: { provider: "META_MARKETING", appId: "300", subjectId: "operator", tokenType: "user", grantedScopes: ["public_profile", "ads_read"], expiresAt: 10000 }, candidates: [{ type: "AD_ACCOUNT", id: "123", providerAssetId: "123", evidence: { source: "META_ME_ADACCOUNTS", checkedAt: 1000, expiresAt: 9000 } }], expiresAt: 9000, expectedRevisions: { tenant: 1, member: 1, client: 1 } });
    const view = await store.read({ transactionId: "tx", tenantId: "tenant", clientId: "client", operatorId: "operator", now: 1000 });
    expect(view).toMatchObject({ profileId: "marketing", candidates: [{ id: "123" }] });
    expect(JSON.stringify(view)).not.toContain("server-only-token");
    const first = await store.consume({ transactionId: "tx", tenantId: "tenant", clientId: "client", operatorId: "operator", now: 1000 });
    expect(first?.token).toBe("server-only-token");
    expect(await store.consume({ transactionId: "tx", tenantId: "tenant", clientId: "client", operatorId: "operator", now: 1000 })).toBeNull();
  });

  it("expires pending transactions and isolates tenant/operator lookups", async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "b".repeat(64));
    const store = new InMemoryOAuthDiscoveryTransactionStore(() => 1000);
    await store.create({ transactionId: "tx2", tenantId: "tenant", clientId: "client", operatorId: "operator", profileId: "marketing", appId: "300", token: "token", inspection: { provider: "META_MARKETING", appId: "300", subjectId: "operator", tokenType: "user", grantedScopes: ["public_profile", "ads_read"], expiresAt: 10000 }, candidates: [{ type: "AD_ACCOUNT", id: "456", providerAssetId: "456", evidence: { source: "META_ME_ADACCOUNTS", checkedAt: 1000, expiresAt: 1500 } }], expiresAt: 1500, expectedRevisions: { tenant: 1, member: 1, client: 1 } });
    expect(await store.read({ transactionId: "tx2", tenantId: "other", clientId: "client", operatorId: "operator", now: 1000 })).toBeNull();
    expect(await store.read({ transactionId: "tx2", tenantId: "tenant", clientId: "client", operatorId: "operator", now: 1500 })).toBeNull();
  });
});

