import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assetKey } from "../../src/platform/assets.js";
import { prepareClientAssetReassociation as prepareHead } from "../../src/platform/client-asset-reassociation.js";
import { encryptOAuthDiscoveryInspection, oauthDiscoveryHash, type OAuthDiscoveryProposal } from "../../src/platform/oauth-discovery.js";
import type { AssetGrant, Client, Connection, Member, MetaAsset, Tenant } from "../../src/platform/models.js";
import { FirestorePlatformRepository as HeadRepo } from "../../src/platform/repository.js";
import { prepareClientAssetReassociation as prepareStaging } from "../fixtures/crypto/staging-1f08563/platform/client-asset-reassociation.js";
import { FirestorePlatformRepository as StagingRepo } from "../fixtures/crypto/staging-1f08563/platform/repository.js";
import { ENVS, restoreKeyEnv, useKeyEnv } from "../fixtures/crypto/compat-harness.js";
import { FakeFirestore } from "../fixtures/crypto/fake-firestore.js";

const tenantId = "tenant", operatorId = "10228464085301890", oldClientId = "internal", firstClientId = "client-a", secondClientId = "client-b";
const accountId = "1383983957242175", ownerBusinessId = "114286761376026", appId = "1516397820295451", connectionId = "connection", grantId = "grant";
const PROVIDER_SOURCE = "https://developers.facebook.com/docs/marketing-api/";
const capabilities = ["legacy.ads_get_ad_accounts", "legacy.ads_get_account_info", "legacy.ads_get_campaigns", "legacy.ads_get_ad_sets", "legacy.ads_get_ads", "legacy.ads_get_insights"];

let db: FakeFirestore;
let staging: StagingRepo;
let head: HeadRepo;

interface State { tenant: Tenant; member: Member; oldClient: Client; asset: MetaAsset; connection: Connection; grant: AssetGrant; now: number }

async function seed(): Promise<State> {
  const now = Date.now();
  const tenant: Tenant = { id: tenantId, status: "ACTIVE", policyRevision: 1, registryRevision: 1, migrationState: "READY" };
  const member: Member = { operatorId, tenantId, roles: ["connection_admin", "reader"], allowedClientIds: [oldClientId], revision: 4, disabledAt: null };
  const oldClient: Client = { id: oldClientId, tenantId, status: "ACTIVE", revision: 1, verifiedBusinessIds: [] };
  const asset: MetaAsset = { key: "", id: accountId, type: "AD_ACCOUNT", tenantId, clientId: oldClientId, provider: "META_MARKETING", appId, parents: [], verifiedAt: now - 1000, revokedAt: null, revision: 3, ownerBusinessId };
  asset.key = assetKey(asset.provider, asset.appId, asset);
  const connection: Connection = {
    id: connectionId, tenantId, operatorId, subjectId: operatorId, metaAppUserId: operatorId, provider: "META_MARKETING", authStrategy: "facebook_business",
    credentialId: "credential", appId, tokenType: "user", scopes: ["public_profile", "ads_read"], assetKeys: [asset.key], verifiedAt: now - 1000, expiresAt: now + 3_600_000,
    revokedAt: null, revision: 3,
    eligibility: [{ requirement: "marketing_read_access:v26.0", source: PROVIDER_SOURCE, checkedAt: now - 1000, expiresAt: now + 3_599_000, verified: true }],
  };
  const grant: AssetGrant = { id: grantId, tenantId, clientId: oldClientId, assetKey: asset.key, connectionId, capabilities, actions: ["READ"], tasks: [], verifiedAt: now - 1000, expiresAt: now + 3_599_000, revokedAt: null, revision: 4 };
  await staging.put("tenants", tenantId, tenantId, tenant);
  await staging.put("operatorIndex", "_index", operatorId, { operatorId, tenantId } as never);
  await staging.put("members", tenantId, operatorId, member);
  await staging.put("clients", tenantId, oldClientId, oldClient);
  await staging.put("assets", tenantId, asset.key, asset);
  await staging.put("connections", tenantId, connectionId, connection);
  await staging.put("grants", tenantId, grantId, grant);
  return { tenant, member, oldClient, asset, connection, grant, now };
}

async function stagingReassociation(state: State, auditId: string) {
  const checkedAt = Date.now() - 500;
  const commit = prepareStaging({
    tenant: state.tenant, member: state.member, oldClient: state.oldClient, asset: state.asset, connection: state.connection, grant: state.grant,
    targetClientId: firstClientId,
    providerEvidence: { accountId, ownerBusinessId, appId, provider: "META_MARKETING", checkedAt, expiresAt: checkedAt + 240_000, source: PROVIDER_SOURCE },
    auditId, planHash: "a".repeat(64),
  });
  await staging.commitControlPlane(commit);
  return commit;
}

async function everyRecord(repo: StagingRepo | HeadRepo) {
  return {
    tenant: await repo.get("tenants", tenantId, tenantId),
    member: await repo.get("members", tenantId, operatorId),
    clients: (await repo.list("clients", tenantId)).sort((a, b) => a.id.localeCompare(b.id)),
    assets: await repo.list("assets", tenantId),
    connections: await repo.list("connections", tenantId),
    grants: await repo.list("grants", tenantId),
    principal: await repo.resolvePrincipal(operatorId),
  };
}

async function headHop(input: { tenant: Tenant; member: Member; sourceClient: Client; asset: MetaAsset; connection: Connection; grant: AssetGrant; targetClient: Client; auditId: string }) {
  const now = Date.now();
  const proposal: OAuthDiscoveryProposal = {
    id: `proposal-${input.auditId}`, kind: "OAUTH_ASSET_DISCOVERY", tenantId, clientId: input.targetClient.id, operatorId, profileId: "meta", provider: "META_MARKETING", appId,
    subjectId: operatorId, grantedScopes: ["public_profile", "ads_read"], assets: [{ type: "AD_ACCOUNT", id: accountId, tasks: [], businessId: ownerBusinessId }],
    checkedAt: now, expiresAt: now + 240_000, consumedAt: null,
    expected: [
      { collection: "tenants", id: tenantId, canonical: JSON.stringify(input.tenant) },
      { collection: "members", id: operatorId, canonical: JSON.stringify(input.member) },
      { collection: "clients", id: input.sourceClient.id, canonical: JSON.stringify(input.sourceClient) },
      { collection: "clients", id: input.targetClient.id, canonical: JSON.stringify(input.targetClient) },
    ],
    encryptedInspection: { ciphertext: "", iv: "", tag: "" }, planHash: "",
  };
  proposal.encryptedInspection = encryptOAuthDiscoveryInspection(proposal, {
    accessToken: "synthetic", provider: "META_MARKETING", appId, subjectId: operatorId, tokenType: "user", grantedScopes: ["public_profile", "ads_read"],
    expiresAt: now + 240_000, assets: [{ type: "AD_ACCOUNT", id: accountId, tasks: [], businessId: ownerBusinessId }],
  });
  proposal.planHash = oauthDiscoveryHash(proposal);
  await head.put("discoveryProposals", tenantId, proposal.id, proposal as never);
  const commit = prepareHead({
    tenant: input.tenant, member: input.member, oldClient: input.sourceClient, asset: input.asset, connection: input.connection, grant: input.grant,
    targetClientId: input.targetClient.id, targetClient: input.targetClient, discoveryProposal: proposal,
    providerEvidence: { accountId, ownerBusinessId, appId, provider: "META_MARKETING", checkedAt: now, expiresAt: now + 240_000, source: PROVIDER_SOURCE },
    auditId: input.auditId, planHash: proposal.planHash,
  });
  await head.commitControlPlane(commit);
  return { proposal, now };
}

beforeEach(() => {
  useKeyEnv(ENVS.k1Only);
  db = new FakeFirestore();
  staging = new StagingRepo(db as never);
  head = new HeadRepo(db as never);
});
afterEach(() => restoreKeyEnv());

describe("records written by staging@1f08563 are read, unchanged, by the release line", () => {
  it("returns identical registry records, principal and CAS-relevant fields after a staging reassociation", async () => {
    const state = await seed();
    await stagingReassociation(state, "audit-staging-1");

    const written = await everyRecord(staging);
    const read = await everyRecord(head);
    expect(read).toEqual(written);
    expect([...db.docs.keys()].filter((entry) => entry.includes("/controlAudit/"))).toHaveLength(1);
    expect(read.principal).toEqual({ operatorId, tenantId });
    expect(read.assets).toHaveLength(1);
    expect(read.assets[0]).toMatchObject({ clientId: firstClientId, revision: state.asset.revision + 1 });
    expect(read.grants[0]).toMatchObject({ clientId: firstClientId, revision: state.grant.revision + 1, actions: ["READ"] });
    expect(read.connections[0].revision).toBe(state.connection.revision + 1);
    expect(read.connections[0].eligibility).toHaveLength(2);
    expect(read.member!.allowedClientIds).toEqual([oldClientId, firstClientId]);
    expect(read.clients.map((client) => client.id)).toEqual([firstClientId, oldClientId]);
    for (const path of [...db.docs.keys()].filter((entry) => /\/(assets|connections|grants|clients|members)\//.test(entry))) {
      expect(db.read(path)).not.toHaveProperty("expireTime");
    }
  });

  it("lets the release line continue the reassociation chain over staging-written data (the CAS snapshot matches byte for byte)", async () => {
    const state = await seed();
    await stagingReassociation(state, "audit-staging-2");

    const afterStaging = await everyRecord(head);
    const secondClient: Client = { id: secondClientId, tenantId, status: "ACTIVE", revision: 1, verifiedBusinessIds: [ownerBusinessId] };
    const widenedMember: Member = { ...afterStaging.member!, allowedClientIds: [...afterStaging.member!.allowedClientIds, secondClientId], revision: afterStaging.member!.revision + 1 };
    await head.put("clients", tenantId, secondClientId, secondClient);
    await head.put("members", tenantId, operatorId, widenedMember);

    const asset = afterStaging.assets[0], connection = afterStaging.connections[0], grant = afterStaging.grants[0];
    const sourceClient = afterStaging.clients.find((client) => client.id === firstClientId)!;
    const { proposal, now } = await headHop({ tenant: state.tenant, member: widenedMember, sourceClient, asset, connection, grant, targetClient: secondClient, auditId: "audit-head-1" });

    const final = await everyRecord(head);
    expect(final.assets[0]).toMatchObject({ clientId: secondClientId, revision: asset.revision + 1 });
    expect(final.grants[0]).toMatchObject({ clientId: secondClientId, revision: grant.revision + 1 });
    expect(await head.get("discoveryProposals", tenantId, proposal.id)).toMatchObject({ consumedAt: now });
    expect(db.read([...db.docs.keys()].find((entry) => entry.includes("/discoveryProposals/"))!)).toHaveProperty("expireTime");
  });

  it("does not let the release line commit a proof-only reassociation prepared by staging code (in-flight commits are deliberately not portable)", async () => {
    const state = await seed();
    const checkedAt = Date.now() - 500;
    const commit = prepareStaging({
      tenant: state.tenant, member: state.member, oldClient: state.oldClient, asset: state.asset, connection: state.connection, grant: state.grant,
      targetClientId: firstClientId,
      providerEvidence: { accountId, ownerBusinessId, appId, provider: "META_MARKETING", checkedAt, expiresAt: checkedAt + 240_000, source: PROVIDER_SOURCE },
      auditId: "audit-in-flight", planHash: "b".repeat(64),
    });
    await expect(head.commitControlPlane(commit)).rejects.toThrow("CLIENT_ASSET_REASSOCIATION_EXACT_SCOPE_REQUIRED");
    const unchanged = await everyRecord(head);
    expect(unchanged.assets[0].clientId).toBe(oldClientId);
    expect(db.docs.size).toBeGreaterThan(0);
    expect([...db.docs.keys()].some((entry) => entry.includes("/controlAudit/"))).toBe(false);
  });
});

describe("records written by the release line are read by staging@1f08563", () => {
  it("reads release-line reassociation results with the staging repository", async () => {
    const state = await seed();
    const target: Client = { id: secondClientId, tenantId, status: "ACTIVE", revision: 1, verifiedBusinessIds: [ownerBusinessId] };
    const widenedMember: Member = { ...state.member, allowedClientIds: [oldClientId, secondClientId], revision: state.member.revision + 1 };
    await head.put("clients", tenantId, secondClientId, target);
    await head.put("members", tenantId, operatorId, widenedMember);
    await headHop({ tenant: state.tenant, member: widenedMember, sourceClient: state.oldClient, asset: state.asset, connection: state.connection, grant: state.grant, targetClient: target, auditId: "audit-head-2" });

    const written = await everyRecord(head);
    const read = await everyRecord(staging);
    expect(read).toEqual(written);
    expect(read.assets[0]).toMatchObject({ clientId: secondClientId });
    expect(read.principal).toEqual({ operatorId, tenantId });
  });
});
