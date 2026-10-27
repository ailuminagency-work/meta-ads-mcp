// [fixture] git show 1f08563:src/platform/client-asset-reassociation.ts (blob sha256 bac947dee34bc0dbbabd25d995a16d5f4a2ace9bdb4a8fbe7de820ee51078770); only relative import specifiers of modules outside this set are repointed at the current tree.
import {PlatformDenied,type AssetGrant,type Client,type Connection,type Member,type MetaAsset,type Tenant} from "../../../../../src/platform/models.js";
import type {ControlCommit} from "./repository.js";
import {canonicalJson} from "../../../../../src/platform/policy.js";
import {assetKey} from "../../../../../src/platform/assets.js";

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
  if (!proof || input.writes.length !== 5 || input.expected.length !== 7 || !exactKeys(input.writes) || !exactKeys(input.expected)) {
    throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_EXACT_SCOPE_REQUIRED");
  }
  const rows = new Map(input.writes.map(row => [row.collection, row]));
  const clientWrite = rows.get("clients"), memberWrite = rows.get("members"), assetWrite = rows.get("assets"), connectionWrite = rows.get("connections"), grantWrite = rows.get("grants");
  if (!clientWrite || !memberWrite || !assetWrite || !connectionWrite || !grantWrite || rows.size !== 5 || !proof) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_ROWS_REQUIRED");
  const tenantText = expected(input,"tenants",input.tenantId), memberText = expected(input,"members",input.audit.actorId), oldClientId = input.audit.subjectId;
  const oldClientText = expected(input,"clients",oldClientId);
  const targetClientText = expected(input,"clients",String((clientWrite.value as Client).id));
  const assetText = expected(input,"assets",assetWrite.id), connectionText = expected(input,"connections",connectionWrite.id), grantText = expected(input,"grants",grantWrite.id);
  if (!tenantText || !memberText || !oldClientText || targetClientText !== "null" || !assetText || !connectionText || !grantText) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_SNAPSHOT_REQUIRED");
  const tenant = JSON.parse(tenantText) as Tenant;
  const oldMember = JSON.parse(memberText) as Member;
  const oldClient = JSON.parse(oldClientText) as Client;
  const oldAsset = JSON.parse(assetText) as MetaAsset;
  const oldConnection = JSON.parse(connectionText) as Connection;
  const oldGrant = JSON.parse(grantText) as AssetGrant;
  const client = clientWrite.value as Client;
  const member = memberWrite.value as Member;
  const asset = assetWrite.value as MetaAsset;
  const connection = connectionWrite.value as Connection;
  const grant = grantWrite.value as AssetGrant;
  const now = input.audit.timestamp;
  if (input.tenantId !== input.audit.tenantId || input.audit.clientId !== client.id || !input.audit.subjectId || !/^[a-f0-9]{64}$/.test(input.audit.planHash) || !Number.isSafeInteger(now) || now <= 0 || now > Date.now()) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_ACTOR_INVALID");
  if (tenant.id !== input.tenantId || tenant.status !== "ACTIVE" || tenant.migrationState !== "READY") throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_TENANT_INVALID");
  if (oldMember.tenantId !== input.tenantId || oldMember.operatorId !== input.audit.actorId || oldMember.disabledAt !== null || !oldMember.roles.some(role => role === "admin" || role === "connection_admin")) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_OPERATOR_REQUIRED");
  if (!memberWrite.createOnly && memberWrite.id === oldMember.operatorId && canonicalJson(member) === canonicalJson({...oldMember,allowedClientIds:[...oldMember.allowedClientIds,client.id],revision:oldMember.revision+1}) && !oldMember.allowedClientIds.includes(client.id)) { /* expected shape checked below */ } else throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_MEMBER_SCOPE_INVALID");
  if (clientWrite.id !== client.id || !clientWrite.createOnly || client.tenantId !== input.tenantId || client.status !== "ACTIVE" || client.revision !== 1 || client.verifiedBusinessIds.length !== 0 || canonicalJson(client) !== canonicalJson({id:client.id,tenantId:input.tenantId,status:"ACTIVE",revision:1,verifiedBusinessIds:[]})) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_CLIENT_SCOPE_INVALID");
  if (oldClient.id !== oldClientId || oldClient.tenantId !== input.tenantId || oldClient.status !== "ACTIVE" || oldAsset.clientId !== oldClient.id || oldGrant.clientId !== oldClient.id) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_OLD_CLIENT_INVALID");
  if (assetWrite.id !== oldAsset.key || assetWrite.createOnly || asset.tenantId !== input.tenantId || asset.clientId !== client.id || asset.id !== proof.accountId || asset.type !== "AD_ACCOUNT" || asset.provider !== "META_MARKETING" || asset.appId !== proof.appId || asset.ownerBusinessId !== proof.ownerBusinessId || asset.revokedAt !== null || asset.billingOwnershipVerified === true || asset.ownerBillingAttestationId !== undefined || asset.ownershipObservationId !== undefined || asset.key !== assetKey(asset.provider,asset.appId,asset) || asset.revision !== oldAsset.revision + 1 || asset.verifiedAt !== now || canonicalJson(stableAsset(asset)) !== canonicalJson(stableAsset(oldAsset))) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_ASSET_SCOPE_INVALID");
  if (connectionWrite.id !== oldConnection.id || connectionWrite.createOnly || connection.tenantId !== input.tenantId || connection.provider !== "META_MARKETING" || connection.appId !== proof.appId || connection.operatorId !== input.audit.actorId || connection.metaAppUserId !== input.audit.actorId || connection.subjectId !== oldConnection.subjectId || connection.credentialId !== oldConnection.credentialId || connection.revokedAt !== null || connection.revision !== oldConnection.revision + 1 || connection.verifiedAt !== now || connection.expiresAt === null || connection.expiresAt <= now || canonicalJson(stableConnection(connection)) !== canonicalJson(stableConnection(oldConnection)) || connection.assetKeys.length !== oldConnection.assetKeys.length || connection.assetKeys.some((key,index) => key !== oldConnection.assetKeys[index])) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_CONNECTION_SCOPE_INVALID");
  if (proof.accountId !== oldAsset.id || proof.ownerBusinessId.length < 1 || proof.appId !== oldConnection.appId || proof.provider !== "META_MARKETING" || proof.source !== PROVIDER_SOURCE || proof.checkedAt !== now || proof.expiresAt <= now || proof.expiresAt > proof.checkedAt + 300000 || proof.expiresAt > connection.expiresAt) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_PROVIDER_EVIDENCE_INVALID");
  const priorEligibility = oldConnection.eligibility ?? [], nextEligibility = connection.eligibility ?? [];
  if (nextEligibility.length !== priorEligibility.length + 1 || priorEligibility.some(entry => !nextEligibility.some(candidate => canonicalJson(candidate) === canonicalJson(entry))) || !nextEligibility.some(entry => entry.requirement === "marketing_read_access:v26.0" && entry.source === PROVIDER_SOURCE && entry.verified === true && entry.checkedAt === now && entry.expiresAt === proof.expiresAt)) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_ELIGIBILITY_INVALID");
  if (grantWrite.id !== oldGrant.id || grantWrite.createOnly || grant.tenantId !== input.tenantId || grant.clientId !== client.id || grant.assetKey !== asset.key || grant.connectionId !== connection.id || grant.revokedAt !== null || grant.actions.length !== 1 || grant.actions[0] !== "READ" || grant.tasks.length !== 0 || grant.capabilities.length !== READ_CAPABILITIES.length || grant.capabilities.some((cap,index) => cap !== READ_CAPABILITIES[index]) || [...grant.actions].some(action => MUTATING_ACTIONS.has(action)) || grant.verifiedAt !== now || grant.expiresAt !== proof.expiresAt || grant.revision !== oldGrant.revision + 1 || canonicalJson(stableGrant(grant)) !== canonicalJson(stableGrant(oldGrant))) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_GRANT_SCOPE_INVALID");
  if (assetWrite.value && connectionWrite.value && grantWrite.value && input.writes.some(row => row.collection === "credentials")) throw new PlatformDenied("CLIENT_ASSET_REASSOCIATION_CREDENTIAL_MUTATION_FORBIDDEN");
}

export interface PrepareClientAssetReassociationInput {
  tenant: Tenant;
  member: Member;
  oldClient: Client;
  asset: MetaAsset;
  connection: Connection;
  grant: AssetGrant;
  targetClientId: string;
  providerEvidence: ClientAssetReassociationProof;
  auditId: string;
  planHash: string;
}

/** Builds the five-write commit; it performs no persistence. */
export function prepareClientAssetReassociation(input: PrepareClientAssetReassociationInput): ControlCommit {
  const {tenant,member,oldClient,asset,connection,grant,targetClientId,providerEvidence,auditId,planHash} = input;
  const now = providerEvidence.checkedAt;
  const targetClient: Client = {id:targetClientId,tenantId:tenant.id,status:"ACTIVE",revision:1,verifiedBusinessIds:[]};
  const nextMember: Member = {...member,allowedClientIds:[...member.allowedClientIds,targetClientId],revision:member.revision+1};
  const nextAsset: MetaAsset = {...asset,clientId:targetClientId,verifiedAt:now,revision:asset.revision+1};
  const nextConnection: Connection = {...connection,verifiedAt:now,revision:connection.revision+1,eligibility:[...(connection.eligibility??[]),{requirement:"marketing_read_access:v26.0",source:PROVIDER_SOURCE,checkedAt:now,expiresAt:providerEvidence.expiresAt,verified:true}]};
  const nextGrant: AssetGrant = {...grant,clientId:targetClientId,verifiedAt:now,expiresAt:providerEvidence.expiresAt,revision:grant.revision+1};
  const commit: ControlCommit = {tenantId:tenant.id,clientAssetReassociationProof:providerEvidence,expected:[
    {collection:"tenants",id:tenant.id,canonical:canonicalJson(tenant)},
    {collection:"members",id:member.operatorId,canonical:canonicalJson(member)},
    {collection:"clients",id:oldClient.id,canonical:canonicalJson(oldClient)},
    {collection:"clients",id:targetClientId,canonical:"null"},
    {collection:"assets",id:asset.key,canonical:canonicalJson(asset)},
    {collection:"connections",id:connection.id,canonical:canonicalJson(connection)},
    {collection:"grants",id:grant.id,canonical:canonicalJson(grant)},
  ],writes:[
    {collection:"clients",id:targetClientId,value:targetClient,createOnly:true},
    {collection:"members",id:member.operatorId,value:nextMember,createOnly:false},
    {collection:"assets",id:asset.key,value:nextAsset,createOnly:false},
    {collection:"connections",id:connection.id,value:nextConnection,createOnly:false},
    {collection:"grants",id:grant.id,value:nextGrant,createOnly:false},
  ],audit:{id:auditId,tenantId:tenant.id,clientId:targetClientId,actorId:member.operatorId,event:"CLIENT_ASSET_REASSOCIATED",timestamp:now,subjectId:oldClient.id,planHash}};
  validateClientAssetReassociationControl(commit);
  return commit;
}


