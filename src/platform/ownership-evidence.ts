import {clientBusinessBound} from "./client-business.js";
import {z} from "zod";
import {canonicalJson} from "./policy.js";
import {decryptToken,type EncryptedPayload} from "../auth/crypto.js";
import {PlatformDenied,type OperationContext,type MetaAsset,type AuthorizationSnapshot,type OperationClass} from "./models.js";
import type {PlatformRepository,ControlCommit} from "./repository.js";
export interface OwnerBillingAttestation {id:string;tenantId:string;clientId:string;appId:string;accountKey:string;accountId:string;businessId:string;source:"CLIENT_OWNER_ATTESTATION"|"AGENCY_OWNER_ATTESTATION";approvedBy:string;documentReferenceHash:string;checkedAt:number;expiresAt:number;revokedAt:number|null;revision:number}
export type AccountClassification = "AGENCY_OWNED" | "CLIENT_OWNED" | "UNVERIFIED";
export interface AccountOwnershipObservation {id:string;tenantId:string;clientId:string;appId:string;accountKey:string;accountId:string;businessId:string;actorId:string;connectionId:string;attestationId:string;source:"META_AD_ACCOUNT_BUSINESS";sourceUrl:string;checkedAt:number;expiresAt:number;revokedAt:number|null;revision:number;encryptedProof:EncryptedPayload}
export interface FinancialEvidence {attestations:OwnerBillingAttestation[];observations:AccountOwnershipObservation[]}
export const ACCOUNT_OWNERSHIP_SOURCE="https://developers.facebook.com/docs/marketing-api/reference/ad-account/";
export function ownershipObservationAad(observation:AccountOwnershipObservation):string {const{encryptedProof:ignored,...identity}=observation;void ignored;return canonicalJson({purpose:"lumin-account-owner-observation",version:1,...identity});}
export function validateOwnerAttestation(record:OwnerBillingAttestation,now=Date.now()):void {if(!["CLIENT_OWNER_ATTESTATION","AGENCY_OWNER_ATTESTATION"].includes(record.source)||!record.id||!record.tenantId||!record.clientId||!record.accountKey||!record.approvedBy||!/^\d{1,100}$/.test(record.appId)||!/^\d{1,32}$/.test(record.accountId)||!/^\d{1,32}$/.test(record.businessId)||!/^[a-f0-9]{64}$/.test(record.documentReferenceHash)||record.revokedAt!==null||!Number.isSafeInteger(record.checkedAt)||record.checkedAt<=0||record.checkedAt>now||!Number.isSafeInteger(record.expiresAt)||record.expiresAt<=now||record.expiresAt>record.checkedAt+90*86400000||!Number.isSafeInteger(record.revision)||record.revision<1)throw new PlatformDenied("OWNER_BILLING_ATTESTATION_REQUIRED");}
export function ownershipObservationProof(record:AccountOwnershipObservation,now=Date.now()):{id:string;account_id:string;business:{id:string}} {
 try{if(record.source!=="META_AD_ACCOUNT_BUSINESS"||record.sourceUrl!==ACCOUNT_OWNERSHIP_SOURCE||record.revokedAt!==null||!Number.isSafeInteger(record.checkedAt)||record.checkedAt<=0||record.checkedAt>now||now-record.checkedAt>300000||!Number.isSafeInteger(record.expiresAt)||record.expiresAt<=now||record.expiresAt>record.checkedAt+300000||!/^[a-f0-9]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY??""))throw new Error();const value=z.object({id:z.string().regex(/^act_\d{1,32}$/),account_id:z.string().regex(/^\d{1,32}$/),business:z.object({id:z.string().regex(/^\d{1,32}$/)}).strict()}).strict().parse(JSON.parse(decryptToken(record.encryptedProof,ownershipObservationAad(record))));if(value.id!==`act_${record.accountId}`||value.account_id!==record.accountId||value.business.id!==record.businessId)throw new Error();return value;}catch{throw new PlatformDenied("FRESH_ACCOUNT_OWNER_OBSERVATION_REQUIRED");}
}
export async function loadOwnershipEvidence(repo:PlatformRepository,ctx:OperationContext,assets:readonly MetaAsset[]):Promise<FinancialEvidence> {
 const attestations:OwnerBillingAttestation[]=[],observations:AccountOwnershipObservation[]=[];for(const account of assets.filter(a=>a.type==="AD_ACCOUNT"&&a.tenantId===ctx.principal.tenantId&&a.clientId===ctx.clientId)){const refs=account as MetaAsset&{ownerBillingAttestationId?:string;ownershipObservationId?:string};if(refs.ownerBillingAttestationId){const row=await repo.get("ownerBillingAttestations",ctx.principal.tenantId,refs.ownerBillingAttestationId);if(row)attestations.push(row);}if(refs.ownershipObservationId){const row=await repo.get("accountOwnershipObservations",ctx.principal.tenantId,refs.ownershipObservationId);if(row)observations.push(row);}}
 return {attestations,observations};
}
export function agencyOwnershipBound(tenantId:string,clientId:string,businessId:string):boolean {
 const tenant=process.env.LUMIN_AGENCY_TENANT_ID,client=process.env.LUMIN_AGENCY_INTERNAL_CLIENT_ID,business=process.env.LUMIN_AGENCY_META_BUSINESS_ID;
 return !!tenant && !!client && !!business && tenantId===tenant && clientId===client && businessId===business;
}
export function classifyAccountOwnership(snapshot: AuthorizationSnapshot, account: MetaAsset, now=Date.now()): AccountClassification {
  if (account.type!=="AD_ACCOUNT" || account.provider!=="META_MARKETING" || account.revokedAt!==null) return "UNVERIFIED";
  const evidence=snapshot.financialEvidence;
  const refs=account as MetaAsset & {ownerBillingAttestationId?:string; ownershipObservationId?:string};
  const att=evidence?.attestations.find(r=>r.id===refs.ownerBillingAttestationId);
  const obs=evidence?.observations.find(r=>r.id===refs.ownershipObservationId);
  if (!att || !obs || evidence!.attestations.filter(r=>r.id===att.id).length!==1 || evidence!.observations.filter(r=>r.id===obs.id).length!==1) return "UNVERIFIED";
  if(account.tenantId!==snapshot.tenant.id || account.clientId!==snapshot.client.id || snapshot.client.tenantId!==snapshot.tenant.id || [att,obs].some(r=>r.tenantId!==account.tenantId || r.clientId!==account.clientId || r.appId!==account.appId || r.accountKey!==account.key) || obs.attestationId!==att.id || obs.expiresAt>att.expiresAt || account.ownershipEvidenceSource!==ACCOUNT_OWNERSHIP_SOURCE) return "UNVERIFIED";
  try { validateOwnerAttestation(att,now); ownershipObservationProof(obs,now); } catch { return "UNVERIFIED"; }
  if (att.accountId!==account.id.replace(/^act_/,'') || obs.accountId!==att.accountId || obs.businessId!==att.businessId || account.ownerBusinessId!==att.businessId || account.ownershipEvidenceVerifiedAt!==obs.checkedAt) return "UNVERIFIED";
  if (att.source==="AGENCY_OWNER_ATTESTATION") {
    if (!agencyOwnershipBound(account.tenantId,account.clientId,att.businessId) || !clientBusinessBound(snapshot.client,att.businessId,now,snapshot.businessOwnerEvidence,account.appId) || account.billingOwnershipVerified!==true) return "UNVERIFIED";
    return "AGENCY_OWNED";
  }
  if (att.businessId===process.env.LUMIN_AGENCY_META_BUSINESS_ID || !clientBusinessBound(snapshot.client,att.businessId,now,snapshot.businessOwnerEvidence,account.appId) || account.billingOwnershipVerified!==true) return "UNVERIFIED";
  return "CLIENT_OWNED";
}
export function ownershipExpectedRecords(evidence:FinancialEvidence):ControlCommit["expected"] {return [...evidence.attestations.map(r=>({collection:"ownerBillingAttestations" as const,id:r.id,canonical:canonicalJson(r)})),...evidence.observations.map(r=>({collection:"accountOwnershipObservations" as const,id:r.id,canonical:canonicalJson(r)}))];}
export function assertAccountOwnershipEvidence(snapshot:AuthorizationSnapshot,account:MetaAsset,now=Date.now()):void {
 const classification=classifyAccountOwnership(snapshot,account,now);
 if(classification!=="CLIENT_OWNED" && classification!=="AGENCY_OWNED") {
  const refs=account as MetaAsset&{ownerBillingAttestationId?:string};
  const attestation=snapshot.financialEvidence?.attestations.find(r=>r.id===refs.ownerBillingAttestationId);
  if(!refs.ownerBillingAttestationId || !refs.ownershipObservationId) throw new PlatformDenied("EXACT_FINANCIAL_EVIDENCE_REQUIRED");
  throw new PlatformDenied((attestation || (snapshot.financialEvidence?.attestations.length??0)>0) ? "CLIENT_OWNER_BILLING_EVIDENCE_BINDING_INVALID" : "ACCOUNT_OWNERSHIP_UNVERIFIED");
 }
 const refs=account as MetaAsset&{ownerBillingAttestationId?:string;ownershipObservationId?:string},evidence=(snapshot as AuthorizationSnapshot&{financialEvidence?:FinancialEvidence}).financialEvidence,attestations=evidence?.attestations.filter(r=>r.id===refs.ownerBillingAttestationId)??[],observations=evidence?.observations.filter(r=>r.id===refs.ownershipObservationId)??[];
 if(account.type!=="AD_ACCOUNT"||account.provider!=="META_MARKETING"||attestations.length!==1||observations.length!==1)throw new PlatformDenied("EXACT_FINANCIAL_EVIDENCE_REQUIRED");const attestation=attestations[0],observation=observations[0];validateOwnerAttestation(attestation,now);ownershipObservationProof(observation,now);
 const evidenceCheckedAt=account.ownershipEvidenceVerifiedAt;
 if([attestation,observation].some(r=>r.tenantId!==snapshot.tenant.id||r.clientId!==snapshot.client.id||r.appId!==account.appId||r.accountKey!==account.key||r.accountId!==account.id.replace(/^act_/,"")||r.businessId!==attestation.businessId)||observation.attestationId!==attestation.id||observation.expiresAt>attestation.expiresAt|| (classification==="CLIENT_OWNED" && !clientBusinessBound(snapshot.client,attestation.businessId,now,snapshot.businessOwnerEvidence,account.appId)) ||account.ownerBusinessId!==observation.businessId||evidenceCheckedAt===undefined||evidenceCheckedAt!==observation.checkedAt||account.ownershipEvidenceSource!==ACCOUNT_OWNERSHIP_SOURCE)throw new PlatformDenied(classification==="CLIENT_OWNED"?"CLIENT_OWNER_BILLING_EVIDENCE_BINDING_INVALID":"OWNER_BILLING_EVIDENCE_BINDING_INVALID");
}




/**
 * Authorizes ordinary agency advertising operations from current Meta access
 * and the selected client binding. Finance/invoice administration keeps the
 * stricter owner-billing evidence contract; campaign management does not
 * require a Lumin-created billing attestation or card record.
 */
export function assertAgencyAdvertisingAuthorization(
 snapshot:AuthorizationSnapshot,
 account:MetaAsset,
 requiredActions:readonly OperationClass[]=["WRITE_AD_CONFIGURATION"],
 now=Date.now(),
):void {
 if(account.type!=="AD_ACCOUNT"||account.provider!=="META_MARKETING")throw new PlatformDenied("EXACT_CLIENT_AD_ACCOUNT_REQUIRED");
 if(account.tenantId!==snapshot.tenant.id||account.clientId!==snapshot.client.id||snapshot.client.tenantId!==snapshot.tenant.id||account.revokedAt!==null)throw new PlatformDenied("CLIENT_AD_ACCOUNT_SCOPE_REQUIRED");
 if(!Number.isSafeInteger(account.verifiedAt)||account.verifiedAt<=0||account.verifiedAt>now||now-account.verifiedAt>300000)throw new PlatformDenied("CURRENT_META_ACCOUNT_AUTHORIZATION_REQUIRED");
 const ownerBusinessId=account.ownerBusinessId,observedAt=account.ownershipEvidenceVerifiedAt;
 if(!ownerBusinessId||!/^[0-9]{1,32}$/.test(ownerBusinessId)||account.ownershipEvidenceSource!==ACCOUNT_OWNERSHIP_SOURCE||typeof observedAt!=="number"||!Number.isSafeInteger(observedAt)||observedAt<=0||observedAt>now||now-observedAt>300000)throw new PlatformDenied("CURRENT_META_ACCOUNT_AUTHORIZATION_REQUIRED");
 const agencyBusinessId=process.env.LUMIN_AGENCY_META_BUSINESS_ID;
 if(agencyBusinessId&&ownerBusinessId===agencyBusinessId){if(!agencyOwnershipBound(account.tenantId,account.clientId,ownerBusinessId))throw new PlatformDenied("AGENCY_ACCOUNT_CLIENT_SCOPE_MISMATCH");}
 else if(!clientBusinessBound(snapshot.client,ownerBusinessId,now,snapshot.businessOwnerEvidence,account.appId))throw new PlatformDenied("CLIENT_BUSINESS_ACCESS_UNVERIFIED");
 const connection=snapshot.connection;
 if(connection.tenantId!==snapshot.tenant.id||connection.operatorId!==snapshot.member.operatorId||connection.provider!=="META_MARKETING"||connection.appId!==account.appId||connection.revokedAt!==null||(connection.expiresAt!==null&&connection.expiresAt<=now)||!connection.assetKeys.includes(account.key)||!connection.scopes.includes("ads_management"))throw new PlatformDenied("META_ADS_MANAGEMENT_ACCESS_REQUIRED");
 const grants=snapshot.grants.filter(g=>g.tenantId===snapshot.tenant.id&&g.clientId===snapshot.client.id&&g.assetKey===account.key&&g.connectionId===connection.id&&g.revokedAt===null&&g.verifiedAt>0&&g.verifiedAt<=now&&g.expiresAt>now&&requiredActions.every(action=>g.actions.includes(action)));
 if(grants.length!==1)throw new PlatformDenied("SCOPED_AD_ACCOUNT_AUTHORIZATION_REQUIRED");
}



