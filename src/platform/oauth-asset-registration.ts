import { randomUUID } from "node:crypto";
import { assetKey } from "./assets.js";
import { canonicalJson } from "./policy.js";
import { clientBusinessExpected, loadClientBusinessEvidence } from "./client-business.js";
import type { AssetRef, MetaAsset } from "./models.js";
import { PlatformDenied } from "./models.js";
import type { PlatformRepository } from "./repository.js";
import type { OAuthAssetDiscoveryCandidate, OAuthAssetRegistrationBridge } from "./oauth-discovery.js";

/** Narrow registry adapter for first-time OAuth. It only creates selected AD_ACCOUNT roots. */
export class PlatformOAuthAssetRegistrationBridge implements OAuthAssetRegistrationBridge {
  constructor(private readonly repository: PlatformRepository, private readonly now: () => number = Date.now) {}
  async begin(input: Parameters<OAuthAssetRegistrationBridge["begin"]>[0]) {
    if (input.expiresAt <= this.now() || input.candidates.length < 1 || input.candidates.length > 98) throw new PlatformDenied("OAUTH_DISCOVERY_REGISTRATION_EXPIRED");
    return { transactionId: input.transactionId, expiresAt: input.expiresAt, candidates: structuredClone(input.candidates), registrationId: randomUUID(), revision: input.expectedRevisions.client };
  }
  async commit(input: Parameters<OAuthAssetRegistrationBridge["commit"]>[0]) {
    const principal = await this.repository.resolvePrincipal(input.operatorId);
    if (!principal || principal.tenantId !== input.tenantId) throw new PlatformDenied("OAUTH_DISCOVERY_OPERATOR_CHANGED");
    const [tenant, member, client, registered] = await Promise.all([
      this.repository.get("tenants", input.tenantId, input.tenantId),
      this.repository.get("members", input.tenantId, input.operatorId),
      this.repository.get("clients", input.tenantId, input.clientId),
      this.repository.list("assets", input.tenantId),
    ]);
    if (!tenant || tenant.status !== "ACTIVE" || tenant.migrationState !== "READY" || !member || member.disabledAt !== null || !member.allowedClientIds.includes(input.clientId) || !member.roles.some(r => r === "admin" || r === "connection_admin") || !client || client.status !== "ACTIVE" || client.revision !== input.expectedRevision || registered.some(a => a.clientId === input.clientId && a.provider === input.provider && a.appId === input.appId && a.revokedAt === null)) throw new PlatformDenied("OAUTH_DISCOVERY_REGISTRATION_CONTEXT_CHANGED");
    if (!input.selectedAssets.length || input.selectedAssets.length > 98 || input.selectedAssets.some(a => a.type !== "AD_ACCOUNT" || !/^\d{1,100}$/.test(a.id))) throw new PlatformDenied("OAUTH_DISCOVERY_ASSET_SELECTION_INVALID");
    const businessOwnerEvidence = await loadClientBusinessEvidence(this.repository, client);
    const now = this.now();
    const assets: MetaAsset[] = input.selectedAssets.map(ref => ({ key: assetKey(input.provider, input.appId, ref), tenantId: input.tenantId, clientId: input.clientId, provider: input.provider, appId: input.appId, type: ref.type, id: ref.id, parents: [], verifiedAt: now, revokedAt: null, revision: 1 }));
    if (!assets[0]?.appId || assets.some(a => registered.some(r => r.key === a.key))) throw new PlatformDenied("OAUTH_DISCOVERY_ASSET_ALREADY_REGISTERED");
    const expected = [{ collection: "tenants" as const, id: tenant.id, canonical: canonicalJson(tenant) }, { collection: "members" as const, id: member.operatorId, canonical: canonicalJson(member) }, { collection: "clients" as const, id: client.id, canonical: canonicalJson(client) }, ...clientBusinessExpected(businessOwnerEvidence)];
    await this.repository.commitControlPlane({ tenantId: input.tenantId, expected, writes: assets.map(asset => ({ collection: "assets" as const, id: asset.key, value: asset, createOnly: true })), audit: { id: randomUUID(), tenantId: input.tenantId, clientId: input.clientId, actorId: input.operatorId, event: "ASSET_ENROLLED", timestamp: now, subjectId: input.registrationId, planHash: canonicalJson({ transactionId: input.transactionId, registrationId: input.registrationId, assets: assets.map(a => a.key) }) } });
    return { registrationId: input.registrationId, revision: client.revision, assets: assets.map(a => ({ type: a.type, id: a.id })) };
  }
}

export function candidatesContain(candidates: readonly OAuthAssetDiscoveryCandidate[], selected: readonly AssetRef[]): boolean {
  return selected.length > 0 && selected.every(ref => candidates.some(candidate => candidate.type === ref.type && candidate.id === ref.id && candidate.providerAssetId === ref.id));
}

