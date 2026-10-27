import { assetKey } from "../../../src/platform/assets.js";
import { prepareClientAssetReassociation } from "../../../src/platform/client-asset-reassociation.js";
import { encryptOAuthDiscoveryInspection, oauthDiscoveryHash, type OAuthDiscoveryProposal } from "../../../src/platform/oauth-discovery.js";
import type { AssetGrant, Client, Connection, Member, MetaAsset, Tenant } from "../../../src/platform/models.js";
import type { ControlCommit, PlatformRepository } from "../../../src/platform/repository.js";

export const PROVIDER_SOURCE = "https://developers.facebook.com/docs/marketing-api/";
export const CAPABILITIES = ["legacy.ads_get_ad_accounts", "legacy.ads_get_account_info", "legacy.ads_get_campaigns", "legacy.ads_get_ad_sets", "legacy.ads_get_ads", "legacy.ads_get_insights"];

export interface RegistryIds {
  tenantId: string; operatorId: string; oldClientId: string; targetClientId: string;
  accountId: string; ownerBusinessId: string; appId: string; connectionId: string; grantId: string;
}

export const TENANT_A: RegistryIds = {
  tenantId: "tenant-a", operatorId: "10228464085301890", oldClientId: "internal", targetClientId: "client-b",
  accountId: "1383983957242175", ownerBusinessId: "114286761376026", appId: "1516397820295451", connectionId: "connection-a", grantId: "grant-a",
};

export const TENANT_B: RegistryIds = {
  tenantId: "tenant-b", operatorId: "20228464085301890", oldClientId: "internal", targetClientId: "client-b",
  accountId: "2383983957242175", ownerBusinessId: "214286761376026", appId: "1516397820295451", connectionId: "connection-b", grantId: "grant-b",
};

export interface Registry {
  ids: RegistryIds; tenant: Tenant; member: Member; oldClient: Client; targetClient: Client;
  asset: MetaAsset; connection: Connection; grant: AssetGrant; now: number;
}

/** Builds and stores one tenant's registry exactly as a reviewed bootstrap would. */
export async function seedRegistry(repo: PlatformRepository & { put: (...args: never[]) => Promise<void> }, ids: RegistryIds): Promise<Registry> {
  const now = Date.now();
  const put = (repo.put as unknown as (collection: string, tenantId: string, id: string, value: unknown) => Promise<void>).bind(repo);
  const tenant: Tenant = { id: ids.tenantId, status: "ACTIVE", policyRevision: 1, registryRevision: 1, migrationState: "READY" };
  const member: Member = { operatorId: ids.operatorId, tenantId: ids.tenantId, roles: ["connection_admin", "reader"], allowedClientIds: [ids.oldClientId, ids.targetClientId], revision: 4, disabledAt: null };
  const oldClient: Client = { id: ids.oldClientId, tenantId: ids.tenantId, status: "ACTIVE", revision: 1, verifiedBusinessIds: [] };
  const targetClient: Client = { id: ids.targetClientId, tenantId: ids.tenantId, status: "ACTIVE", revision: 1, verifiedBusinessIds: [ids.ownerBusinessId] };
  const asset: MetaAsset = { key: "", id: ids.accountId, type: "AD_ACCOUNT", tenantId: ids.tenantId, clientId: ids.oldClientId, provider: "META_MARKETING", appId: ids.appId, parents: [], verifiedAt: now - 1000, revokedAt: null, revision: 3, ownerBusinessId: ids.ownerBusinessId };
  asset.key = assetKey(asset.provider, asset.appId, asset);
  const connection: Connection = {
    id: ids.connectionId, tenantId: ids.tenantId, operatorId: ids.operatorId, subjectId: ids.operatorId, metaAppUserId: ids.operatorId, provider: "META_MARKETING",
    authStrategy: "facebook_business", credentialId: `credential-${ids.tenantId}`, appId: ids.appId, tokenType: "user", scopes: ["public_profile", "ads_read"], assetKeys: [asset.key],
    verifiedAt: now - 1000, expiresAt: now + 3_600_000, revokedAt: null, revision: 3,
    eligibility: [{ requirement: "marketing_read_access:v26.0", source: PROVIDER_SOURCE, checkedAt: now - 1000, expiresAt: now + 3_599_000, verified: true }],
  };
  const grant: AssetGrant = { id: ids.grantId, tenantId: ids.tenantId, clientId: ids.oldClientId, assetKey: asset.key, connectionId: ids.connectionId, capabilities: [...CAPABILITIES], actions: ["READ"], tasks: [], verifiedAt: now - 1000, expiresAt: now + 3_599_000, revokedAt: null, revision: 4 };
  await put("tenants", ids.tenantId, ids.tenantId, tenant);
  await put("operatorIndex", "_index", ids.operatorId, { operatorId: ids.operatorId, tenantId: ids.tenantId });
  await put("members", ids.tenantId, ids.operatorId, member);
  await put("clients", ids.tenantId, ids.oldClientId, oldClient);
  await put("clients", ids.tenantId, ids.targetClientId, targetClient);
  await put("assets", ids.tenantId, asset.key, asset);
  await put("connections", ids.tenantId, ids.connectionId, connection);
  await put("grants", ids.tenantId, ids.grantId, grant);
  return { ids, tenant, member, oldClient, targetClient, asset, connection, grant, now };
}

/** A validator-complete reassociation commit backed by an encrypted discovery proposal stored in the repository. */
export async function trustedReassociation(
  repo: PlatformRepository & { put: (...args: never[]) => Promise<void> },
  registry: Registry,
  auditId: string,
  overrides: { targetClient?: Client; member?: Member } = {},
): Promise<{ commit: ControlCommit; proposal: OAuthDiscoveryProposal }> {
  const { ids } = registry;
  const target = overrides.targetClient ?? registry.targetClient;
  const member = overrides.member ?? registry.member;
  const now = Date.now();
  const selected = [{ type: "AD_ACCOUNT" as const, id: ids.accountId, tasks: [] as string[], businessId: ids.ownerBusinessId }];
  const proposal: OAuthDiscoveryProposal = {
    id: `proposal-${auditId}`, kind: "OAUTH_ASSET_DISCOVERY", tenantId: ids.tenantId, clientId: target.id, operatorId: ids.operatorId, profileId: "meta", provider: "META_MARKETING", appId: ids.appId,
    subjectId: ids.operatorId, grantedScopes: ["public_profile", "ads_read"], assets: selected, checkedAt: now, expiresAt: now + 240_000, consumedAt: null,
    expected: [
      { collection: "tenants", id: ids.tenantId, canonical: JSON.stringify(registry.tenant) },
      { collection: "members", id: ids.operatorId, canonical: JSON.stringify(member) },
      { collection: "clients", id: registry.oldClient.id, canonical: JSON.stringify(registry.oldClient) },
      { collection: "clients", id: target.id, canonical: JSON.stringify(target) },
    ],
    encryptedInspection: { ciphertext: "", iv: "", tag: "" }, planHash: "",
  };
  proposal.encryptedInspection = encryptOAuthDiscoveryInspection(proposal, {
    accessToken: "synthetic", provider: "META_MARKETING", appId: ids.appId, subjectId: ids.operatorId, tokenType: "user", grantedScopes: ["public_profile", "ads_read"], expiresAt: now + 240_000, assets: selected,
  });
  proposal.planHash = oauthDiscoveryHash(proposal);
  const put = (repo.put as unknown as (collection: string, tenantId: string, id: string, value: unknown) => Promise<void>).bind(repo);
  await put("discoveryProposals", ids.tenantId, proposal.id, proposal);
  const commit = prepareClientAssetReassociation({
    tenant: structuredClone(registry.tenant), member: structuredClone(member), oldClient: structuredClone(registry.oldClient), asset: structuredClone(registry.asset),
    connection: structuredClone(registry.connection), grant: structuredClone(registry.grant),
    targetClientId: target.id, targetClient: structuredClone(target), discoveryProposal: structuredClone(proposal),
    providerEvidence: { accountId: ids.accountId, ownerBusinessId: ids.ownerBusinessId, appId: ids.appId, provider: "META_MARKETING", checkedAt: now, expiresAt: now + 240_000, source: PROVIDER_SOURCE },
    auditId, planHash: proposal.planHash,
  });
  return { commit, proposal };
}

/** Every record of one tenant, for exact before/after comparison. */
export async function dumpTenant(repo: PlatformRepository, tenantId: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const collection of ["tenants", "members", "clients", "assets", "connections", "grants", "discoveryProposals"] as const) {
    out[collection] = collection === "tenants" ? await repo.get("tenants", tenantId, tenantId) : (await repo.list(collection, tenantId)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return out;
}
