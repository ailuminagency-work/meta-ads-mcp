import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import { encryptCredential } from "../../src/platform/connections.js";
import { OwnershipEvidenceService } from "../../src/platform/ownership-service.js";
import { authorizeOperation } from "../../src/platform/execution.js";
import { buildStrictLegacyWritePlan } from "../../src/platform/legacy-write.js";
import type { OperationContext, OperationPlan } from "../../src/platform/models.js";

/**
 * Staging 1f08563 reassociates a client's ad account by rewriting the asset with its new client and ownerBusinessId.
 * It writes no owner billing attestation and no ownership observation, which the release policy requires for any
 * account mutation. The account must therefore be readable at once, and every account mutation must fail closed
 * until fresh ownership evidence exists and again when that evidence is older than its five minute observation window.
 */
const OWNER_SOURCE = "https://developers.facebook.com/docs/marketing-api/reference/ad-account/";
const principal = { tenantId: "tenant", operatorId: "100" };
const ctxFor = (tool: string): OperationContext => ({ principal, clientId: "client", provider: "META_MARKETING", tool, requestId: "synthetic" });

beforeEach(() => { vi.stubEnv("TOKEN_ENCRYPTION_KEY", "a".repeat(64)); vi.stubEnv("META_API_VERSION", "v26.0"); vi.stubEnv("META_APP_ID", "300"); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const capabilities = ["legacy.ads_get_account_info", "legacy.ads_create_campaign", "marketing.create.async.report", "marketing.upload.image"];
async function reassociatedAccount(): Promise<InMemoryPlatformRepository> {
  const repo = new InMemoryPlatformRepository(), now = Date.now();
  await repo.put("tenants", "tenant", "tenant", { id: "tenant", status: "ACTIVE", migrationState: "READY", policyRevision: 1, registryRevision: 1 });
  await repo.put("members", "tenant", "100", { operatorId: "100", tenantId: "tenant", roles: ["admin", "writer", "approver"], allowedClientIds: ["client"], revision: 1, disabledAt: null });
  await repo.put("clients", "tenant", "client", { id: "client", tenantId: "tenant", status: "ACTIVE", revision: 1, verifiedBusinessIds: ["900"] });
  await repo.put("operatorIndex", "_index", "100", principal);
  await repo.put("assets", "tenant", "root", { tenantId: "tenant", clientId: "client", provider: "META_MARKETING", appId: "300", verifiedAt: now, revokedAt: null, revision: 2, key: "root", id: "101", type: "AD_ACCOUNT", parents: [], ownerBusinessId: "900", ownershipEvidenceSource: OWNER_SOURCE, ownershipEvidenceVerifiedAt: now });
  const eligibility = ["marketing_read_access:v26.0", "marketing_write_access:v26.0"].map(requirement => ({ requirement, source: "https://developers.facebook.com/docs/permissions", verified: true, checkedAt: now, expiresAt: now + 3600000 }));
  await repo.put("connections", "tenant", "connection", { id: "connection", tenantId: "tenant", operatorId: "100", provider: "META_MARKETING", appId: "300", credentialId: "credential", authStrategy: "synthetic", tokenType: "user", scopes: ["ads_read", "ads_management", "pages_read_engagement", "pages_show_list"], assetKeys: ["root"], verifiedAt: now, expiresAt: now + 3600000, revokedAt: null, revision: 1, eligibility });
  await repo.put("grants", "tenant", "root", { id: "root", tenantId: "tenant", clientId: "client", assetKey: "root", connectionId: "connection", capabilities, actions: ["READ", "WRITE_AD_CONFIGURATION", "WRITE_BUDGET", "WRITE_CONTENT"], tasks: [], verifiedAt: now, expiresAt: now + 3600000, revokedAt: null, revision: 1 });
  await repo.put("credentials", "tenant", "credential", encryptCredential({ id: "credential", tenantId: "tenant", operatorId: "100", provider: "META_MARKETING", appId: "300", keyVersion: "primary" }, "synthetic-token"));
  return repo;
}
async function establishFreshEvidence(repo: InMemoryPlatformRepository): Promise<void> {
  const service = new OwnershipEvidenceService(repo, async () => new Response(JSON.stringify({ id: "act_101", account_id: "101", business: { id: "900" } })));
  await service.attest(principal, "client", { accountKey: "root", businessId: "900", documentReferenceHash: "a".repeat(64), expiresAt: Date.now() + 86400000 });
  await service.observe(ctxFor("meta_observe_account_owner"), "root", "connection");
}

/** Keeps the registration itself current so that only the age of the ownership observation can explain a denial. */
async function refreshRegistration(repo: InMemoryPlatformRepository, at: number): Promise<void> {
  const asset = (await repo.get("assets", "tenant", "root"))!, connection = (await repo.get("connections", "tenant", "connection"))!, grant = (await repo.get("grants", "tenant", "root"))!;
  await repo.put("assets", "tenant", "root", { ...asset, verifiedAt: at, revision: asset.revision + 1 });
  await repo.put("connections", "tenant", "connection", { ...connection, verifiedAt: at, expiresAt: at + 3600000, revision: connection.revision + 1, eligibility: (connection.eligibility ?? []).map(e => ({ ...e, checkedAt: at, expiresAt: at + 3600000 })) });
  await repo.put("grants", "tenant", "root", { ...grant, verifiedAt: at, expiresAt: at + 3600000, revision: grant.revision + 1 });
}

const readPlan = (): OperationPlan => ({ parameters: {}, assets: [{ type: "AD_ACCOUNT", id: "101" }], classes: ["READ"], capability: "legacy.ads_get_account_info", requiredScopes: ["ads_read"], tokenTypes: ["user"] });
const MUTATIONS: Array<[string, () => OperationPlan]> = [
  ["ads_create_campaign", () => buildStrictLegacyWritePlan("ads_create_campaign", { account_id: "101", name: "Synthetic paused campaign", objective: "OUTCOME_TRAFFIC" })],
  ["marketing_create_async_report", () => ({ parameters: { asset_id: "act_101", input: { since: "2026-01-01", until: "2026-01-02" } }, assets: [{ type: "AD_ACCOUNT", id: "act_101" }], classes: ["WRITE_CONTENT"], capability: "marketing.create.async.report", requiredScopes: ["ads_read"], tokenTypes: ["user", "system_user"] })],
  ["marketing_upload_image", () => ({ parameters: { asset_id: "act_101", input: { source_media_id: "jpeg_" + "b".repeat(64) } }, assets: [{ type: "AD_ACCOUNT", id: "act_101" }], classes: ["WRITE_CONTENT"], capability: "marketing.upload.image", requiredScopes: ["ads_management"], tokenTypes: ["user"] })],
];
const authorizeWrite = (repo: InMemoryPlatformRepository, tool: string, plan: OperationPlan, approvalId?: string) => authorizeOperation(repo, ctxFor(tool), plan, { writesEnabled: true, ...(approvalId ? { approvalId } : {}) });

describe("an account reassociated by staging 1f08563", () => {
  it("can still be read", async () => {
    const repo = await reassociatedAccount();
    const permit = await authorizeOperation(repo, ctxFor("ads_get_account_info"), readPlan(), { writesEnabled: false });
    expect(permit.operationId).toBeTruthy();
    expect(await repo.list("operations", "tenant")).toHaveLength(0);
  });

  it.each(MUTATIONS)("denies %s with ACCOUNT_OWNERSHIP_UNVERIFIED and prepares nothing", async (tool, plan) => {
    const repo = await reassociatedAccount();
    await expect(authorizeWrite(repo, tool, plan())).rejects.toThrow("ACCOUNT_OWNERSHIP_UNVERIFIED");
    await expect(authorizeWrite(repo, tool, plan(), "any-approval-id")).rejects.toThrow("ACCOUNT_OWNERSHIP_UNVERIFIED");
    expect(await repo.list("operations", "tenant")).toHaveLength(0);
    expect(await repo.list("approvals", "tenant")).toHaveLength(0);
  });

  it.each(MUTATIONS)("moves %s on to human approval once fresh evidence exists, and denies it again when the observation goes stale", async (tool, plan) => {
    const repo = await reassociatedAccount();
    await establishFreshEvidence(repo);
    await expect(authorizeWrite(repo, tool, plan())).rejects.toThrow("HUMAN_APPROVAL_REQUIRED");
    const later = Date.now() + 6 * 60_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    await refreshRegistration(repo, later);
    await expect(authorizeOperation(repo, ctxFor(tool), plan(), { writesEnabled: true, now: later })).rejects.toThrow("ACCOUNT_OWNERSHIP_UNVERIFIED");
    expect(await repo.list("operations", "tenant")).toHaveLength(0);
  });
});
