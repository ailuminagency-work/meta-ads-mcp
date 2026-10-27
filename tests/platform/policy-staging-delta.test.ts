import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryPlatformRepository } from "../../src/platform/repository.js";
import { encryptCredential } from "../../src/platform/connections.js";
import { OwnershipEvidenceService } from "../../src/platform/ownership-service.js";
import { assertAgencyAdvertisingAuthorization, loadOwnershipEvidence } from "../../src/platform/ownership-evidence.js";
import { evaluatePolicy } from "../../src/platform/policy.js";
import { buildStrictLegacyWritePlan } from "../../src/platform/legacy-write.js";
import type { AuthorizationSnapshot, OperationClass, OperationContext, OperationPlan } from "../../src/platform/models.js";

const OWNER_SOURCE = "https://developers.facebook.com/docs/marketing-api/reference/ad-account/";
const owner: OperationContext = { principal: { tenantId: "tenant", operatorId: "100" }, clientId: "client", provider: "META_MARKETING", tool: "meta_observe_account_owner", requestId: "synthetic" };
const ctxFor = (tool: string): OperationContext => ({ ...owner, tool });

beforeEach(() => { vi.stubEnv("TOKEN_ENCRYPTION_KEY", "a".repeat(64)); vi.stubEnv("META_API_VERSION", "v26.0"); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function fixture(evidence: "full" | "access-only") {
  const repo = new InMemoryPlatformRepository(), now = Date.now();
  await repo.put("tenants", "tenant", "tenant", { id: "tenant", status: "ACTIVE", migrationState: "READY", policyRevision: 1, registryRevision: 1 });
  await repo.put("members", "tenant", "100", { operatorId: "100", tenantId: "tenant", roles: ["admin", "writer", "approver"], allowedClientIds: ["client"], revision: 1, disabledAt: null });
  await repo.put("clients", "tenant", "client", { id: "client", tenantId: "tenant", status: "ACTIVE", revision: 1, verifiedBusinessIds: ["900"] });
  const base = { tenantId: "tenant", clientId: "client", provider: "META_MARKETING" as const, appId: "300", verifiedAt: now, revokedAt: null, revision: 1 };
  await repo.put("assets", "tenant", "root", { ...base, key: "root", id: "101", type: "AD_ACCOUNT", parents: [] });
  await repo.put("connections", "tenant", "connection", { id: "connection", tenantId: "tenant", operatorId: "100", provider: "META_MARKETING", appId: "300", credentialId: "credential", authStrategy: "synthetic", tokenType: "user", scopes: ["ads_read"], assetKeys: ["root"], verifiedAt: now, expiresAt: now + 3600000, revokedAt: null, revision: 1, eligibility: [{ requirement: "marketing_read_access:v26.0", source: "https://developers.facebook.com/docs/permissions", verified: true, checkedAt: now, expiresAt: now + 300000 }] });
  await repo.put("grants", "tenant", "root", { id: "root", tenantId: "tenant", clientId: "client", assetKey: "root", connectionId: "connection", capabilities: ["legacy.ads_get_account_info"], actions: ["READ"], tasks: [], verifiedAt: now, expiresAt: now + 3600000, revokedAt: null, revision: 1 });
  await repo.put("credentials", "tenant", "credential", encryptCredential({ id: "credential", tenantId: "tenant", operatorId: "100", provider: "META_MARKETING", appId: "300", keyVersion: "primary" }, "synthetic-token"));
  await repo.put("operatorIndex", "_index", "100", { tenantId: "tenant", operatorId: "100" });
  if (evidence === "full") {
    await new OwnershipEvidenceService(repo).attest(owner.principal, "client", { accountKey: "root", businessId: "900", documentReferenceHash: "a".repeat(64), expiresAt: now + 86400000 });
    await new OwnershipEvidenceService(repo, async () => new Response(JSON.stringify({ id: "act_101", account_id: "101", business: { id: "900" } }))).observe(owner, "root", "connection");
  } else {
    const account = (await repo.get("assets", "tenant", "root"))!;
    await repo.put("assets", "tenant", "root", { ...account, ownerBusinessId: "900", ownershipEvidenceSource: OWNER_SOURCE, ownershipEvidenceVerifiedAt: now });
  }
  const connection = (await repo.get("connections", "tenant", "connection"))!;
  await repo.put("connections", "tenant", "connection", { ...connection, scopes: ["ads_read", "ads_management"] });
  const grant = (await repo.get("grants", "tenant", "root"))!;
  await repo.put("grants", "tenant", "root", { ...grant, actions: ["READ", "WRITE_AD_CONFIGURATION", "WRITE_BUDGET", "WRITE_CONTENT"] });
  return repo;
}

async function snapshotOf(repo: InMemoryPlatformRepository, mutate?: (s: AuthorizationSnapshot) => void): Promise<AuthorizationSnapshot> {
  const assets = [(await repo.get("assets", "tenant", "root"))!];
  const snapshot: AuthorizationSnapshot = {
    tenant: (await repo.get("tenants", "tenant", "tenant"))!,
    member: (await repo.get("members", "tenant", "100"))!,
    client: (await repo.get("clients", "tenant", "client"))!,
    assets,
    connection: (await repo.get("connections", "tenant", "connection"))!,
    grants: (await repo.list("grants", "tenant")).filter(grant => grant.assetKey === "root"),
    financialEvidence: await loadOwnershipEvidence(repo, owner, assets),
  };
  mutate?.(snapshot);
  return snapshot;
}

const createCampaign = (): OperationPlan => buildStrictLegacyWritePlan("ads_create_campaign", { account_id: "101", name: "Synthetic paused campaign", objective: "OUTCOME_TRAFFIC" });
const imageUpload = (): OperationPlan => ({ parameters: { asset_id: "act_101", input: { source_media_id: "jpeg_" + "b".repeat(64) } }, assets: [{ type: "AD_ACCOUNT", id: "act_101" }], classes: ["WRITE_CONTENT"], capability: "marketing.upload.image", requiredScopes: ["ads_management"], tokenTypes: ["user"] });
const asyncReport = (): OperationPlan => ({ parameters: { asset_id: "act_101", input: { since: "2026-01-01", until: "2026-01-02" } }, assets: [{ type: "AD_ACCOUNT", id: "act_101" }], classes: ["WRITE_CONTENT"], capability: "marketing.create.async.report", requiredScopes: ["ads_read"], tokenTypes: ["user", "system_user"] });

/** The account-authorization block of evaluatePolicy as it runs on staging (1f08563), reproduced from that commit. */
function stagingAccountGate(tool: string, plan: OperationPlan, snapshot: AuthorizationSnapshot): string {
  const classes = plan.classes as OperationClass[];
  const required = classes.some(c => ["WRITE_AD_CONFIGURATION", "WRITE_BUDGET", "ACTIVATE_SPEND"].includes(c));
  const accountMutationTool = ["marketing_upload_image", "marketing_upload_video", "marketing_create_empty_custom_audience", "marketing_create_lookalike_audience", "marketing_activate_ad", "marketing_delete_paused_ad", "marketing_create_purchase_conversion", "marketing_create_disabled_pause_rule", "marketing_create_classic_split_study"].includes(tool);
  if (!(required || (accountMutationTool && classes.some(c => c !== "READ")))) return "NOT_GATED";
  const account = snapshot.assets.filter(a => a.type === "AD_ACCOUNT");
  if (account.length !== 1) return "DENY:EXACT_CLIENT_AD_ACCOUNT_REQUIRED";
  try { assertAgencyAdvertisingAuthorization(snapshot, account[0], classes.filter(c => ["WRITE_AD_CONFIGURATION", "WRITE_BUDGET", "ACTIVATE_SPEND"].includes(c))); } catch (error) { return "DENY:" + (error as { reason?: string }).reason; }
  return "PASS";
}
const release = (tool: string, plan: OperationPlan, snapshot: AuthorizationSnapshot) => evaluatePolicy(ctxFor(tool), plan, snapshot, { writesEnabled: true });

describe("policy delta between staging 1f08563 and the release line", () => {
  it("is identical when full ownership and billing evidence and one exact grant exist", async () => {
    const repo = await fixture("full");
    for (const [tool, plan] of [["ads_create_campaign", createCampaign()], ["marketing_upload_image", imageUpload()]] as const) {
      const snapshot = await snapshotOf(repo);
      expect(stagingAccountGate(tool, plan, snapshot)).toBe("PASS");
      expect(release(tool, plan, snapshot)).toMatchObject({ decision: "REQUIRE_CONFIRMATION", reason: "HUMAN_APPROVAL_REQUIRED" });
    }
  });

  it("TIGHTENED: ad configuration without an owner billing attestation passed on staging and is now denied", async () => {
    const repo = await fixture("access-only"), plan = createCampaign(), snapshot = await snapshotOf(repo);
    expect(stagingAccountGate("ads_create_campaign", plan, snapshot)).toBe("PASS");
    expect(release("ads_create_campaign", plan, snapshot)).toMatchObject({ decision: "DENY", reason: "ACCOUNT_OWNERSHIP_UNVERIFIED" });
  });

  it("TIGHTENED: asynchronous report creation was ungated on staging and now needs owner billing evidence", async () => {
    const withoutEvidence = await fixture("access-only"), plan = asyncReport();
    const missing = await snapshotOf(withoutEvidence);
    expect(stagingAccountGate("marketing_create_async_report", plan, missing)).toBe("NOT_GATED");
    expect(release("marketing_create_async_report", plan, missing)).toMatchObject({ decision: "DENY", reason: "ACCOUNT_OWNERSHIP_UNVERIFIED" });
    const withEvidence = await snapshotOf(await fixture("full"));
    expect(release("marketing_create_async_report", plan, withEvidence)).toMatchObject({ decision: "REQUIRE_CONFIRMATION" });
  });

  it("ignores a never-verified twin grant exactly as staging did and denies two verified grants on both lines", async () => {
    const repo = await fixture("full"), plan = imageUpload();
    const withTwin = await snapshotOf(repo, s => { s.grants = [...s.grants, { ...s.grants[0], id: "unverified-twin", verifiedAt: 0 }]; });
    expect(stagingAccountGate("marketing_upload_image", plan, withTwin)).toBe("PASS");
    expect(release("marketing_upload_image", plan, withTwin).decision).toBe("REQUIRE_CONFIRMATION");
    const verifiedTwin = await snapshotOf(repo, s => { s.grants = [...s.grants, { ...s.grants[0], id: "verified-twin" }]; });
    expect(stagingAccountGate("marketing_upload_image", plan, verifiedTwin)).toBe("DENY:SCOPED_AD_ACCOUNT_AUTHORIZATION_REQUIRED");
    expect(release("marketing_upload_image", plan, verifiedTwin)).toMatchObject({ decision: "DENY", reason: "SCOPED_AD_ACCOUNT_AUTHORIZATION_REQUIRED" });
  });

  it("is never looser than staging for a grant whose verification time is in the future", async () => {
    const repo = await fixture("full"), plan = imageUpload();
    const snapshot = await snapshotOf(repo, s => { s.grants = s.grants.map(g => ({ ...g, verifiedAt: Date.now() + 3600000 })); });
    expect(stagingAccountGate("marketing_upload_image", plan, snapshot)).toBe("DENY:SCOPED_AD_ACCOUNT_AUTHORIZATION_REQUIRED");
    expect(release("marketing_upload_image", plan, snapshot).decision).toBe("DENY");
  });

  it.each([
    ["a connection that belongs to another operator", (s: AuthorizationSnapshot) => { s.connection = { ...s.connection, operatorId: "999" }; }],
    ["a connection without the ads_management scope", (s: AuthorizationSnapshot) => { s.connection = { ...s.connection, scopes: ["ads_read"] }; }],
    ["a revoked connection", (s: AuthorizationSnapshot) => { s.connection = { ...s.connection, revokedAt: Date.now() }; }],
    ["a connection that does not list the account", (s: AuthorizationSnapshot) => { s.connection = { ...s.connection, assetKeys: [] }; }],
  ])("is never looser than staging for %s", async (_label, mutate) => {
    const repo = await fixture("full");
    for (const [tool, plan] of [["ads_create_campaign", createCampaign()], ["marketing_upload_image", imageUpload()]] as const) {
      const snapshot = await snapshotOf(repo, mutate);
      expect(stagingAccountGate(tool, plan, snapshot).startsWith("DENY:")).toBe(true);
      expect(release(tool, plan, snapshot).decision).toBe("DENY");
    }
  });

  it("keeps ACTIVE as a spend activation class and keeps creates paused on both lines", async () => {
    const repo = await fixture("full"), snapshot = await snapshotOf(repo);
    const activate: OperationPlan = { ...imageUpload(), classes: ["WRITE_AD_CONFIGURATION"], parameters: { status: "ACTIVE" } };
    expect(release("ads_update_campaign", activate, snapshot).classes).toContain("ACTIVATE_SPEND");
    expect(() => release("ads_create_campaign", { ...createCampaign(), parameters: { status: "ACTIVE" } }, snapshot)).toThrow("CREATE_MUST_REMAIN_PAUSED");
  });
});
