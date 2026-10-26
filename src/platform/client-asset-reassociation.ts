import {PlatformDenied,type AssetGrant,type Client,type Connection,type Member,type MetaAsset,type Tenant} from "./models.js";
import type {ControlCommit} from "./repository.js";
import {canonicalJson} from "./policy.js";
import {assetKey} from "./assets.js";
import {decryptOAuthDiscoveryInspection,type OAuthDiscoveryProposal} from "./oauth-discovery.js";

const READ_CAPABILITIES = [
  "legacy.ads_get_ad_accounts",
  "legacy.ads_get_account_info",
  "legacy.ads_get_campaigns",
  "legacy.ads_get_ad_sets",
  "legacy.ads_get_ads",
  "legacy.ads_get_insights",
] as const;
const PROVIDER_SOURCE = "https://developers.facebook.com/docs/marketing-api/";
const MUTATING_ACTIONS = new Set(["WRITE_NON_FINANCIAL","WRITE_CONTENT","WRITE_MESSAGING","WRITE_AD_CONFIGURATION","WRITE_BUDGET","ACTIVATE_SPEND","DELETE","BUSINESS_ADMIN","IDENTITY_OR_ACCESS","BILLING"]);

export interface ClientAssetReassociationProof {
  accountId: string;
  ownerBusinessId: string;
  appId: string;
  provider: "META_MARKETING";
  checkedAt: number;
  expiresAt: number;
  source: typeof PROVIDER_SOURCE;
  proposalId?: string;
  proposalPlanHash?: string;
}

function expected(input: ControlCommit, collection: string, id: string): string | undefined {
  return input.expected.find(row => row.collection === collection && row.id === id)?.canonical;
}
function exactKeys<T extends {collection:string;id:string}>(rows:T[]):boolean {
  return new Set(rows.map(row => `${row.collection}:${row.id}`)).size === rows.length;
}
function stableAsset(asset: MetaAsset): unknown {
  const {clientId: _clientId,verifiedAt: _verifiedAt,revision: _revision,...rest} = asset;
  return rest;
}
function stableConnection(connection: Connection): unknown {
  const {eligibility: _eligibility,verifiedAt: _verifiedAt,revision: _revision,...rest} = connection;
  return rest;
}
function stableGrant(grant: AssetGrant): unknown {
  const {clientId: _clientId,verifiedAt: _verifiedAt,expiresAt: _expiresAt,revision: _revision,...rest} = grant;
  return rest;
}

/**
 * Validates the only supported reassociation shape. It intentionally accepts a
 * ControlCommit rather than writing Firestore itself; the repository transaction
 * remains the sole mutation path and re-runs this validator inside the transaction.
 */
export function validateClientAssetReassociationControl(input: ControlCommit): void {
  if (input.audit.event !== "CLIENT_ASSET_REASSOCIATED") return;
  const proof = input.clientAssetReassociationProof;
  const proposalWrite = input.writes.find(row => row.collection === "discoveryProposals");
  const proposalId = proof?.proposalId;
  const hasProposal = typeof proposalId === "string";
  const baseWrites = hasProposal ? input.writes.length - 1 : input.writes.length;
  const baseExpected = hasProposal ? input.expected.length - 1 : input.expected.length;
  if (!proof || !hasProposal || !proof.proposalPlanHash || ![3,5].includes(baseWrites) || baseExpected !== 7 || !exactKeys(input.writes) || !exactKeys(input.expected)) {
    throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_EXACT_SCOPE_REQUIRED");
  }
  const rows = new Map(input.writes.map(row => [row.collection, row]));
  const clientWrite = rows.get("clients"), memberWrite = rows.get("members"), assetWrite = rows.get("assets"), connectionWrite = rows.get("connections"), grantWrite = rows.get("grants");
  if (!assetWrite || !connectionWrite || !grantWrite || !proof || ![3,5].includes(rows.size - (hasProposal ? 1 : 0))) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_ROWS_REQUIRED");
  if (hasProposal) {
    const oldProposalText = expected(input, "discoveryProposals", proposalId!);
    const proposal = proposalWrite?.value as OAuthDiscoveryProposal | undefined;
    if (!proposalWrite || proposalWrite.createOnly || !oldProposalText || !proposal || proposal.id !== proposalId || proposal.kind !== "OAUTH_ASSET_DISCOVERY" || proposal.consumedAt === null || proposal.planHash !== proof.proposalPlanHash || proposal.planHash !== input.audit.planHash || JSON.parse(oldProposalText).consumedAt !== null || proposal.tenantId !== input.tenantId || proposal.clientId !== input.audit.clientId || proposal.operatorId !== input.audit.actorId || !proposal.assets.some(a => a.type === "AD_ACCOUNT" && a.id.replace(/^act_/,"") === proof.accountId)) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_DISCOVERY_PROOF_INVALID");
    if (!input.oauthDiscoveryProof || input.oauthDiscoveryProof.proposalId !== proposalId || input.oauthDiscoveryProof.selectedAssetId !== proof.accountId) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_DISCOVERY_PROOF_INVALID");
    try {
      const inspection = decryptOAuthDiscoveryInspection(proposal);
      if (inspection.provider !== "META_MARKETING" || inspection.subjectId !== input.audit.actorId || inspection.expiresAt <= Date.now() || !inspection.assets.some(a => a.type === "AD_ACCOUNT" && a.id.replace(/^act_/,"") === proof.accountId && a.businessId === proof.ownerBusinessId)) throw new Error();
    } catch { throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_DISCOVERY_PROOF_INVALID"); }
  }
  const tenantText = expected(input,"tenants",input.tenantId), memberText = expected(input,"members",input.audit.actorId), oldClientId = input.audit.subjectId;
  const oldClientText = expected(input,"clients",oldClientId);
  const targetClientText = expected(input,"clients",input.audit.clientId);
  const assetText = expected(input,"assets",assetWrite.id), connectionText = expected(input,"connections",connectionWrite.id), grantText = expected(input,"grants",grantWrite.id);
  if (!tenantText || !memberText || !oldClientText || targetClientText === undefined || !assetText || !connectionText || !grantText) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_SNAPSHOT_REQUIRED");
  const tenant = JSON.parse(tenantText) as Tenant;
  const oldMember = JSON.parse(memberText) as Member;
  const oldClient = JSON.parse(oldClientText) as Client;
  const oldAsset = JSON.parse(assetText) as MetaAsset;
  const oldConnection = JSON.parse(connectionText) as Connection;
  const oldGrant = JSON.parse(grantText) as AssetGrant;
  const creatingTarget = targetClientText === "null";
  const client = creatingTarget ? clientWrite?.value as Client : JSON.parse(targetClientText) as Client;
  const member = memberWrite?.value as Member;
  const asset = assetWrite.value as MetaAsset;
  const connection = connectionWrite.value as Connection;
  const grant = grantWrite.value as AssetGrant;
  const now = input.audit.timestamp;
  if (input.tenantId !== input.audit.tenantId || input.audit.clientId !== client.id || !input.audit.subjectId || !/^[a-f0-9]{64}$/.test(input.audit.planHash) || !Number.isSafeInteger(now) || now <= 0 || now > Date.now()) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_ACTOR_INVALID");
  if (tenant.id !== input.tenantId || tenant.status !== "ACTIVE" || tenant.migrationState !== "READY") throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_TENANT_INVALID");
  if (oldMember.tenantId !== input.tenantId || oldMember.operatorId !== input.audit.actorId || oldMember.disabledAt !== null || !oldMember.roles.some(role => role === "admin" || role === "connection_admin")) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_OPERATOR_REQUIRED");
  if (creatingTarget) {
    if (!clientWrite || !memberWrite || memberWrite.createOnly || memberWrite.id !== oldMember.operatorId || canonicalJson(member) !== canonicalJson({...oldMember,allowedClientIds:[...oldMember.allowedClientIds,client.id],revision:oldMember.revision+1}) || oldMember.allowedClientIds.includes(client.id)) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_MEMBER_SCOPE_INVALID");
    if (clientWrite.id !== client.id || !clientWrite.createOnly || client.tenantId !== input.tenantId || client.status !== "ACTIVE" || client.revision !== 1 || client.verifiedBusinessIds.length !== 0 || canonicalJson(client) !== canonicalJson({id:client.id,tenantId:input.tenantId,status:"ACTIVE",revision:1,verifiedBusinessIds:[]})) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_CLIENT_SCOPE_INVALID");
  } else {
    if (clientWrite || memberWrite || client.id !== input.audit.clientId || client.tenantId !== input.tenantId || client.status !== "ACTIVE" || !oldMember.allowedClientIds.includes(client.id)) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_CLIENT_SCOPE_INVALID");
  }
  if (!oldMember.allowedClientIds.includes(oldClient.id) || !client.verifiedBusinessIds.includes(proof.ownerBusinessId)) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_CLIENT_SCOPE_INVALID");
  if (oldClient.id !== oldClientId || oldClient.tenantId !== input.tenantId || oldClient.status !== "ACTIVE" || oldAsset.clientId !== oldClient.id || oldGrant.clientId !== oldClient.id) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_OLD_CLIENT_INVALID");
  if (assetWrite.id !== oldAsset.key || assetWrite.createOnly || asset.tenantId !== input.tenantId || asset.clientId !== client.id || asset.id !== proof.accountId || asset.type !== "AD_ACCOUNT" || asset.provider !== "META_MARKETING" || asset.appId !== proof.appId || asset.ownerBusinessId !== proof.ownerBusinessId || asset.revokedAt !== null || asset.billingOwnershipVerified === true || asset.ownerBillingAttestationId !== undefined || asset.ownershipObservationId !== undefined || asset.key !== assetKey(asset.provider,asset.appId,asset) || asset.revision !== oldAsset.revision + 1 || asset.verifiedAt !== now || canonicalJson(stableAsset(asset)) !== canonicalJson(stableAsset(oldAsset))) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_ASSET_SCOPE_INVALID");
  if (connectionWrite.id !== oldConnection.id || connectionWrite.createOnly || connection.tenantId !== input.tenantId || connection.provider !== "META_MARKETING" || connection.appId !== proof.appId || connection.operatorId !== input.audit.actorId || connection.metaAppUserId !== input.audit.actorId || connection.subjectId !== oldConnection.subjectId || connection.credentialId !== oldConnection.credentialId || connection.revokedAt !== null || connection.revision !== oldConnection.revision + 1 || connection.verifiedAt !== now || connection.expiresAt === null || connection.expiresAt <= now || canonicalJson(stableConnection(connection)) !== canonicalJson(stableConnection(oldConnection)) || connection.assetKeys.length !== oldConnection.assetKeys.length || connection.assetKeys.some((key,index) => key !== oldConnection.assetKeys[index])) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_CONNECTION_SCOPE_INVALID");
  if (proof.accountId !== oldAsset.id || proof.ownerBusinessId.length < 1 || proof.appId !== oldConnection.appId || proof.provider !== "META_MARKETING" || proof.source !== PROVIDER_SOURCE || !Number.isSafeInteger(proof.checkedAt) || proof.checkedAt <= 0 || proof.checkedAt > now || now - proof.checkedAt > 300000 || proof.expiresAt <= now || proof.expiresAt > proof.checkedAt + 300000 || proof.expiresAt > connection.expiresAt) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_PROVIDER_EVIDENCE_INVALID");
  const priorEligibility = oldConnection.eligibility ?? [], nextEligibility = connection.eligibility ?? [];
  if (nextEligibility.length !== priorEligibility.length + 1 || priorEligibility.some(entry => !nextEligibility.some(candidate => canonicalJson(candidate) === canonicalJson(entry))) || !nextEligibility.some(entry => entry.requirement === "marketing_read_access:v26.0" && entry.source === PROVIDER_SOURCE && entry.verified === true && entry.checkedAt === now && entry.expiresAt === proof.expiresAt)) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_ELIGIBILITY_INVALID");
  if (grantWrite.id !== oldGrant.id || grantWrite.createOnly || grant.tenantId !== input.tenantId || grant.clientId !== client.id || grant.assetKey !== asset.key || grant.connectionId !== connection.id || grant.revokedAt !== null || grant.actions.length !== 1 || grant.actions[0] !== "READ" || grant.tasks.length !== 0 || grant.capabilities.length !== READ_CAPABILITIES.length || grant.capabilities.some((cap,index) => cap !== READ_CAPABILITIES[index]) || [...grant.actions].some(action => MUTATING_ACTIONS.has(action)) || grant.verifiedAt !== now || grant.expiresAt !== proof.expiresAt || grant.revision !== oldGrant.revision + 1 || canonicalJson(stableGrant(grant)) !== canonicalJson(stableGrant(oldGrant))) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_GRANT_SCOPE_INVALID");
  if (input.writes.some(row => row.collection === "credentials")) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_CREDENTIAL_MUTATION_FORBIDDEN");
}

export interface PrepareClientAssetReassociationInput {
  tenant: Tenant;
  member: Member;
  oldClient: Client;
  asset: MetaAsset;
  connection: Connection;
  grant: AssetGrant;
  targetClientId: string;
  targetClient?: Client;
  verificationAt?: number;
  discoveryProposal?: OAuthDiscoveryProposal;
  providerEvidence: ClientAssetReassociationProof;
  auditId: string;
  planHash: string;
}

/** Builds the five-write commit; it performs no persistence. */
export function prepareClientAssetReassociation(input: PrepareClientAssetReassociationInput): ControlCommit {
  const {tenant,member,oldClient,asset,connection,grant,targetClientId,providerEvidence,auditId,planHash} = input;
  const now = input.verificationAt ?? providerEvidence.checkedAt;
  const targetClient: Client = input.targetClient ?? {id:targetClientId,tenantId:tenant.id,status:"ACTIVE",revision:1,verifiedBusinessIds:[]};
  const creatingTarget = input.targetClient === undefined;
  const nextMember: Member = {...member,allowedClientIds:[...member.allowedClientIds,targetClientId],revision:member.revision+1};
  const nextAsset: MetaAsset = {...asset,clientId:targetClientId,verifiedAt:now,revision:asset.revision+1};
  const nextConnection: Connection = {...connection,verifiedAt:now,revision:connection.revision+1,eligibility:[...(connection.eligibility??[]),{requirement:"marketing_read_access:v26.0",source:PROVIDER_SOURCE,checkedAt:now,expiresAt:providerEvidence.expiresAt,verified:true}]};
  const nextGrant: AssetGrant = {...grant,clientId:targetClientId,verifiedAt:now,expiresAt:providerEvidence.expiresAt,revision:grant.revision+1};
  const proposal = input.discoveryProposal;
  const proof = {...providerEvidence,...(proposal ? {proposalId:proposal.id,proposalPlanHash:proposal.planHash} : {})};
  const commit: ControlCommit = {tenantId:tenant.id,clientAssetReassociationProof:proof,...(proposal ? {oauthDiscoveryProof:{proposalId:proposal.id,selectedAssetId:providerEvidence.accountId}} : {}),expected:[
    {collection:"tenants",id:tenant.id,canonical:canonicalJson(tenant)},
    {collection:"members",id:member.operatorId,canonical:canonicalJson(member)},
    {collection:"clients",id:oldClient.id,canonical:canonicalJson(oldClient)},
    {collection:"clients",id:targetClientId,canonical:creatingTarget ? "null" : canonicalJson(targetClient)},
    {collection:"assets",id:asset.key,canonical:canonicalJson(asset)},
    {collection:"connections",id:connection.id,canonical:canonicalJson(connection)},
    {collection:"grants",id:grant.id,canonical:canonicalJson(grant)},
    ...(proposal ? [{collection:"discoveryProposals" as const,id:proposal.id,canonical:canonicalJson(proposal)}] : []),
  ],writes:[
    ...(creatingTarget ? [{collection:"clients" as const,id:targetClientId,value:targetClient,createOnly:true},{collection:"members" as const,id:member.operatorId,value:nextMember,createOnly:false}] : []),
    {collection:"assets",id:asset.key,value:nextAsset,createOnly:false},
    {collection:"connections",id:connection.id,value:nextConnection,createOnly:false},
    {collection:"grants",id:grant.id,value:nextGrant,createOnly:false},
    ...(proposal ? [{collection:"discoveryProposals" as const,id:proposal.id,value:{...proposal,consumedAt:now},createOnly:false}] : []),
  ],audit:{id:auditId,tenantId:tenant.id,clientId:targetClientId,actorId:member.operatorId,event:"CLIENT_ASSET_REASSOCIATED",timestamp:now,subjectId:oldClient.id,planHash:proposal?.planHash ?? planHash}};
  validateClientAssetReassociationControl(commit);
  return commit;
}


