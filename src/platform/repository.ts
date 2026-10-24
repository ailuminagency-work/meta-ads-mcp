import {researchListReadScope,type ResearchListReadCheckpoint} from './research-list-checkpoint.js';
import {researchComparisonReadScope,type ResearchComparisonReadCheckpoint} from './research-comparison-checkpoint.js';
import {validateSignalDiscoveryControl,signalDiscoveryReadScope} from "./signal-discovery-validation.js";
import type {SignalDiscoveryProposal,SignalDiscoveryControlProof,SignalDiscoveryReadCheckpoint} from "./signal-discovery-types.js";
import {validateCatalogCampaignReadResponseCheckpoint,type CatalogCampaignReadResponseCheckpoint} from "./catalog-campaign-read-response.js";
import {researchReadScope,type ResearchReadCheckpoint} from "./research-read-checkpoint.js";
import {validateAppPromotionControl,appPromotionReadScope,type AppPromotionReadCheckpoint,type AppPromotionControlProof} from "./app-promotion-control.js";
import type {AppPromotionProposal} from "./app-promotion-types.js";
import {validateAdCommentsReadResponseCheckpoint,type AdCommentsReadResponseCheckpoint} from "./ad-comments-read-response.js";
import {validatePrivateReadResponseCheckpoint,type PrivateReadResponseCheckpoint} from "./private-read-response.js";
import {validatePurchaseConversionInput} from "./purchase-conversion-contract.js";
import {validateMarketingStudyInput} from "./marketing-study-contract.js";
import {validateMarketingRuleInput} from "./marketing-rule-contract.js";
import {trackingReadScope,type TrackingReadCheckpoint} from "./tracking-change-read.js";
import {validateTrackingControl,trackingControlIdentities,type TrackingControlProof} from "./tracking-change-control.js";
import type {TrackingChangeJob} from "./tracking-change-types.js";
import {validateRepointedAdCompletion,type RepointedAdCompletion} from "./marketing-repoint-completion.js";
import {validateRepointClaim,repointDependencies} from "./marketing-repoint-claim.js";
import {marketingReportBody,MARKETING_REPORT_FIELDS} from "./marketing-report-contracts.js";
import {validateClientMetadataCheckpoint,type ClientMetadataCheckpoint} from "./client-metadata.js";
import {validateConnectionMetadataCheckpoint,type ConnectionMetadataCheckpoint} from "./connection-metadata.js";
import {setupPhoneLockKey} from "./whatsapp-setup-types.js";
import {batchReadScope,type BatchReadCheckpoint} from "./paused-ad-batch-read.js";
import {clientBusinessBound,clientBusinessEvidenceFromExpected} from "./client-business.js";
import {validateBatchControl,batchControlIdentities,type BatchControlProof} from "./paused-ad-batch-control.js";
import type {PausedAdBatchJob} from "./paused-ad-batch-types.js";
import {validateBusinessOwnerControl} from "./business-owner-validation.js";
import type {BusinessOwnerControlProof} from "./business-owner-service.js";
import type {BusinessOwnerAttestation} from "./client-business.js";
import {validateResearchFinancialControl} from "./research-financial-validation.js";
import type {WhatsAppSetupLease,WhatsAppSetupCommand} from "./whatsapp-setup-types.js";
import type {SetupControlProof} from "./whatsapp-setup-control-proof.js";
import {validateSetupControl,setupControlIdentities,ordinarySetupPhoneKeys} from "./whatsapp-setup-validation.js";
import {validateResearchControl} from "./research-job-validation.js";
import type {ResearchJob,ResearchBudget,ResearchApproval,ResearchControlProof,ResearchFinancialCheckpoint,ResearchFinancialProof} from "./research-job-types.js";
import {validateDeletedAdCompletion,type DeletedAdCompletion} from "./marketing-deletion-completion.js";
import {validateClientEnrollmentControl} from "./client-enrollment.js";
import type {AttachmentProposal} from "./attachment-source.js";
import {validateAttachmentControl} from "./attachment-validation.js";
import {validateManualEligibilityControl} from "./manual-eligibility-validation.js";
import type {ManualEligibilityAttestation} from "./manual-eligibility.js";
import {validateVideoControl} from "./video-enrollment-validation.js";
import type {VideoProposal} from "./video-types.js";
import {connectionPrivacyAppUserId} from "./privacy-identity.js";
import {privacySubjectHash,createPrivacyProvenance,PRIVACY_PROVENANCE_COLLECTION,PRIVACY_OWNED_COLLECTIONS} from "./meta-privacy-provenance.js";
import {validateHashtagQuotaControl,type HashtagQuota} from "./instagram-hashtag.js";
import {validateOwnershipControl} from "./ownership-control.js";
import type {OwnerBillingAttestation,AccountOwnershipObservation} from "./ownership-evidence.js";
import {validatePageInspectionEnrollment,type PageInspectionDelegation} from "./page-inspection-delegation.js";
import {validateCompatibilityControl,type CompatibilityObservation} from "./compatibility-observer.js";
import {validateTargetingLookupControl,type TargetingLookup} from "./targeting-lookup.js";
import {validateMediaControl} from "./media-enrollment-validation.js";
import type {MediaProposal} from "./media-enrollment-types.js";
import {validateDiscoveryControl} from "./discovery-validation.js";
import type {DiscoveryProposal} from "./discovery-types.js";
import {validCreatedProductId,publishedProductOwnerType} from "./product-identifiers.js";
import {PRODUCT_CONTRACTS} from "./products/contracts.js";
import { createHash } from "node:crypto";
import type { Firestore } from "@google-cloud/firestore";
import type { Approval, ApprovalRequest, ControlAudit, AssetGrant, AuditRecord, Client, Connection, Credential, Member, MetaAsset, Operation, Tenant, PlatformPrincipal } from "./models.js";
import { PlatformDenied } from "./models.js";
import { canonicalJson } from "./policy.js";
import { assetKey } from "./assets.js";

export interface Records {signalDiscoveryProposals:SignalDiscoveryProposal;appPromotionProposals:AppPromotionProposal;trackingChangeJobs:TrackingChangeJob;pausedAdBatchJobs:PausedAdBatchJob;businessOwnerAttestations:BusinessOwnerAttestation; whatsappSetupLeases:WhatsAppSetupLease;whatsappSetupCommands:WhatsAppSetupCommand; researchFinancialCheckpoints:ResearchFinancialCheckpoint;researchJobs:ResearchJob;researchBudgets:ResearchBudget;researchApprovals:ResearchApproval; manualEligibilityAttestations:ManualEligibilityAttestation; hashtagQuotas:HashtagQuota; ownerBillingAttestations:OwnerBillingAttestation;accountOwnershipObservations:AccountOwnershipObservation; pageInspectionDelegations:PageInspectionDelegation; compatibilityObservations:CompatibilityObservation; targetingLookups:TargetingLookup; mediaProposals:MediaProposal; videoProposals:VideoProposal; attachmentProposals:AttachmentProposal; discoveryProposals:DiscoveryProposal; tenants: Tenant; members: Member; clients: Client; assets: MetaAsset; grants: AssetGrant; connections: Connection; credentials: Credential; approvals: Approval; operations: Operation; audit: AuditRecord; operatorIndex: PlatformPrincipal; approvalRequests:ApprovalRequest; controlAudit:ControlAudit }
export type Collection = keyof Records;
export interface Preparation {creativeRepointClaim?:{before:MetaAsset;after:MetaAsset}; selectedConnectionId?:string; operation: Operation; audit: AuditRecord; approvalId?: string; expectedRevisionHash: string; now: number; deletionClaim?:{before:MetaAsset;after:MetaAsset}; publicationClaim?:{before:MetaAsset;after:MetaAsset}; publicationClaims?:Array<{before:MetaAsset;after:MetaAsset}>; expectedRecords: { collection: Collection; id: string; canonical: string }[] }
export interface CreatedCompletion { asset: MetaAsset; grant: AssetGrant; connectionBefore: Connection; connectionAfter: Connection; expectedRecords: Preparation["expectedRecords"]; authorizationExpiresAt: number }
export interface Completion { tenantId: string; operationId: string; result: "SUCCEEDED" | "FAILED" | "UNKNOWN" | "PARTIAL"; audit: AuditRecord; created?: CreatedCompletion; deleted?:DeletedAdCompletion;repointed?:RepointedAdCompletion }
export interface ControlCommit {oauthDiscoveryProof?:{proposalId:string;selectedAssetId:string};signalDiscoveryProof?:SignalDiscoveryControlProof;appPromotionProof?:AppPromotionControlProof;trackingProof?:TrackingControlProof;batchProof?:BatchControlProof;setupProof?:SetupControlProof;setupPhoneLock?:{key:string;commandId:string;operation:"CLAIM"|"RELEASE"};researchProof?:ResearchControlProof;researchFinancialProof?:ResearchFinancialProof;businessOwnerProof?:BusinessOwnerControlProof;tenantId:string;expected:Array<{collection:Collection;id:string;canonical:string}>;writes:Array<{collection:"signalDiscoveryProposals"|"appPromotionProposals"|"trackingChangeJobs"|"pausedAdBatchJobs"|"businessOwnerAttestations"|"researchFinancialCheckpoints"|"researchJobs"|"researchBudgets"|"researchApprovals"|"clients"|"members"|"manualEligibilityAttestations"|"credentials"|"connections"|"grants"|"approvals"|"approvalRequests"|"assets"|"discoveryProposals"|"mediaProposals"|"videoProposals"|"attachmentProposals"|"whatsappSetupLeases"|"whatsappSetupCommands"|"targetingLookups"|"compatibilityObservations"|"pageInspectionDelegations"|"hashtagQuotas"|"ownerBillingAttestations"|"accountOwnershipObservations";id:string;value:unknown;createOnly:boolean}>;audit:ControlAudit}
export interface PlatformRepository {
  assertCatalogCampaignReadResponseCurrent?(input:CatalogCampaignReadResponseCheckpoint):Promise<void>;
  assertAdCommentsReadResponseCurrent?(input:AdCommentsReadResponseCheckpoint):Promise<void>;
  assertPrivateReadResponseCurrent?(input:PrivateReadResponseCheckpoint):Promise<void>;
  assertResearchReadCurrent?(input:ResearchReadCheckpoint):Promise<void>;
  assertResearchComparisonReadCurrent?(input:ResearchComparisonReadCheckpoint):Promise<void>;
  assertResearchListReadCurrent?(input:ResearchListReadCheckpoint):Promise<void>;
  assertSignalDiscoveryReadCurrent?(input:SignalDiscoveryReadCheckpoint):Promise<void>;
  assertAppPromotionReadCurrent?(input:AppPromotionReadCheckpoint):Promise<void>;
  assertTrackingReadCurrent?(input:TrackingReadCheckpoint):Promise<void>;assertBatchReadCurrent?(input:BatchReadCheckpoint):Promise<void>;
  assertConnectionMetadataCurrent?(input:ConnectionMetadataCheckpoint):Promise<void>;
  assertClientMetadataCurrent?(input:ClientMetadataCheckpoint):Promise<void>;
  isWhatsAppSetupPhoneLocked?(key:string):Promise<boolean>;
  isAppUserLifecycleLocked?(appId:string,operatorId:string,appUserId?:string):Promise<boolean>;
  listClientHealthRecords?<K extends "assets"|"grants"|"audit">(collection:K,tenantId:string,clientId:string):Promise<Records[K][]>;
  commitControlPlane(input:ControlCommit):Promise<void>;
  resolvePrincipal(operatorId: string): Promise<PlatformPrincipal | null>;
  get<K extends Collection>(collection: K, tenantId: string, id: string): Promise<Records[K] | null>;
  list<K extends Collection>(collection: K, tenantId: string): Promise<Records[K][]>;
  put<K extends Collection>(collection: K, tenantId: string, id: string, value: Records[K]): Promise<void>;
  prepareOperation(input: Preparation): Promise<void>;
  finishOperation(input: Completion): Promise<void>;
}
function controlConnections(input:ControlCommit):Connection[]{
 const all=[...input.expected.filter(e=>e.collection==="connections").map(e=>JSON.parse(e.canonical) as Connection),...input.writes.filter(w=>w.collection==="connections").map(w=>w.value as Connection)];
 return [...new Map(all.map(c=>[JSON.stringify([c.appId,c.operatorId,connectionPrivacyAppUserId(c)]),c])).values()];
}
function privacyIdentities(connections:readonly Connection[],actors:readonly string[]):Array<{appId:string;appUserId:string}>{
 const identities=connections.map(c=>({appId:c.appId,appUserId:connectionPrivacyAppUserId(c)})),authApp=process.env.META_APP_ID;
 if(authApp&&/^\d{1,100}$/.test(authApp))for(const actor of actors)if(actor&&actor.length<=128)identities.push({appId:authApp,appUserId:actor});
 return [...new Map(identities.map(i=>[JSON.stringify(i),i])).values()];
}
function clientMetadataProviderDependencies(input:ClientMetadataCheckpoint):{connections:Connection[];phoneKeys:string[]}{
 if(input.purpose!=="REGISTRY")return {connections:[],phoneKeys:[]};
 const connections=input.expected.filter(r=>r.collection==="connections").map(r=>JSON.parse(r.canonical) as Connection),assets=input.expected.filter(r=>r.collection==="assets").map(r=>JSON.parse(r.canonical) as MetaAsset);
 return {connections,phoneKeys:connections.filter(c=>c.provider==="META_WHATSAPP").flatMap(c=>assets.filter(a=>a.type==="WHATSAPP_PHONE"&&a.appId===c.appId&&a.provider===c.provider&&c.assetKeys.includes(a.key)).map(a=>setupPhoneLockKey(c.appId,a.id)))};
}
function privacyRecords(identities:Array<{appId:string;appUserId:string}>,tenantId:string,targets:Array<{collection:string;id:string}>){
 if(targets.some(t=>PRIVACY_OWNED_COLLECTIONS.includes(t.collection))&&!identities.length)throw new PlatformDenied("PRIVACY_PROVENANCE_IDENTITY_REQUIRED");
 return identities.flatMap(identity=>targets.filter(t=>PRIVACY_OWNED_COLLECTIONS.includes(t.collection)).map(t=>createPrivacyProvenance({...identity,tenantId,...t,now:Date.now()})));
}
function controlPrivacyRecords(input:ControlCommit,allIdentities:Array<{appId:string;appUserId:string}>){
 const connections=controlConnections(input),protectedCollections=new Set(["connections","grants","credentials","pageInspectionDelegations"]);
 const records=input.writes.flatMap(write=>{
  if(write.collection==="signalDiscoveryProposals"||write.collection==="appPromotionProposals"||write.collection==="pausedAdBatchJobs"||write.collection==="trackingChangeJobs"){const l=write.value as PausedAdBatchJob;return privacyRecords([{appId:l.appId,appUserId:l.metaAppUserId},{appId:l.appId,appUserId:l.actorId}],input.tenantId,[{collection:write.collection,id:write.id}]);}
  if(write.collection==="whatsappSetupLeases"){const l=write.value as WhatsAppSetupLease;return privacyRecords([{appId:l.appId,appUserId:l.metaAppUserId},{appId:l.appId,appUserId:l.operatorId}],input.tenantId,[{collection:write.collection,id:write.id}]);}
  if(!protectedCollections.has(write.collection))return privacyRecords(allIdentities,input.tenantId,[{collection:write.collection,id:write.id}]);
  const value=write.value as {connectionId?:string},owners=connections.filter(c=>write.collection==="connections"?c.id===write.id:write.collection==="credentials"?c.credentialId===write.id:c.id===value.connectionId);
  if(!owners.length)throw new PlatformDenied("PRIVACY_TARGET_OWNER_CONNECTION_REQUIRED");
  return privacyRecords(privacyIdentities(owners,owners.map(c=>c.operatorId)),input.tenantId,[{collection:write.collection,id:write.id}]);
 });
 return [...records,...privacyRecords(allIdentities,input.tenantId,[{collection:"controlAudit",id:input.audit.id}])];
}
function checkControlCommit(input:ControlCommit):void {
  if(!input.tenantId || input.audit.tenantId!==input.tenantId || !input.audit.id || input.writes.length<1 || input.writes.length>100 || input.expected.length<3 || input.expected.length>300)throw new PlatformDenied("INVALID_CONTROL_COMMIT");
  const keys=new Set<string>();
  for(const write of input.writes){if(!["signalDiscoveryProposals","appPromotionProposals","trackingChangeJobs","pausedAdBatchJobs","businessOwnerAttestations","researchFinancialCheckpoints","researchJobs","researchBudgets","researchApprovals","clients","members","manualEligibilityAttestations","credentials","connections","grants","approvals","approvalRequests","assets","discoveryProposals","mediaProposals","videoProposals","attachmentProposals","whatsappSetupLeases","whatsappSetupCommands","targetingLookups","compatibilityObservations","pageInspectionDelegations","hashtagQuotas","ownerBillingAttestations","accountOwnershipObservations"].includes(write.collection)||!write.id||!write.value||typeof write.value!=="object"||(write.value as {tenantId?:string}).tenantId!==input.tenantId||keys.has(write.collection+":"+write.id))throw new PlatformDenied("INVALID_CONTROL_WRITE");keys.add(write.collection+":"+write.id);}
  validateSignalDiscoveryControl(input);
  validateAppPromotionControl(input);
  validateTrackingControl(input);
  validateBatchControl(input);
  validateClientEnrollmentControl(input);
  validateBusinessOwnerControl(input);
  validateManualEligibilityControl(input);
  validateResearchControl(input);
  validateResearchFinancialControl(input);
  validateOwnershipControl(input);
  validateHashtagQuotaControl(input);
  validateDiscoveryControl(input);
  validateTargetingLookupControl(input); validateCompatibilityControl(input); validatePageInspectionEnrollment(input); validateMediaControl(input); validateVideoControl(input); validateAttachmentControl(input); validateSetupControl(input);
  const assetWrites=input.writes.filter(w=>w.collection==="assets");
  if(assetWrites.length && !["SIGNAL_ASSET_ENROLLED","APP_PROMOTION_ENROLLED","CLIENT_ENROLLED","ASSET_ENROLLED","MEDIA_ENROLLED","VIDEO_ENROLLED","ATTACHMENT_ENROLLED","OWNER_BILLING_ATTESTED","ACCOUNT_OWNER_OBSERVED"].includes(input.audit.event)){
    if(input.audit.event!=="ASSET_OBSERVED" || input.writes.length!==assetWrites.length)throw new PlatformDenied("ASSET_OBSERVATION_CONTROL_REQUIRED");
    for(const write of assetWrites){
      const next=write.value as MetaAsset,priorText=input.expected.find(e=>e.collection==="assets" && e.id===next.key)?.canonical;
      if(!priorText)throw new PlatformDenied("ASSET_OBSERVATION_SNAPSHOT_REQUIRED");
      const prior=JSON.parse(priorText) as MetaAsset,{publishingEvidence:oldContainer,replyEvidence:oldReply,...previous}=prior,{publishingEvidence:container,replyEvidence:reply,...current}=next;
      if(canonicalJson(current)!==canonicalJson({...previous,revision:prior.revision+1}) || !["META_THREADS","META_INSTAGRAM_LOGIN","META_INSTAGRAM_FACEBOOK_LOGIN"].includes(next.provider) || next.revokedAt!==null || write.createOnly || (!container&&!reply))throw new PlatformDenied("ASSET_OBSERVATION_INVALID");
      const validTime=(e:{checkedAt:number;expiresAt:number;verified:true;appId:string})=>e.verified===true && e.appId===next.appId && Number.isSafeInteger(e.checkedAt) && e.checkedAt>0 && e.checkedAt<=Date.now() && Number.isSafeInteger(e.expiresAt) && e.expiresAt>Date.now() && e.expiresAt<=e.checkedAt+300000;
      if(container && canonicalJson(container)!==canonicalJson(oldContainer??null)){
        const threads=next.provider==="META_THREADS",instagram=["META_INSTAGRAM_LOGIN","META_INSTAGRAM_FACEBOOK_LOGIN"].includes(next.provider);
        if(next.type!=="MEDIA" || !validTime(container) || !next.parents.some(p=>p.type===(threads?"THREADS_ACCOUNT":"INSTAGRAM_ACCOUNT") && p.id===container.accountId) || !["FINISHED","PUBLISHED","ERROR","EXPIRED","IN_PROGRESS"].includes(container.status) || container.published!==(container.status==="PUBLISHED") || !(threads&&container.kind==="threads_container"&&container.source==="https://developers.facebook.com/documentation/threads/reference/publishing" || instagram&&container.kind==="instagram_container"&&container.source==="https://developers.facebook.com/documentation/instagram-platform/content-publishing") || oldContainer?.published && container.published!==true || oldContainer?.status==="EXPIRED" && container.status!=="EXPIRED")throw new PlatformDenied("ASSET_OBSERVATION_INVALID");
      }
      if(reply && canonicalJson(reply)!==canonicalJson(oldReply??null) && (next.provider!=="META_THREADS" || next.type!=="POST" || reply.kind!=="threads_reply" || reply.isReply!==true || !validTime(reply) || !next.parents.some(p=>p.type==="POST" && p.id===reply.rootPostId) || !["NOT_HUSHED","UNHUSHED","HIDDEN","COVERED","BLOCKED","RESTRICTED"].includes(reply.hideStatus) || !["https://developers.facebook.com/documentation/threads/retrieve-and-manage-replies/replies-and-conversations","https://developers.facebook.com/documentation/threads/reply-management"].includes(reply.source)))throw new PlatformDenied("ASSET_OBSERVATION_INVALID");
      if(oldContainer && !container || oldReply && !reply)throw new PlatformDenied("ASSET_OBSERVATION_CANNOT_CLEAR_EVIDENCE");
    }
  }
  if(input.audit.event === "CONNECTION_ENROLLED"){
    const now=Date.now(),connections=input.writes.filter(w=>w.collection === "connections").map(w=>w.value as Connection);
    if(!connections.length || connections.some(connection=>connection.expiresAt===null || !Number.isFinite(connection.expiresAt) || connection.expiresAt<=now))throw new PlatformDenied("OAUTH_TOKEN_EXPIRED_AT_COMMIT");
    if(connections.some(c=>c.tokenIssuedAt!==undefined&&(c.provider!=="META_INSTAGRAM_LOGIN"||c.tokenType!=="instagram"||!Number.isSafeInteger(c.tokenIssuedAt)||c.tokenIssuedAt<=0||c.tokenIssuedAt!==c.verifiedAt||c.tokenIssuedAt!==input.audit.timestamp||c.tokenIssuedAt>now)))throw new PlatformDenied("OAUTH_TOKEN_ISSUANCE_BINDING_INVALID");
    for(const connection of connections)if(connection.tokenType==="business_integration_system_user"){
      const evidence=connection.whatsappAssignmentEvidence,clientRecord=evidence?input.expected.find(e=>e.collection==="clients"&&e.id===evidence.clientId):null,client=clientRecord?JSON.parse(clientRecord.canonical) as Client:null;
      if(connection.provider!=="META_WHATSAPP"||!connection.clientBusinessId||!evidence||evidence.tenantId!==connection.tenantId||evidence.appId!==connection.appId||(!client||!clientBusinessBound(client,connection.clientBusinessId,now,clientBusinessEvidenceFromExpected(input.expected),connection.appId))||evidence.clientId!==client.id||evidence.source!=="META_BUSINESS_SUITE_OWNER_REVIEW"||evidence.dualAccountAssignment!==true||!evidence.approvedBy||!Number.isSafeInteger(evidence.checkedAt)||evidence.checkedAt<=0||evidence.checkedAt>now||now-evidence.checkedAt>300000||!Number.isSafeInteger(evidence.expiresAt)||evidence.expiresAt<=now||evidence.expiresAt>evidence.checkedAt+3600000||connection.expiresAt!>evidence.expiresAt||connection.assetKeys.length!==3)throw new PlatformDenied("WHATSAPP_ASSIGNMENT_EVIDENCE_STALE_AT_COMMIT");
      for(const[type,id]of [["WHATSAPP_ACCOUNT",evidence.whatsappAccountId],["MESSAGING_ACCOUNT",evidence.messagingAccountId],["WHATSAPP_PHONE",evidence.phoneId]])if(!connection.assetKeys.some(key=>{const row=input.expected.find(e=>e.collection==="assets"&&e.id===key);if(!row)return false;const asset=JSON.parse(row.canonical) as MetaAsset;return asset.type===type&&asset.id===id&&asset.clientId===client.id&&asset.tenantId===connection.tenantId&&asset.appId===connection.appId&&asset.provider===connection.provider;}))throw new PlatformDenied("WHATSAPP_ASSIGNMENT_ASSET_BINDING_REQUIRED");
    }
    for(const connection of connections)for(const assetKey of connection.assetKeys){
      const record=input.expected.find(e=>e.collection==="assets"&&e.id===assetKey);
      if(!record)throw new PlatformDenied("OAUTH_ASSET_SNAPSHOT_REQUIRED_AT_COMMIT");
      const asset=JSON.parse(record.canonical) as MetaAsset;
      if(!Number.isSafeInteger(asset.verifiedAt)||asset.verifiedAt<=0||asset.verifiedAt>now||now-asset.verifiedAt>3600000)throw new PlatformDenied("OAUTH_ASSET_EVIDENCE_STALE_AT_COMMIT");

    }
  }
  if(input.audit.event === "APPROVAL_ISSUED"){const request=input.writes.find(w=>w.collection === "approvalRequests")?.value as ApprovalRequest | undefined;if(!request || !Number.isFinite(request.expiresAt) || request.expiresAt<=Date.now())throw new PlatformDenied("APPROVAL_REQUEST_EXPIRED_AT_COMMIT");}
  canonicalJson(input);
}
function persistedControlValue(write:ControlCommit["writes"][number]):Record<string,unknown>{const value=write.value as Record<string,unknown>;if(write.collection==="pausedAdBatchJobs")return {...value,expireTime:new Date(Number(value.createdAt)+90*86400000)};if(write.collection==="researchFinancialCheckpoints")return value.state==="SETTLED"?{...value,expireTime:new Date(value.expiresAt as number)}:value;if(write.collection==="researchBudgets"&&(value.reservedCents as number)>0)return value;if(write.collection==="whatsappSetupCommands"){const c=value as unknown as WhatsAppSetupCommand;return c.state==="READY"?{...value,expireTime:new Date(c.expiresAt)}:c.state==="SUCCEEDED"?{...value,expireTime:new Date(c.finishedAt!+90*86400000)}:value;}return ["signalDiscoveryProposals","appPromotionProposals","researchJobs","researchBudgets","researchApprovals","manualEligibilityAttestations","approvalRequests","discoveryProposals","mediaProposals","videoProposals","attachmentProposals","whatsappSetupLeases","whatsappSetupCommands","targetingLookups","compatibilityObservations","pageInspectionDelegations","hashtagQuotas","ownerBillingAttestations","accountOwnershipObservations"].includes(write.collection)?{...value,expireTime:new Date((value as unknown as ApprovalRequest).expiresAt)}:value;}
function recordValue<K extends Collection>(collection:K,value:Record<string,unknown>):Records[K]{if(["signalDiscoveryProposals","appPromotionProposals","trackingChangeJobs","pausedAdBatchJobs","researchJobs","researchBudgets","researchApprovals","manualEligibilityAttestations","approvalRequests","discoveryProposals","mediaProposals","videoProposals","attachmentProposals","whatsappSetupLeases","whatsappSetupCommands","targetingLookups","compatibilityObservations","pageInspectionDelegations","hashtagQuotas","ownerBillingAttestations","accountOwnershipObservations"].includes(collection)){const {expireTime:ignored,...record}=value;void ignored;return record as unknown as Records[K];}return value as unknown as Records[K];}
function enrollmentLockKey(appId:string,operatorId:string):string{return createHash("sha256").update(JSON.stringify(["meta-app-user",appId,operatorId])).digest("hex");}
function key(collection: Collection, tenantId: string, id: string): string { return createHash("sha256").update(JSON.stringify([collection, tenantId, id])).digest("hex"); }
function checkApproval(approval: Approval | null, input: Preparation): void {
  const op = input.operation;
  if (!approval || approval.tenantId !== op.tenantId || approval.clientId !== op.clientId || approval.actorId !== op.actorId || !approval.approverId || approval.planHash !== op.planHash || approval.revisionHash !== input.expectedRevisionHash || !Number.isSafeInteger(approval.expiresAt) || approval.expiresAt <= Math.max(input.now,Date.now()) || approval.consumedAt !== null) throw new PlatformDenied("APPROVAL_INVALID_OR_REPLAYED");
}
function checkPreparation(input: Preparation): void {
  const op = input.operation;
  const audit = input.audit;
  if(op.appId!==undefined||op.metaAppUserId!==undefined){const rows=input.expectedRecords.filter(e=>e.collection==="connections"),unique=new Map<string,Connection>();for(const row of rows){const c=JSON.parse(row.canonical) as Connection;if(row.id!==c.id||unique.has(c.id)&&canonicalJson(unique.get(c.id))!==row.canonical)throw new PlatformDenied("OPERATION_PRIVACY_IDENTITY_BINDING_REQUIRED");unique.set(c.id,c);}const selected=[...unique.values()].filter(c=>input.selectedConnectionId===undefined||c.id===input.selectedConnectionId);if(selected.length!==1||selected[0].tenantId!==op.tenantId||selected[0].operatorId!==op.actorId||op.appId!==selected[0].appId||op.metaAppUserId!==connectionPrivacyAppUserId(selected[0]))throw new PlatformDenied("OPERATION_PRIVACY_IDENTITY_BINDING_REQUIRED");}
  const publicationProvider:Record<string,string>={threads_publish_container:"META_THREADS",instagram_publish_container:"META_INSTAGRAM_FACEBOOK_LOGIN",instagram_login_publish:"META_INSTAGRAM_LOGIN",pages_create_videos:"META_FACEBOOK_PAGES"};
  const carouselProviders:Record<string,string>={instagram_create_carousel_container:"META_INSTAGRAM_FACEBOOK_LOGIN",instagram_login_create_carousel_container:"META_INSTAGRAM_LOGIN",threads_create_carousel_container:"META_THREADS"};
  const carouselProvider=carouselProviders[op.tool];
  validateRepointClaim(input);
  if(op.tool==="marketing_delete_paused_ad"&&(!input.approvalId||op.approvalId!==input.approvalId||!input.expectedRecords.some(e=>e.collection==="members"&&e.id===op.actorId&&(()=>{const m=JSON.parse(e.canonical) as Member;return m.tenantId===op.tenantId&&m.operatorId===op.actorId&&m.disabledAt===null&&m.roles.includes("admin")&&m.allowedClientIds.includes(op.clientId);})())))throw new PlatformDenied("DELETION_ADMIN_APPROVAL_REQUIRED");
  validateRepointClaim(input);
  if(op.tool==="marketing_delete_paused_ad"&&!input.deletionClaim)throw new PlatformDenied("DELETION_CLAIM_REQUIRED");
  if(input.deletionClaim){const {before,after}=input.deletionClaim;if(op.tool!=="marketing_delete_paused_ad"||before.type!=="AD"||before.provider!=="META_MARKETING"||before.appId!==op.appId||before.tenantId!==op.tenantId||before.clientId!==op.clientId||before.revokedAt!==null||before.deletionClaim||!input.expectedRecords.some(e=>e.collection==="assets"&&e.id===before.key&&e.canonical===canonicalJson(before))||canonicalJson(after)!==canonicalJson({...before,revision:before.revision+1,deletionClaim:{operationId:op.id,claimedAt:input.now}}))throw new PlatformDenied("DELETION_CLAIM_INVALID");}
  if(input.publicationClaims){
    const claims=input.publicationClaims,max=carouselProvider==="META_THREADS"?20:10;
    if(!carouselProvider||input.publicationClaim||claims.length<2||claims.length>max||new Set(claims.map(c=>c.before.key)).size!==claims.length)throw new PlatformDenied("CAROUSEL_CLAIMS_INVALID");
    for(const {before,after} of claims)if(before.provider!==carouselProvider||before.type!=="MEDIA"||before.productKind!==(carouselProvider==="META_THREADS"?"threads_carousel_item":"instagram_carousel_item")||before.appId!==op.appId||before.tenantId!==op.tenantId||before.clientId!==op.clientId||before.publicationClaim||!input.expectedRecords.some(e=>e.collection==="assets"&&e.id===before.key&&e.canonical===canonicalJson(before))||canonicalJson(after)!==canonicalJson({...before,revision:before.revision+1,publicationClaim:{operationId:op.id,claimedAt:input.now}}))throw new PlatformDenied("CAROUSEL_CLAIMS_INVALID");
  }else if(carouselProvider)throw new PlatformDenied("CAROUSEL_CLAIMS_REQUIRED");
  if(input.publicationClaim){
    const {before,after}=input.publicationClaim;
    if(!publicationProvider[op.tool] || before.provider!==publicationProvider[op.tool] || before.type!=="MEDIA" || before.tenantId!==op.tenantId || before.clientId!==op.clientId || before.publicationClaim || !input.expectedRecords.some(e=>e.collection==="assets" && e.id===before.key && e.canonical===canonicalJson(before)) || canonicalJson(after)!==canonicalJson({...before,revision:before.revision+1,publicationClaim:{operationId:op.id,claimedAt:input.now}}))throw new PlatformDenied("PUBLICATION_CLAIM_INVALID");
  }else if(publicationProvider[op.tool])throw new PlatformDenied("PUBLICATION_CLAIM_REQUIRED");
  if(op.state !== "PREPARED" || audit.event !== "PREPARED" || op.id !== audit.operationId || op.tenantId !== audit.tenantId || op.clientId !== audit.clientId || op.actorId !== audit.actorId || op.tool !== audit.tool || op.planHash !== audit.planHash || op.approvalId !== audit.approvalId || op.approvalId !== (input.approvalId ?? null)) throw new PlatformDenied("AUDIT_PREPARATION_MISMATCH");
}
function checkApprover(member: Member | null, approval: Approval, input: Preparation): void {
  if(["marketing_activate_ad","marketing_delete_paused_ad"].includes(input.operation.tool)&&!member?.roles.includes("admin"))throw new PlatformDenied("MARKETING_OWNER_ADMIN_APPROVER_REQUIRED");
  if(!member || member.operatorId !== approval.approverId || member.tenantId !== input.operation.tenantId || member.disabledAt !== null || member.revision !== approval.approverRevision || !member.allowedClientIds.includes(input.operation.clientId) || !member.roles.some(role => role === "admin" || role === "approver")) throw new PlatformDenied("APPROVER_MEMBERSHIP_REQUIRED");
}
function checkCompletion(operation: Operation | null, existingAudit: AuditRecord | null, input: Completion): "COMMIT" | "IDEMPOTENT" {
  const a = input.audit;
  if([input.created,input.deleted,input.repointed].filter(Boolean).length>1)throw new PlatformDenied("COMPLETION_MUTUALLY_EXCLUSIVE");
  if((input.created && a.createdAssetKey !== input.created.asset.key) || (!input.created && a.createdAssetKey))throw new PlatformDenied("AUDIT_COMPLETION_MISMATCH");
  if(input.created && (!["SUCCEEDED","PARTIAL"].includes(input.result) || input.created.asset.createdFromOperationId !== input.operationId || input.created.asset.key !== assetKey(input.created.asset.provider,input.created.asset.appId,input.created.asset) || !a.afterSummary?.some(s=>s.field === "newresource_id" && s.value === input.created!.asset.id)))throw new PlatformDenied("AUDIT_COMPLETION_MISMATCH");
  if(!operation || operation.id !== input.operationId || operation.tenantId !== input.tenantId || a.id !== `${operation.id}:result` || a.operationId !== operation.id || a.tenantId !== operation.tenantId || a.clientId !== operation.clientId || a.actorId !== operation.actorId || a.tool !== operation.tool || a.planHash !== operation.planHash || a.approvalId !== operation.approvalId || a.event !== input.result) throw new PlatformDenied("AUDIT_COMPLETION_MISMATCH");
  if(["PREPARED","EXECUTING"].includes(operation.state)) { if(existingAudit) throw new PlatformDenied("AUDIT_COMPLETION_CONFLICT"); return "COMMIT"; }
  if(operation.state !== input.result || !existingAudit) throw new PlatformDenied("OPERATION_ALREADY_FINISHED");
  const {timestamp: ignoredExistingTime,...existing} = existingAudit;
  const {timestamp: ignoredInputTime,...requested} = a;
  void ignoredExistingTime; void ignoredInputTime;
  if(canonicalJson(existing) !== canonicalJson(requested)) throw new PlatformDenied("AUDIT_COMPLETION_CONFLICT");
  return "IDEMPOTENT";
}
function checkCreated(input: Completion, existingAssets: MetaAsset[], existingGrant: AssetGrant | null): void {
  const c = input.created; if(!c) return;
  const {asset:a,grant:g,connectionBefore:b,connectionAfter:n} = c;
  const product=PRODUCT_CONTRACTS.find(p=>p.tool===input.audit.tool && p.provider===a.provider && p.verified && p.createdAssetType===a.type);
  if(c.asset.productKind!==product?.createdAssetKind)throw new PlatformDenied("CREATED_ASSET_KIND_BINDING_REQUIRED");
  const replacementCreative=a.type==="CREATIVE"&&a.sourceAssetKeys!==undefined;
  if(replacementCreative){
    const source=Array.isArray(a.sourceAssetKeys)&&a.sourceAssetKeys.length===1?existingAssets.find(row=>row.key===a.sourceAssetKeys![0]):undefined;
    if(input.audit.tool!=="ads_create_ad_creative"||b.tokenType!=="user"||!source||source.type!=="AD"||source.tenantId!==a.tenantId||source.clientId!==a.clientId||source.appId!==a.appId||source.provider!==a.provider||source.revokedAt!==null||a.parents.some(ref=>ref.type==="AD")||!c.expectedRecords.some(row=>row.collection==="assets"&&row.id===source.key&&row.canonical===canonicalJson(source)))throw new PlatformDenied("CREATIVE_SOURCE_AD_PROVENANCE_REQUIRED");
  }
  if(a.type==="CUSTOM_CONVERSION"){const d=a.purchaseConversionDefinition;if(product?.tool!=="marketing_create_purchase_conversion"||!d||d.kind!=="website_purchase_value"||d.operationId!==input.operationId||d.requestDigest!==input.audit.planHash||d.createdAt!==a.verifiedAt||!Number.isSafeInteger(d.createdAt)||d.createdAt<=0||d.createdAt>input.audit.timestamp||a.parents.length!==2||a.parents[0].type!=="AD_ACCOUNT"||a.parents[1].type!=="PIXEL"||a.parents[1].id!==d.pixelId)throw new PlatformDenied("CREATED_PURCHASE_CONVERSION_DEFINITION_REQUIRED");validatePurchaseConversionInput({name:"Definition validation",pixel_id:d.pixelId,minimum_value:d.minimumValue});}else if(a.purchaseConversionDefinition!==undefined)throw new PlatformDenied("CREATED_PURCHASE_CONVERSION_DEFINITION_REQUIRED");
  if(a.type==="REPORT"){
    const definition=a.reportDefinition;
    if(product?.tool!=="marketing_create_async_report"||!definition||definition.kind!=="account_insights"||definition.level!=="account"||definition.useUnifiedAttributionSetting!==true||definition.operationId!==input.operationId||definition.requestDigest!==input.audit.planHash||definition.createdAt!==a.verifiedAt||!Number.isSafeInteger(definition.createdAt)||definition.createdAt<=0||definition.createdAt>input.audit.timestamp)throw new PlatformDenied("CREATED_REPORT_DEFINITION_REQUIRED");
    marketingReportBody({since:definition.since,until:definition.until});
    if(canonicalJson(definition.fields)!==canonicalJson(MARKETING_REPORT_FIELDS))throw new PlatformDenied("CREATED_REPORT_DEFINITION_REQUIRED");
  }else if(a.reportDefinition!==undefined)throw new PlatformDenied("CREATED_REPORT_DEFINITION_REQUIRED");
  if(a.type==="RULE"){
    const definition=a.ruleDefinition;
    if(product?.tool!=="marketing_create_disabled_pause_rule"||!definition||definition.kind!=="disabled_static_ad_pause"||definition.status!=="DISABLED"||definition.schedule!=="DAILY"||definition.timePreset!=="LAST_7_DAYS"||definition.operationId!==input.operationId||definition.requestDigest!==input.audit.planHash||definition.createdAt!==a.verifiedAt||!Number.isSafeInteger(definition.createdAt)||definition.createdAt<=0||definition.createdAt>input.audit.timestamp)throw new PlatformDenied("CREATED_RULE_DEFINITION_REQUIRED");
    validateMarketingRuleInput({name:"Definition validation",ad_ids:definition.adIds,impressions_threshold:definition.impressionsThreshold});
    const parents=a.parents.filter(ref=>ref.type==="AD").map(ref=>ref.id).sort();
    if(canonicalJson(parents)!==canonicalJson([...definition.adIds].sort())||a.parents.some(ref=>!["AD_ACCOUNT","AD"].includes(ref.type)))throw new PlatformDenied("CREATED_RULE_STATIC_SCOPE_REQUIRED");
  }else if(a.ruleDefinition!==undefined)throw new PlatformDenied("CREATED_RULE_DEFINITION_REQUIRED");
  if(a.type==="STUDY"){
    const definition=a.studyDefinition;
    if(product?.tool!=="marketing_create_classic_split_study"||!definition||definition.kind!=="classic_split_test"||definition.allocation!=="50_50"||definition.operationId!==input.operationId||definition.requestDigest!==input.audit.planHash||definition.createdAt!==a.verifiedAt||!Number.isSafeInteger(definition.createdAt)||definition.createdAt<=0||definition.createdAt>input.audit.timestamp||a.parents[0]?.type!=="BUSINESS"||a.parents[0].id!==definition.businessId)throw new PlatformDenied("CREATED_STUDY_DEFINITION_REQUIRED");
    validateMarketingStudyInput({name:"Definition validation",account_id:definition.accountId,campaign_ids:definition.campaignIds,start_time:definition.startTime,end_time:definition.endTime});
    const campaigns=a.parents.filter(ref=>ref.type==="CAMPAIGN").map(ref=>ref.id).sort(),accounts=a.parents.filter(ref=>ref.type==="AD_ACCOUNT");
    if(canonicalJson(campaigns)!==canonicalJson([...definition.campaignIds].sort())||accounts.length!==1||accounts[0].id.replace(/^act_/,"")!==definition.accountId.replace(/^act_/,"")||a.parents.some(ref=>!["BUSINESS","AD_ACCOUNT","CAMPAIGN"].includes(ref.type)))throw new PlatformDenied("CREATED_STUDY_STATIC_SCOPE_REQUIRED");
  }else if(a.studyDefinition!==undefined)throw new PlatformDenied("CREATED_STUDY_DEFINITION_REQUIRED");
  const publishedOwner=publishedProductOwnerType(product);
  if(publishedOwner){if(a.parents.length!==1||a.parents[0].type!==publishedOwner||!Array.isArray(a.sourceAssetKeys)||a.sourceAssetKeys.length>20||new Set(a.sourceAssetKeys).size!==a.sourceAssetKeys.length||a.sourceAssetKeys.some(key=>typeof key!=="string"||key.length>128||!c.expectedRecords.some(e=>e.collection==="assets"&&e.id===key)||existingAssets.some(asset=>asset.key===key&&asset.id===a.parents[0].id&&asset.type===publishedOwner)))throw new PlatformDenied("PUBLISHED_OWNER_PROVENANCE_REQUIRED");}else if(a.sourceAssetKeys!==undefined&&!replacementCreative)throw new PlatformDenied("PUBLISHED_SOURCE_PROVENANCE_CONTRACT_REQUIRED");
  const parentType=({CAMPAIGN:"AD_ACCOUNT",AD_SET:"CAMPAIGN",AD:"AD_SET",CREATIVE:"AD_ACCOUNT"} as Record<string,string>)[a.type] ?? product?.assetType;
  const permittedType=(a.provider==="META_MARKETING" && ["CAMPAIGN","AD_SET","AD","CREATIVE"].includes(a.type)) || (!!product && ["MEDIA","POST","FLOW","TEMPLATE","COMMENT","VIDEO","LEAD_FORM","AD_IMAGE","AD_VIDEO","AUDIENCE","REPORT","RULE","STUDY","CUSTOM_CONVERSION"].includes(a.type));
  if((input.result !== "SUCCEEDED" && !(input.result === "PARTIAL" && ["instagram_publish_container","instagram_login_publish","whatsapp_platform_create_flow"].includes(input.audit.tool))) || !Number.isSafeInteger(c.authorizationExpiresAt) || c.authorizationExpiresAt <= Date.now() || a.createdFromOperationId !== input.operationId || !(product?validCreatedProductId(product,a.id,a.parents[0]?.id??""):/^[0-9]{1,32}$/.test(a.id)) || !permittedType || a.tenantId !== input.tenantId || a.clientId !== input.audit.clientId || a.appId !== b.appId || a.revokedAt !== null || a.revision !== 1 || a.parents.length < 1 || existingAssets.some(asset=>asset.id === a.id) || existingGrant || g.tenantId !== a.tenantId || g.clientId !== a.clientId || g.assetKey !== a.key || g.connectionId !== b.id || g.revokedAt !== null || g.revision !== 1 || g.expiresAt <= Date.now() || b.tenantId !== a.tenantId || b.provider !== a.provider || b.revokedAt !== null || (b.expiresAt !== null && b.expiresAt <= Date.now()) || canonicalJson(n) !== canonicalJson({...b,assetKeys:[...b.assetKeys,a.key],revision:b.revision+1}) || !input.audit.afterSummary?.some(s=>s.field === "newresource_id" && s.value === a.id)) throw new PlatformDenied("CREATED_ASSET_REGISTRATION_REJECTED");
  if((["VIDEO","LEAD_FORM","AD_IMAGE","AD_VIDEO","AUDIENCE","REPORT","RULE","STUDY","CUSTOM_CONVERSION"].includes(a.type)||["messenger_create_utility_template","pages_reply_comment"].includes(product?.tool??""))&&g.tasks.length)throw new PlatformDenied("VIDEO_OWNER_TASK_SCOPE_REQUIRED");
  const parent = existingAssets.find(p=>p.id === a.parents[0].id && p.type === a.parents[0].type);
  if(!parent || parent.clientId !== a.clientId || parent.provider !== a.provider || parent.appId !== a.appId || parent.revokedAt !== null || !b.assetKeys.includes(parent.key) || parentType !== parent.type || !c.expectedRecords.some(e=>e.collection === "assets" && e.id === parent.key && e.canonical === canonicalJson(parent)) || !c.expectedRecords.some(e=>e.collection === "connections" && e.id === b.id && e.canonical === canonicalJson(b)) || !["tenants","members","clients","grants"].every(collection=>c.expectedRecords.some(e=>e.collection===collection))) throw new PlatformDenied("CREATED_ASSET_REGISTRATION_REJECTED");
  const grants=c.expectedRecords.filter(e=>e.collection === "grants").map(e=>JSON.parse(e.canonical) as AssetGrant).filter(g=>g.assetKey===parent.key && g.connectionId===b.id && g.clientId===a.clientId && g.tenantId===a.tenantId && g.revokedAt===null);
  if(a.key!==assetKey(a.provider,a.appId,a) || existingAssets.some(asset=>asset.key===a.key) || !grants.length || grants.some(p=>g.capabilities.some(v=>!p.capabilities.includes(v)) || g.actions.some(v=>!p.actions.includes(v)) || g.tasks.some(v=>!p.tasks.includes(v)) || g.expiresAt>p.expiresAt || g.verifiedAt>p.verifiedAt) || a.parents.some(ref=>!existingAssets.some(p=>p.type===ref.type && p.id===ref.id && p.clientId===a.clientId && p.provider===a.provider && p.appId===a.appId && p.revokedAt===null && c.expectedRecords.some(e=>e.collection==="assets" && e.id===p.key && e.canonical===canonicalJson(p)))))throw new PlatformDenied("CREATED_ASSET_REGISTRATION_REJECTED");
}
export class InMemoryPlatformRepository implements PlatformRepository {
  async assertCatalogCampaignReadResponseCurrent(input:CatalogCampaignReadResponseCheckpoint):Promise<void>{
    input=structuredClone(input);
    const scope=validateCatalogCampaignReadResponseCheckpoint(input),p=input.marketingContext.principal,authApp=process.env.META_APP_ID;if(!authApp||!/^\d{1,100}$/.test(authApp))throw new PlatformDenied("PRIVATE_READ_AUTH_APP_REQUIRED");
    for(const row of input.expectedRecords)if(canonicalJson(this.records.get(key(row.collection,p.tenantId,row.id))??null)!==row.canonical)throw new PlatformDenied("PRIVATE_READ_AUTHORIZATION_CHANGED");
    for(const m of scope.members)if(canonicalJson(this.records.get(key("operatorIndex","_index",m.operatorId))??null)!==canonicalJson({operatorId:m.operatorId,tenantId:p.tenantId}))throw new PlatformDenied("PRIVATE_READ_AUTHORIZATION_CHANGED");
    const identities=[...scope.members.map(m=>({appId:authApp,operatorId:m.operatorId,subject:m.operatorId})),...scope.connections.map(c=>({appId:c.appId,operatorId:c.operatorId,subject:connectionPrivacyAppUserId(c)}))];
    if(identities.some(i=>this.enrollmentLocks.has(enrollmentLockKey(i.appId,i.operatorId))||this.privacySubjectLocks.has(privacySubjectHash(i.appId,i.subject))))throw new PlatformDenied("PRIVATE_READ_PRIVACY_OR_LIFECYCLE_LOCKED");
    validateCatalogCampaignReadResponseCheckpoint(input);
  }
  async assertAdCommentsReadResponseCurrent(input:AdCommentsReadResponseCheckpoint):Promise<void>{
    const scope=validateAdCommentsReadResponseCheckpoint(input),p=input.marketingContext.principal,authApp=process.env.META_APP_ID;if(!authApp||!/^\d{1,100}$/.test(authApp))throw new PlatformDenied("PRIVATE_READ_AUTH_APP_REQUIRED");
    for(const row of input.expectedRecords)if(canonicalJson(this.records.get(key(row.collection,p.tenantId,row.id))??null)!==row.canonical)throw new PlatformDenied("PRIVATE_READ_AUTHORIZATION_CHANGED");
    for(const m of scope.members)if(canonicalJson(this.records.get(key("operatorIndex","_index",m.operatorId))??null)!==canonicalJson({operatorId:m.operatorId,tenantId:p.tenantId}))throw new PlatformDenied("PRIVATE_READ_AUTHORIZATION_CHANGED");
    const identities=[...scope.members.map(m=>({appId:authApp,operatorId:m.operatorId,subject:m.operatorId})),...scope.connections.map(c=>({appId:c.appId,operatorId:c.operatorId,subject:connectionPrivacyAppUserId(c)}))];
    if(identities.some(i=>this.enrollmentLocks.has(enrollmentLockKey(i.appId,i.operatorId))||this.privacySubjectLocks.has(privacySubjectHash(i.appId,i.subject))))throw new PlatformDenied("PRIVATE_READ_PRIVACY_OR_LIFECYCLE_LOCKED");
    validateAdCommentsReadResponseCheckpoint(input);
  }
  async assertPrivateReadResponseCurrent(input:PrivateReadResponseCheckpoint):Promise<void>{
    const scope=validatePrivateReadResponseCheckpoint(input),p=input.context.principal,authApp=process.env.META_APP_ID;if(!authApp||!/^\d{1,100}$/.test(authApp))throw new PlatformDenied("PRIVATE_READ_AUTH_APP_REQUIRED");
    for(const row of input.expectedRecords)if(canonicalJson(this.records.get(key(row.collection,p.tenantId,row.id))??null)!==row.canonical)throw new PlatformDenied("PRIVATE_READ_AUTHORIZATION_CHANGED");
    for(const m of scope.members)if(canonicalJson(this.records.get(key("operatorIndex","_index",m.operatorId))??null)!==canonicalJson({operatorId:m.operatorId,tenantId:p.tenantId}))throw new PlatformDenied("PRIVATE_READ_AUTHORIZATION_CHANGED");
    const identities=[...scope.members.map(m=>({appId:authApp,operatorId:m.operatorId,subject:m.operatorId})),...scope.connections.map(c=>({appId:c.appId,operatorId:c.operatorId,subject:connectionPrivacyAppUserId(c)}))];
    if(identities.some(i=>this.enrollmentLocks.has(enrollmentLockKey(i.appId,i.operatorId))||this.privacySubjectLocks.has(privacySubjectHash(i.appId,i.subject))))throw new PlatformDenied("PRIVATE_READ_PRIVACY_OR_LIFECYCLE_LOCKED");
    validatePrivateReadResponseCheckpoint(input);
  }
  async assertClientMetadataCurrent(input:ClientMetadataCheckpoint):Promise<void>{
    validateClientMetadataCheckpoint(input);const {principal}=input.context,appId=process.env.META_APP_ID;
    if(!appId||!/^\d{1,100}$/.test(appId))throw new PlatformDenied("CLIENT_METADATA_AUTH_APP_REQUIRED");
    for(const row of input.expected)if(canonicalJson(this.records.get(key(row.collection,principal.tenantId,row.id))??null)!==row.canonical)throw new PlatformDenied("CLIENT_METADATA_AUTHORIZATION_CHANGED");
    if(canonicalJson(this.records.get(key("operatorIndex","_index",principal.operatorId))??null)!==canonicalJson(principal))throw new PlatformDenied("CLIENT_METADATA_AUTHORIZATION_CHANGED");
    if(this.enrollmentLocks.has(enrollmentLockKey(appId,principal.operatorId))||this.privacySubjectLocks.has(privacySubjectHash(appId,principal.operatorId)))throw new PlatformDenied("CLIENT_METADATA_PRIVACY_OR_LIFECYCLE_LOCKED");
    const deps=clientMetadataProviderDependencies(input);
    if(deps.connections.some(c=>this.enrollmentLocks.has(enrollmentLockKey(c.appId,c.operatorId))||this.privacySubjectLocks.has(privacySubjectHash(c.appId,connectionPrivacyAppUserId(c)))))throw new PlatformDenied("CLIENT_METADATA_PROVIDER_LOCKED");
    if(deps.phoneKeys.some(id=>this.setupPhoneLocks.has(id)))throw new PlatformDenied("WHATSAPP_SETUP_PHONE_UNRESOLVED");
  }
  async assertConnectionMetadataCurrent(input:ConnectionMetadataCheckpoint):Promise<void>{
    const connections=validateConnectionMetadataCheckpoint(input),{principal}=input.context,authApp=process.env.META_APP_ID;
    if(!authApp||!/^[0-9]{1,100}$/.test(authApp))throw new PlatformDenied("CONNECTION_METADATA_AUTH_APP_REQUIRED");
    for(const row of input.expected)if(canonicalJson(this.records.get(key(row.collection,principal.tenantId,row.id))??null)!==row.canonical)throw new PlatformDenied("CONNECTION_METADATA_AUTHORIZATION_CHANGED");
    if(canonicalJson(this.records.get(key("operatorIndex","_index",principal.operatorId))??null)!==canonicalJson(principal))throw new PlatformDenied("CONNECTION_METADATA_AUTHORIZATION_CHANGED");
    const identities=[{appId:authApp,operatorId:principal.operatorId,appUserId:principal.operatorId},...connections.map(c=>({appId:c.appId,operatorId:c.operatorId,appUserId:connectionPrivacyAppUserId(c)}))];
    if(identities.some(i=>this.enrollmentLocks.has(enrollmentLockKey(i.appId,i.operatorId))||this.privacySubjectLocks.has(privacySubjectHash(i.appId,i.appUserId))))throw new PlatformDenied("CONNECTION_METADATA_PRIVACY_OR_LIFECYCLE_LOCKED");
    for(const c of connections.filter(c=>c.provider==="META_WHATSAPP"))for(const row of input.expected.filter(r=>r.collection==="assets")){const a=JSON.parse(row.canonical) as MetaAsset;if(a.type==="WHATSAPP_PHONE"&&a.appId===c.appId&&c.assetKeys.includes(a.key)&&this.setupPhoneLocks.has(setupPhoneLockKey(c.appId,a.id)))throw new PlatformDenied("WHATSAPP_SETUP_PHONE_UNRESOLVED");}
  }
  readonly enrollmentLocks=new Map<string,unknown>();
  readonly setupPhoneLocks=new Map<string,{commandId:string}>();
  async isWhatsAppSetupPhoneLocked(id:string):Promise<boolean>{return this.setupPhoneLocks.has(id);}
  readonly privacySubjectLocks=new Map<string,unknown>();
  async assertResearchReadCurrent(input:ResearchReadCheckpoint):Promise<void>{input=structuredClone(input);const scope=researchReadScope(input),authApp=process.env.META_APP_ID;if(!authApp||authApp!==input.appId)throw new PlatformDenied("RESEARCH_AUTH_APP_REQUIRED");for(const row of input.expectedRecords)if(canonicalJson(this.records.get(key(row.collection,input.principal.tenantId,row.id))??null)!==row.canonical)throw new PlatformDenied("RESEARCH_READ_AUTHORIZATION_CHANGED");for(const member of scope.members)if(canonicalJson(this.records.get(key("operatorIndex","_index",member.operatorId))??null)!==canonicalJson({operatorId:member.operatorId,tenantId:input.principal.tenantId}))throw new PlatformDenied("RESEARCH_READ_AUTHORIZATION_CHANGED");const identities=[...scope.members.map(m=>({appId:authApp,operatorId:m.operatorId,appUserId:m.operatorId})),...scope.connections.map(c=>({appId:c.appId,operatorId:c.operatorId,appUserId:connectionPrivacyAppUserId(c)}))];if(identities.some(i=>this.enrollmentLocks.has(enrollmentLockKey(i.appId,i.operatorId))||this.privacySubjectLocks.has(privacySubjectHash(i.appId,i.appUserId))))throw new PlatformDenied("RESEARCH_READ_PRIVACY_OR_LIFECYCLE_LOCKED");researchReadScope(input);}
  async assertResearchComparisonReadCurrent(input:ResearchComparisonReadCheckpoint):Promise<void>{input=structuredClone(input);const scope=researchComparisonReadScope(input),authApp=process.env.META_APP_ID;if(!authApp||authApp!==input.appId)throw new PlatformDenied("RESEARCH_COMPARISON_AUTH_APP_REQUIRED");for(const row of input.expectedRecords)if(canonicalJson(this.records.get(key(row.collection,input.principal.tenantId,row.id))??null)!==row.canonical)throw new PlatformDenied("RESEARCH_COMPARISON_AUTHORIZATION_CHANGED");for(const member of scope.members)if(canonicalJson(this.records.get(key("operatorIndex","_index",member.operatorId))??null)!==canonicalJson({operatorId:member.operatorId,tenantId:input.principal.tenantId}))throw new PlatformDenied("RESEARCH_COMPARISON_AUTHORIZATION_CHANGED");const identities=[...scope.members.map(m=>({appId:authApp,operatorId:m.operatorId,appUserId:m.operatorId})),...scope.connections.map(c=>({appId:c.appId,operatorId:c.operatorId,appUserId:connectionPrivacyAppUserId(c)}))];if(identities.some(i=>this.enrollmentLocks.has(enrollmentLockKey(i.appId,i.operatorId))||this.privacySubjectLocks.has(privacySubjectHash(i.appId,i.appUserId))))throw new PlatformDenied("RESEARCH_COMPARISON_PRIVACY_OR_LIFECYCLE_LOCKED");researchComparisonReadScope(input);}
  async assertResearchListReadCurrent(input:ResearchListReadCheckpoint):Promise<void>{input=structuredClone(input);const scope=researchListReadScope(input),authApp=process.env.META_APP_ID;if(!authApp||authApp!==input.appId)throw new PlatformDenied("RESEARCH_LIST_AUTH_APP_REQUIRED");for(const row of input.expectedRecords)if(canonicalJson(this.records.get(key(row.collection,input.principal.tenantId,row.id))??null)!==row.canonical)throw new PlatformDenied("RESEARCH_LIST_AUTHORIZATION_CHANGED");for(const member of scope.members)if(canonicalJson(this.records.get(key("operatorIndex","_index",member.operatorId))??null)!==canonicalJson({operatorId:member.operatorId,tenantId:input.principal.tenantId}))throw new PlatformDenied("RESEARCH_LIST_AUTHORIZATION_CHANGED");const identities=[...scope.members.map(m=>({appId:authApp,operatorId:m.operatorId,appUserId:m.operatorId})),...scope.connections.map(c=>({appId:c.appId,operatorId:c.operatorId,appUserId:connectionPrivacyAppUserId(c)}))];if(identities.some(i=>this.enrollmentLocks.has(enrollmentLockKey(i.appId,i.operatorId))||this.privacySubjectLocks.has(privacySubjectHash(i.appId,i.appUserId))))throw new PlatformDenied("RESEARCH_LIST_PRIVACY_OR_LIFECYCLE_LOCKED");researchListReadScope(input);}
  async assertSignalDiscoveryReadCurrent(input:SignalDiscoveryReadCheckpoint):Promise<void>{input={...input,principal:{...input.principal},expected:structuredClone(input.expected)};const scope=signalDiscoveryReadScope(input),authApp=process.env.META_APP_ID;if(!authApp||!/^\d{1,100}$/.test(authApp))throw new PlatformDenied("SIGNAL_DISCOVERY_AUTH_APP_REQUIRED");for(const row of input.expected)if(canonicalJson(this.records.get(key(row.collection,input.tenantId,row.id))??null)!==row.canonical)throw new PlatformDenied("SIGNAL_DISCOVERY_READ_AUTHORIZATION_CHANGED");for(const member of scope.members)if(canonicalJson(this.records.get(key("operatorIndex","_index",member.operatorId))??null)!==canonicalJson({operatorId:member.operatorId,tenantId:input.tenantId}))throw new PlatformDenied("SIGNAL_DISCOVERY_READ_AUTHORIZATION_CHANGED");const identities=[...scope.members.map(m=>({appId:authApp,operatorId:m.operatorId,appUserId:m.operatorId})),...scope.connections.map(c=>({appId:c.appId,operatorId:c.operatorId,appUserId:connectionPrivacyAppUserId(c)}))];if(identities.some(i=>this.enrollmentLocks.has(enrollmentLockKey(i.appId,i.operatorId))||this.privacySubjectLocks.has(privacySubjectHash(i.appId,i.appUserId))))throw new PlatformDenied("SIGNAL_DISCOVERY_READ_PRIVACY_OR_LIFECYCLE_LOCKED");signalDiscoveryReadScope(input);}
  async assertAppPromotionReadCurrent(input:AppPromotionReadCheckpoint):Promise<void>{input={...input,principal:{...input.principal},expected:structuredClone(input.expected)};const scope=appPromotionReadScope(input),authApp=process.env.META_APP_ID;if(!authApp||!/^\d{1,100}$/.test(authApp))throw new PlatformDenied("APP_PROMOTION_AUTH_APP_REQUIRED");for(const row of input.expected)if(canonicalJson(this.records.get(key(row.collection,input.tenantId,row.id))??null)!==row.canonical)throw new PlatformDenied("APP_PROMOTION_READ_AUTHORIZATION_CHANGED");for(const member of scope.members)if(canonicalJson(this.records.get(key("operatorIndex","_index",member.operatorId))??null)!==canonicalJson({operatorId:member.operatorId,tenantId:input.tenantId}))throw new PlatformDenied("APP_PROMOTION_READ_AUTHORIZATION_CHANGED");const identities=[...scope.members.map(m=>({appId:authApp,operatorId:m.operatorId,appUserId:m.operatorId})),...scope.connections.map(c=>({appId:c.appId,operatorId:c.operatorId,appUserId:connectionPrivacyAppUserId(c)}))];if(identities.some(i=>this.enrollmentLocks.has(enrollmentLockKey(i.appId,i.operatorId))||this.privacySubjectLocks.has(privacySubjectHash(i.appId,i.appUserId))))throw new PlatformDenied("APP_PROMOTION_READ_PRIVACY_OR_LIFECYCLE_LOCKED");appPromotionReadScope(input);}
  async assertTrackingReadCurrent(input:TrackingReadCheckpoint):Promise<void>{const scope=trackingReadScope(input);for(const row of input.expected)if(canonicalJson(this.records.get(key(row.collection,input.tenantId,row.id))??null)!==row.canonical)throw new PlatformDenied("TRACKING_READ_AUTHORIZATION_CHANGED");for(const id of scope.operators)if(canonicalJson(this.records.get(key("operatorIndex","_index",id))??null)!==canonicalJson({operatorId:id,tenantId:input.tenantId}))throw new PlatformDenied("TRACKING_READ_AUTHORIZATION_CHANGED");if(this.enrollmentLocks.has(enrollmentLockKey(scope.job.appId,scope.job.actorId))||[scope.job.metaAppUserId,...scope.operators].some(id=>this.privacySubjectLocks.has(privacySubjectHash(scope.job.appId,id))))throw new PlatformDenied("TRACKING_READ_PRIVACY_OR_LIFECYCLE_LOCKED");}
  async assertBatchReadCurrent(input:BatchReadCheckpoint):Promise<void>{const scope=batchReadScope(input);for(const row of input.expected)if(canonicalJson(this.records.get(key(row.collection,input.tenantId,row.id))??null)!==row.canonical)throw new PlatformDenied("BATCH_READ_AUTHORIZATION_CHANGED");for(const id of scope.operators)if(canonicalJson(this.records.get(key("operatorIndex","_index",id))??null)!==canonicalJson({operatorId:id,tenantId:input.tenantId}))throw new PlatformDenied("BATCH_READ_AUTHORIZATION_CHANGED");if(this.enrollmentLocks.has(enrollmentLockKey(scope.job.appId,scope.job.actorId))||[scope.job.metaAppUserId,...scope.operators].some(id=>this.privacySubjectLocks.has(privacySubjectHash(scope.job.appId,id))))throw new PlatformDenied("BATCH_READ_PRIVACY_OR_LIFECYCLE_LOCKED");}

  async isAppUserLifecycleLocked(appId:string,operatorId:string,appUserId=operatorId):Promise<boolean>{return this.enrollmentLocks.has(enrollmentLockKey(appId,operatorId))||this.privacySubjectLocks.has(privacySubjectHash(appId,appUserId));}
  async commitControlPlane(input:ControlCommit):Promise<void> {
    checkControlCommit(input);
    if((input.audit.event==="TRACKING_CHANGE_CHANGED"||input.audit.event==="PAUSED_AD_BATCH_CHANGED"||input.audit.event==="CLIENT_ENROLLED"||input.audit.event.startsWith("CLIENT_BUSINESS_")||input.audit.event.startsWith("WHATSAPP_SETUP_"))&&canonicalJson(this.records.get(key("operatorIndex","_index",input.audit.actorId))??null)!==canonicalJson({operatorId:input.audit.actorId,tenantId:input.tenantId}))throw new PlatformDenied("CLIENT_ENROLLMENT_OPERATOR_INDEX_CHANGED");
    if(input.audit.event==="TRACKING_CHANGE_CHANGED")for(const row of input.expected.filter(e=>e.collection==="members"))if(canonicalJson(this.records.get(key("operatorIndex","_index",row.id))??null)!==canonicalJson({operatorId:row.id,tenantId:input.tenantId}))throw new PlatformDenied("TRACKING_OPERATOR_INDEX_CHANGED");
    for(const id of new Set([input.audit.actorId,...input.expected.filter(e=>e.collection==="members").map(e=>e.id)]))if(canonicalJson(this.records.get(key("operatorIndex","_index",id))??null)!==canonicalJson({operatorId:id,tenantId:input.tenantId}))throw new PlatformDenied("CONTROL_OPERATOR_INDEX_CHANGED");
    if((input.audit.event.startsWith("APP_PROMOTION_")||input.audit.event.startsWith("SIGNAL_DISCOVERY_")||input.audit.event==="SIGNAL_ASSET_ENROLLED")){const authApp=process.env.META_APP_ID;if(!authApp||!/^\d{1,100}$/.test(authApp))throw new PlatformDenied("APP_PROMOTION_AUTH_APP_REQUIRED");const identities=[...input.expected.filter(e=>e.collection==="members").map(e=>({appId:authApp,operatorId:e.id,subject:e.id})),...controlConnections(input).map(c=>({appId:c.appId,operatorId:c.operatorId,subject:connectionPrivacyAppUserId(c)}))];if(identities.some(i=>this.enrollmentLocks.has(enrollmentLockKey(i.appId,i.operatorId))||this.privacySubjectLocks.has(privacySubjectHash(i.appId,i.subject))))throw new PlatformDenied("APP_PROMOTION_CONTROL_DEPENDENCY_LOCKED");}
    if([...privacyIdentities(controlConnections(input),[input.audit.actorId]),...setupControlIdentities(input),...batchControlIdentities(input),...trackingControlIdentities(input)].some(i=>this.privacySubjectLocks.has(privacySubjectHash(i.appId,i.appUserId))))throw new PlatformDenied("APP_USER_PRIVACY_LOCKED");
    if(["ACCOUNT_OWNER_OBSERVED","TRACKING_CHANGE_CHANGED","PAUSED_AD_BATCH_CHANGED"].includes(input.audit.event) && input.expected.filter(e=>e.collection==="connections").some(e=>{const c=JSON.parse(e.canonical) as Connection;return this.enrollmentLocks.has(enrollmentLockKey(c.appId,c.operatorId));}))throw new PlatformDenied("APP_USER_LIFECYCLE_ENROLLMENT_LOCKED");
    if(["CONNECTION_ENROLLED","ASSET_ENROLLED","MEDIA_ENROLLED","VIDEO_ENROLLED","COMPATIBILITY_OBSERVED"].includes(input.audit.event) && input.writes.some(w=>w.collection==="connections" && this.enrollmentLocks.has(enrollmentLockKey((w.value as Connection).appId,(w.value as Connection).operatorId))))throw new PlatformDenied("APP_USER_LIFECYCLE_ENROLLMENT_LOCKED");
    for(const expected of input.expected) if(canonicalJson(this.records.get(key(expected.collection,input.tenantId,expected.id)) ?? null)!==expected.canonical) throw new PlatformDenied("CONTROL_AUTHORIZATION_CHANGED");
    if(this.records.has(key("controlAudit",input.tenantId,input.audit.id)))throw new PlatformDenied("CONTROL_AUDIT_ALREADY_EXISTS");
    for(const write of input.writes) if(write.createOnly && this.records.has(key(write.collection,input.tenantId,write.id)))throw new PlatformDenied("CONTROL_RECORD_ALREADY_EXISTS");
    if(ordinarySetupPhoneKeys(input).some(id=>this.setupPhoneLocks.has(id)))throw new PlatformDenied("WHATSAPP_SETUP_PHONE_UNRESOLVED");
    if(input.setupPhoneLock){const lock=this.setupPhoneLocks.get(input.setupPhoneLock.key);if(input.setupPhoneLock.operation==="CLAIM"?!!lock:!lock||lock.commandId!==input.setupPhoneLock.commandId)throw new PlatformDenied("WHATSAPP_SETUP_PHONE_UNRESOLVED");}
    const writes=structuredClone(input.writes),audit=structuredClone(input.audit);
    for(const write of writes)this.store(write.collection,input.tenantId,write.id,write.value);
    this.store("controlAudit",input.tenantId,audit.id,audit);
    if(input.setupPhoneLock){if(input.setupPhoneLock.operation==="CLAIM")this.setupPhoneLocks.set(input.setupPhoneLock.key,{commandId:input.setupPhoneLock.commandId});else this.setupPhoneLocks.delete(input.setupPhoneLock.key);}
  }
  private readonly records = new Map<string, unknown>();
  private store(collection: Collection, tenantId: string, id: string, value: unknown): void {
    const storageKey = key(collection, tenantId, id);
    this.records.set(storageKey, value); this.records.set(`${collection}:${tenantId}:${storageKey}`, value);
  }
  async listClientHealthRecords<K extends "assets"|"grants"|"audit">(collection:K,tenantId:string,clientId:string):Promise<Records[K][]> {const rows=(await this.list(collection,tenantId)).filter(r=>r.tenantId===tenantId&&r.clientId===clientId);if(collection==="audit")return rows.filter(r=>["FAILED","UNKNOWN","PARTIAL"].includes((r as AuditRecord).event)).sort((a,b)=>(b as AuditRecord).timestamp-(a as AuditRecord).timestamp).slice(0,50);if(rows.length>200)throw new PlatformDenied("HEALTH_CLIENT_REGISTRY_CAPACITY_HOLD");return rows;}
  async resolvePrincipal(operatorId: string): Promise<PlatformPrincipal | null> {
    const principal = await this.get("operatorIndex", "_index", operatorId);
    if(!principal || principal.operatorId !== operatorId) return null;
    if(process.env.META_APP_ID&&await this.isAppUserLifecycleLocked(process.env.META_APP_ID,operatorId,operatorId))return null;
    const member = await this.get("members", principal.tenantId, operatorId);
    return member && member.operatorId === operatorId && member.tenantId === principal.tenantId && member.disabledAt === null ? principal : null;
  }
  async get<K extends Collection>(collection: K, tenantId: string, id: string): Promise<Records[K] | null> { const value = this.records.get(key(collection, tenantId, id)); return value ? structuredClone(value) as Records[K] : null; }
  async list<K extends Collection>(collection: K, tenantId: string): Promise<Records[K][]> { const prefix = `${collection}:${tenantId}:`; return [...this.records.entries()].filter(([k]) => k.startsWith(prefix)).map(([,v]) => structuredClone(v) as Records[K]); }
  async put<K extends Collection>(collection: K, tenantId: string, id: string, value: Records[K]): Promise<void> {
    const storageKey = key(collection, tenantId, id);
    if (["audit","controlAudit"].includes(collection) && this.records.has(storageKey)) throw new PlatformDenied("AUDIT_APPEND_ONLY");
    this.store(collection, tenantId, id, structuredClone(value));
  }
  async prepareOperation(input: Preparation): Promise<void> {
    checkPreparation(input);
    // No await between checks and commit: this is atomic within the fake's process.
    const op = input.operation;
    const selectedConnections=input.expectedRecords.filter(e=>e.collection==="connections").map(e=>JSON.parse(e.canonical) as Connection);
    if(privacyIdentities(selectedConnections,[op.actorId]).some(i=>this.privacySubjectLocks.has(privacySubjectHash(i.appId,i.appUserId))))throw new PlatformDenied("APP_USER_PRIVACY_LOCKED");
    if(selectedConnections.some(c=>this.enrollmentLocks.has(enrollmentLockKey(c.appId,c.operatorId))))throw new PlatformDenied("APP_USER_LIFECYCLE_EGRESS_LOCKED");
    const opKey = key("operations", op.tenantId, op.id);
    if (this.records.has(opKey)) throw new PlatformDenied("OPERATION_ALREADY_EXISTS");
    for(const expected of input.expectedRecords) if(canonicalJson(this.records.get(key(expected.collection,op.tenantId,expected.id)) ?? null) !== expected.canonical) throw new PlatformDenied("AUTHORIZATION_CHANGED");
    let approval: Approval | null = null;
    if (input.approvalId) { approval = this.records.get(key("approvals", op.tenantId, input.approvalId)) as Approval ?? null; checkApproval(approval, input); checkApprover(this.records.get(key("members",op.tenantId,approval!.approverId)) as Member ?? null,approval!,input); }
    if (this.records.has(key("audit", op.tenantId, input.audit.id))) throw new PlatformDenied("AUDIT_ALREADY_EXISTS");
    const nextOperation = structuredClone(op);
    const nextAudit = structuredClone(input.audit);
    const nextApproval = approval ? structuredClone({ ...approval, consumedAt: input.now, operationId: op.id }) : null;
    for(const claim of input.publicationClaims??[])this.store("assets",op.tenantId,claim.after.key,structuredClone(claim.after));
    if(input.creativeRepointClaim)this.store("assets",op.tenantId,input.creativeRepointClaim.after.key,structuredClone(input.creativeRepointClaim.after));
    if(input.deletionClaim)this.store("assets",op.tenantId,input.deletionClaim.after.key,structuredClone(input.deletionClaim.after));
    if(input.publicationClaim)this.store("assets",op.tenantId,input.publicationClaim.after.key,structuredClone(input.publicationClaim.after));
    if (nextApproval) this.store("approvals", op.tenantId, nextApproval.id, nextApproval);
    this.store("operations", op.tenantId, op.id, nextOperation);
    this.store("audit", op.tenantId, nextAudit.id, nextAudit);
  }
  async finishOperation(input: Completion): Promise<void> {
    const operation = this.records.get(key("operations",input.tenantId,input.operationId)) as Operation ?? null;
    const existing = this.records.get(key("audit",input.tenantId,input.audit.id)) as AuditRecord ?? null;
    if(checkCompletion(operation,existing,input) === "IDEMPOTENT") return;
    const identities=privacyIdentities([], [operation!.actorId]);if(operation!.appId&&operation!.metaAppUserId)identities.push({appId:operation!.appId,appUserId:operation!.metaAppUserId});if(identities.some(i=>this.privacySubjectLocks.has(privacySubjectHash(i.appId,i.appUserId))))throw new PlatformDenied("APP_USER_PRIVACY_LOCKED");
    if(input.created&&this.enrollmentLocks.has(enrollmentLockKey(input.created.connectionBefore.appId,input.created.connectionBefore.operatorId)))throw new PlatformDenied("APP_USER_LIFECYCLE_EGRESS_LOCKED");
    if(input.created) {
      for(const expected of input.created.expectedRecords) if(canonicalJson(this.records.get(key(expected.collection,input.tenantId,expected.id)) ?? null)!==expected.canonical)throw new PlatformDenied("CREATED_ASSET_AUTHORIZATION_CHANGED");
      const assets = [...this.records.entries()].filter(([k])=>k.startsWith(`assets:${input.tenantId}:`)).map(([,v])=>v as MetaAsset);
      checkCreated(input,assets,this.records.get(key("grants",input.tenantId,input.created.grant.id)) as AssetGrant ?? null);
    }
    if(input.deleted){const d=input.deleted;if(!d.connectionsBefore.length)throw new PlatformDenied("DELETED_AD_CONNECTION_REQUIRED");if(this.enrollmentLocks.has(enrollmentLockKey(d.connectionsBefore[0].appId,operation!.actorId)))throw new PlatformDenied("APP_USER_LIFECYCLE_EGRESS_LOCKED");for(const expected of d.expectedRecords)if(canonicalJson(this.records.get(key(expected.collection,input.tenantId,expected.id))??null)!==expected.canonical)throw new PlatformDenied("DELETED_AD_AUTHORIZATION_CHANGED");const values=<T>(collection:string)=>[...this.records.entries()].filter(([k])=>k.startsWith(`${collection}:${input.tenantId}:`)).map(([,v])=>v as T);validateDeletedAdCompletion(input,values<MetaAsset>("assets"),values<AssetGrant>("grants"),values<Connection>("connections"),operation!);}
    if(input.repointed){const r=input.repointed,deps=repointDependencies(r.expectedRecords);for(const id of deps.operators)if(canonicalJson(this.records.get(key("operatorIndex","_index",id))??null)!==canonicalJson({operatorId:id,tenantId:input.tenantId}))throw new PlatformDenied("REPOINTED_AD_AUTHORIZATION_CHANGED");if(deps.connections.some(c=>this.enrollmentLocks.has(enrollmentLockKey(c.appId,c.operatorId)))||deps.operators.some(id=>this.enrollmentLocks.has(enrollmentLockKey(deps.authAppId,id)))||privacyIdentities(deps.connections,deps.operators).some(i=>this.privacySubjectLocks.has(privacySubjectHash(i.appId,i.appUserId))))throw new PlatformDenied("REPOINT_DEPENDENCY_LOCKED");if(this.enrollmentLocks.has(enrollmentLockKey(r.connection.appId,r.connection.operatorId)))throw new PlatformDenied("APP_USER_LIFECYCLE_EGRESS_LOCKED");for(const e of r.expectedRecords)if(canonicalJson(this.records.get(key(e.collection,input.tenantId,e.id))??null)!==e.canonical)throw new PlatformDenied("REPOINTED_AD_AUTHORIZATION_CHANGED");const values=<T>(collection:string)=>[...this.records.entries()].filter(([k])=>k.startsWith(`${collection}:${input.tenantId}:`)).map(([,v])=>v as T);validateRepointedAdCompletion(input,values<MetaAsset>("assets"),values<AssetGrant>("grants"),values<Connection>("connections"),operation!);}
    const nextOperation = structuredClone({...operation!,state:input.result,updatedAt:input.audit.timestamp});
    const audit = structuredClone(input.audit);
    if(input.created){const c=structuredClone(input.created);this.store("assets",input.tenantId,c.asset.key,c.asset);this.store("grants",input.tenantId,c.grant.id,c.grant);this.store("connections",input.tenantId,c.connectionAfter.id,c.connectionAfter);}
    if(input.deleted){const d=input.deleted;this.store("assets",input.tenantId,d.assetAfter.key,structuredClone(d.assetAfter));for(const g of d.grantsAfter)this.store("grants",input.tenantId,g.id,structuredClone(g));for(const c of d.connectionsAfter)this.store("connections",input.tenantId,c.id,structuredClone(c));}
    if(input.repointed)this.store("assets",input.tenantId,input.repointed.assetAfter.key,structuredClone(input.repointed.assetAfter));
    this.store("audit",input.tenantId,audit.id,audit);
    this.store("operations",input.tenantId,input.operationId,nextOperation);
  }
}
export class FirestorePlatformRepository implements PlatformRepository {
  async assertCatalogCampaignReadResponseCurrent(input:CatalogCampaignReadResponseCheckpoint):Promise<void>{
    input=structuredClone(input);
    const scope=validateCatalogCampaignReadResponseCheckpoint(input),p=input.marketingContext.principal,authApp=process.env.META_APP_ID;if(!authApp||!/^\d{1,100}$/.test(authApp))throw new PlatformDenied("PRIVATE_READ_AUTH_APP_REQUIRED");
    const identities=[...scope.members.map(m=>({appId:authApp,operatorId:m.operatorId,subject:m.operatorId})),...scope.connections.map(c=>({appId:c.appId,operatorId:c.operatorId,subject:connectionPrivacyAppUserId(c)}))];
    await this.db.runTransaction(async tx=>{
      const rows=await Promise.all(input.expectedRecords.map(e=>tx.get(this.collection(e.collection,p.tenantId).doc(key(e.collection,p.tenantId,e.id))))),indices=await Promise.all(scope.members.map(m=>tx.get(this.db.collection("platform_operator_index").doc(key("operatorIndex","_index",m.operatorId))))),locks=await Promise.all(identities.flatMap(i=>[tx.get(this.db.collection("platform_lifecycle_locks").doc(enrollmentLockKey(i.appId,i.operatorId))),tx.get(this.db.collection("platform_meta_privacy_subject_locks").doc(privacySubjectHash(i.appId,i.subject)))]));
      for(let i=0;i<rows.length;i++)if(canonicalJson(rows[i].exists?recordValue(input.expectedRecords[i].collection,rows[i].data()!):null)!==input.expectedRecords[i].canonical)throw new PlatformDenied("PRIVATE_READ_AUTHORIZATION_CHANGED");
      for(let i=0;i<indices.length;i++)if(canonicalJson(indices[i].exists?indices[i].data():null)!==canonicalJson({operatorId:scope.members[i].operatorId,tenantId:p.tenantId}))throw new PlatformDenied("PRIVATE_READ_AUTHORIZATION_CHANGED");
      if(locks.some(l=>l.exists))throw new PlatformDenied("PRIVATE_READ_PRIVACY_OR_LIFECYCLE_LOCKED");validateCatalogCampaignReadResponseCheckpoint(input);
    });
    if(process.env.META_APP_ID!==authApp)throw new PlatformDenied("PRIVATE_READ_AUTH_APP_CHANGED");validateCatalogCampaignReadResponseCheckpoint(input);
  }
  async assertAdCommentsReadResponseCurrent(input:AdCommentsReadResponseCheckpoint):Promise<void>{
    const scope=validateAdCommentsReadResponseCheckpoint(input),p=input.marketingContext.principal,authApp=process.env.META_APP_ID;if(!authApp||!/^\d{1,100}$/.test(authApp))throw new PlatformDenied("PRIVATE_READ_AUTH_APP_REQUIRED");
    const identities=[...scope.members.map(m=>({appId:authApp,operatorId:m.operatorId,subject:m.operatorId})),...scope.connections.map(c=>({appId:c.appId,operatorId:c.operatorId,subject:connectionPrivacyAppUserId(c)}))];
    await this.db.runTransaction(async tx=>{
      const rows=await Promise.all(input.expectedRecords.map(e=>tx.get(this.collection(e.collection,p.tenantId).doc(key(e.collection,p.tenantId,e.id))))),indices=await Promise.all(scope.members.map(m=>tx.get(this.db.collection("platform_operator_index").doc(key("operatorIndex","_index",m.operatorId))))),locks=await Promise.all(identities.flatMap(i=>[tx.get(this.db.collection("platform_lifecycle_locks").doc(enrollmentLockKey(i.appId,i.operatorId))),tx.get(this.db.collection("platform_meta_privacy_subject_locks").doc(privacySubjectHash(i.appId,i.subject)))]));
      for(let i=0;i<rows.length;i++)if(canonicalJson(rows[i].exists?recordValue(input.expectedRecords[i].collection,rows[i].data()!):null)!==input.expectedRecords[i].canonical)throw new PlatformDenied("PRIVATE_READ_AUTHORIZATION_CHANGED");
      for(let i=0;i<indices.length;i++)if(canonicalJson(indices[i].exists?indices[i].data():null)!==canonicalJson({operatorId:scope.members[i].operatorId,tenantId:p.tenantId}))throw new PlatformDenied("PRIVATE_READ_AUTHORIZATION_CHANGED");
      if(locks.some(l=>l.exists))throw new PlatformDenied("PRIVATE_READ_PRIVACY_OR_LIFECYCLE_LOCKED");validateAdCommentsReadResponseCheckpoint(input);
    });
  }
  async assertPrivateReadResponseCurrent(input:PrivateReadResponseCheckpoint):Promise<void>{
    const scope=validatePrivateReadResponseCheckpoint(input),p=input.context.principal,authApp=process.env.META_APP_ID;if(!authApp||!/^\d{1,100}$/.test(authApp))throw new PlatformDenied("PRIVATE_READ_AUTH_APP_REQUIRED");
    const identities=[...scope.members.map(m=>({appId:authApp,operatorId:m.operatorId,subject:m.operatorId})),...scope.connections.map(c=>({appId:c.appId,operatorId:c.operatorId,subject:connectionPrivacyAppUserId(c)}))];
    await this.db.runTransaction(async tx=>{
      const rows=await Promise.all(input.expectedRecords.map(e=>tx.get(this.collection(e.collection,p.tenantId).doc(key(e.collection,p.tenantId,e.id))))),indices=await Promise.all(scope.members.map(m=>tx.get(this.db.collection("platform_operator_index").doc(key("operatorIndex","_index",m.operatorId))))),locks=await Promise.all(identities.flatMap(i=>[tx.get(this.db.collection("platform_lifecycle_locks").doc(enrollmentLockKey(i.appId,i.operatorId))),tx.get(this.db.collection("platform_meta_privacy_subject_locks").doc(privacySubjectHash(i.appId,i.subject)))]));
      for(let i=0;i<rows.length;i++)if(canonicalJson(rows[i].exists?recordValue(input.expectedRecords[i].collection,rows[i].data()!):null)!==input.expectedRecords[i].canonical)throw new PlatformDenied("PRIVATE_READ_AUTHORIZATION_CHANGED");
      for(let i=0;i<indices.length;i++)if(canonicalJson(indices[i].exists?indices[i].data():null)!==canonicalJson({operatorId:scope.members[i].operatorId,tenantId:p.tenantId}))throw new PlatformDenied("PRIVATE_READ_AUTHORIZATION_CHANGED");
      if(locks.some(l=>l.exists))throw new PlatformDenied("PRIVATE_READ_PRIVACY_OR_LIFECYCLE_LOCKED");validatePrivateReadResponseCheckpoint(input);
    });
  }
  async assertClientMetadataCurrent(input:ClientMetadataCheckpoint):Promise<void>{
    validateClientMetadataCheckpoint(input);const {principal}=input.context,appId=process.env.META_APP_ID;
    if(!appId||!/^\d{1,100}$/.test(appId))throw new PlatformDenied("CLIENT_METADATA_AUTH_APP_REQUIRED");
    await this.db.runTransaction(async tx=>{
      const records=await Promise.all(input.expected.map(e=>tx.get(this.collection(e.collection,principal.tenantId).doc(key(e.collection,principal.tenantId,e.id)))));
      const index=await tx.get(this.db.collection("platform_operator_index").doc(key("operatorIndex","_index",principal.operatorId)));
      const locks=await Promise.all([tx.get(this.db.collection("platform_lifecycle_locks").doc(enrollmentLockKey(appId,principal.operatorId))),tx.get(this.db.collection("platform_meta_privacy_subject_locks").doc(privacySubjectHash(appId,principal.operatorId)))]);
      const deps=clientMetadataProviderDependencies(input),providerLocks=await Promise.all(deps.connections.flatMap(c=>[tx.get(this.db.collection("platform_lifecycle_locks").doc(enrollmentLockKey(c.appId,c.operatorId))),tx.get(this.db.collection("platform_meta_privacy_subject_locks").doc(privacySubjectHash(c.appId,connectionPrivacyAppUserId(c))))])),phoneLocks=await Promise.all(deps.phoneKeys.map(id=>tx.get(this.db.collection("platform_whatsapp_setup_phone_locks").doc(id))));
      for(let i=0;i<records.length;i++)if(canonicalJson(records[i].exists?recordValue(input.expected[i].collection,records[i].data()!):null)!==input.expected[i].canonical)throw new PlatformDenied("CLIENT_METADATA_AUTHORIZATION_CHANGED");
      if(canonicalJson(index.exists?index.data():null)!==canonicalJson(principal))throw new PlatformDenied("CLIENT_METADATA_AUTHORIZATION_CHANGED");
      if(locks.some(lock=>lock.exists))throw new PlatformDenied("CLIENT_METADATA_PRIVACY_OR_LIFECYCLE_LOCKED");
      if(providerLocks.some(lock=>lock.exists))throw new PlatformDenied("CLIENT_METADATA_PROVIDER_LOCKED");
      if(phoneLocks.some(lock=>lock.exists))throw new PlatformDenied("WHATSAPP_SETUP_PHONE_UNRESOLVED");
      validateClientMetadataCheckpoint(input);
    });
  }
  async assertConnectionMetadataCurrent(input:ConnectionMetadataCheckpoint):Promise<void>{
    const connections=validateConnectionMetadataCheckpoint(input),{principal}=input.context,authApp=process.env.META_APP_ID;
    if(!authApp||!/^[0-9]{1,100}$/.test(authApp))throw new PlatformDenied("CONNECTION_METADATA_AUTH_APP_REQUIRED");
    const identities=[{appId:authApp,operatorId:principal.operatorId,appUserId:principal.operatorId},...connections.map(c=>({appId:c.appId,operatorId:c.operatorId,appUserId:connectionPrivacyAppUserId(c)}))];
    const phoneKeys=connections.filter(c=>c.provider==="META_WHATSAPP").flatMap(c=>input.expected.filter(r=>r.collection==="assets").flatMap(r=>{const a=JSON.parse(r.canonical) as MetaAsset;return a.type==="WHATSAPP_PHONE"&&a.appId===c.appId&&c.assetKeys.includes(a.key)?[setupPhoneLockKey(c.appId,a.id)]:[];}));
    await this.db.runTransaction(async tx=>{
      const records=await Promise.all(input.expected.map(e=>tx.get(this.collection(e.collection,principal.tenantId).doc(key(e.collection,principal.tenantId,e.id)))));
      const index=await tx.get(this.db.collection("platform_operator_index").doc(key("operatorIndex","_index",principal.operatorId)));
      const locks=await Promise.all(identities.flatMap(i=>[tx.get(this.db.collection("platform_lifecycle_locks").doc(enrollmentLockKey(i.appId,i.operatorId))),tx.get(this.db.collection("platform_meta_privacy_subject_locks").doc(privacySubjectHash(i.appId,i.appUserId)))]));
      const phones=await Promise.all(phoneKeys.map(id=>tx.get(this.db.collection("platform_whatsapp_setup_phone_locks").doc(id))));
      for(let i=0;i<records.length;i++)if(canonicalJson(records[i].exists?recordValue(input.expected[i].collection,records[i].data()!):null)!==input.expected[i].canonical)throw new PlatformDenied("CONNECTION_METADATA_AUTHORIZATION_CHANGED");
      if(canonicalJson(index.exists?index.data():null)!==canonicalJson(principal))throw new PlatformDenied("CONNECTION_METADATA_AUTHORIZATION_CHANGED");
      if(locks.some(lock=>lock.exists))throw new PlatformDenied("CONNECTION_METADATA_PRIVACY_OR_LIFECYCLE_LOCKED");
      if(phones.some(lock=>lock.exists))throw new PlatformDenied("WHATSAPP_SETUP_PHONE_UNRESOLVED");
      validateConnectionMetadataCheckpoint(input);
    });
  }
  async isWhatsAppSetupPhoneLocked(id:string):Promise<boolean>{return (await this.db.collection("platform_whatsapp_setup_phone_locks").doc(id).get()).exists;}
  constructor(private readonly db: Firestore) {}
  async isAppUserLifecycleLocked(appId:string,operatorId:string,appUserId=operatorId):Promise<boolean>{const locks=await Promise.all([this.db.collection("platform_lifecycle_locks").doc(enrollmentLockKey(appId,operatorId)).get(),this.db.collection("platform_meta_privacy_subject_locks").doc(privacySubjectHash(appId,appUserId)).get()]);return locks.some(lock=>lock.exists);}
  async commitControlPlane(input:ControlCommit):Promise<void> {
    checkControlCommit(input);
    await this.db.runTransaction(async tx=>{
      checkControlCommit(input);
      const auditRef=this.collection("controlAudit",input.tenantId).doc(key("controlAudit",input.tenantId,input.audit.id));
      const audit=await tx.get(auditRef);
      const provenanceIdentities=[...privacyIdentities(controlConnections(input),[input.audit.actorId,...input.writes.flatMap(w=>{const v=w.value as {actorId?:string;operatorId?:string;approverId?:string;approvedBy?:string};return [v.actorId,v.operatorId,v.approverId,v.approvedBy].filter((id):id is string=>typeof id==="string");})]),...setupControlIdentities(input),...batchControlIdentities(input),...trackingControlIdentities(input)];
      const privacyLocks=await Promise.all(provenanceIdentities.map(i=>tx.get(this.db.collection("platform_meta_privacy_subject_locks").doc(privacySubjectHash(i.appId,i.appUserId)))));if(privacyLocks.some(lock=>lock.exists))throw new PlatformDenied("APP_USER_PRIVACY_LOCKED");
      if(["CONNECTION_ENROLLED","ASSET_ENROLLED","MEDIA_ENROLLED","VIDEO_ENROLLED","COMPATIBILITY_OBSERVED","ACCOUNT_OWNER_OBSERVED","TRACKING_CHANGE_CHANGED","PAUSED_AD_BATCH_CHANGED"].includes(input.audit.event)){
        const ids=[...new Set([...input.writes.filter(w=>w.collection==="connections").map(w=>w.value as Connection),...(["ACCOUNT_OWNER_OBSERVED","TRACKING_CHANGE_CHANGED","PAUSED_AD_BATCH_CHANGED"].includes(input.audit.event)?input.expected.filter(e=>e.collection==="connections").map(e=>JSON.parse(e.canonical) as Connection):[])].map(c=>enrollmentLockKey(c.appId,c.operatorId)))];
        const locks=await Promise.all(ids.map(id=>tx.get(this.db.collection("platform_lifecycle_locks").doc(id))));
        if(locks.some(lock=>lock.exists))throw new PlatformDenied("APP_USER_LIFECYCLE_ENROLLMENT_LOCKED");
      }
      if(input.audit.event==="TRACKING_CHANGE_CHANGED"){const ids=[...new Set(input.expected.filter(e=>e.collection==="members").map(e=>e.id))],rows=await Promise.all(ids.map(id=>tx.get(this.db.collection("platform_operator_index").doc(key("operatorIndex","_index",id)))));for(let i=0;i<rows.length;i++)if(canonicalJson(rows[i].exists?rows[i].data():null)!==canonicalJson({operatorId:ids[i],tenantId:input.tenantId}))throw new PlatformDenied("TRACKING_OPERATOR_INDEX_CHANGED");}
      if(input.audit.event==="TRACKING_CHANGE_CHANGED"||input.audit.event==="PAUSED_AD_BATCH_CHANGED"||input.audit.event==="CLIENT_ENROLLED"||input.audit.event.startsWith("CLIENT_BUSINESS_")||input.audit.event.startsWith("WHATSAPP_SETUP_")){const index=await tx.get(this.db.collection("platform_operator_index").doc(key("operatorIndex","_index",input.audit.actorId)));if(canonicalJson(index.exists?index.data():null)!==canonicalJson({operatorId:input.audit.actorId,tenantId:input.tenantId}))throw new PlatformDenied("CLIENT_ENROLLMENT_OPERATOR_INDEX_CHANGED");}
      const expected=await Promise.all(input.expected.map(e=>tx.get(this.collection(e.collection,input.tenantId).doc(key(e.collection,input.tenantId,e.id)))));
      const writes=await Promise.all(input.writes.map(w=>tx.get(this.collection(w.collection,input.tenantId).doc(key(w.collection,input.tenantId,w.id)))));
      if(audit.exists)throw new PlatformDenied("CONTROL_AUDIT_ALREADY_EXISTS");
      for(let i=0;i<expected.length;i++)if(canonicalJson(expected[i].exists?recordValue(input.expected[i].collection,expected[i].data()!):null)!==input.expected[i].canonical)throw new PlatformDenied("CONTROL_AUTHORIZATION_CHANGED");
      for(let i=0;i<writes.length;i++)if(writes[i].exists && input.writes[i].createOnly)throw new PlatformDenied("CONTROL_RECORD_ALREADY_EXISTS");
      const controlMemberIds=[...new Set([input.audit.actorId,...input.expected.filter(e=>e.collection==="members").map(e=>e.id)])],controlIndices=await Promise.all(controlMemberIds.map(id=>tx.get(this.db.collection("platform_operator_index").doc(key("operatorIndex","_index",id)))));for(let i=0;i<controlIndices.length;i++)if(canonicalJson(controlIndices[i].exists?controlIndices[i].data():null)!==canonicalJson({operatorId:controlMemberIds[i],tenantId:input.tenantId}))throw new PlatformDenied("CONTROL_OPERATOR_INDEX_CHANGED");
      if((input.audit.event.startsWith("APP_PROMOTION_")||input.audit.event.startsWith("SIGNAL_DISCOVERY_")||input.audit.event==="SIGNAL_ASSET_ENROLLED")){const authApp=process.env.META_APP_ID;if(!authApp||!/^\d{1,100}$/.test(authApp))throw new PlatformDenied("APP_PROMOTION_AUTH_APP_REQUIRED");const identities=[...input.expected.filter(e=>e.collection==="members").map(e=>({appId:authApp,operatorId:e.id,subject:e.id})),...controlConnections(input).map(c=>({appId:c.appId,operatorId:c.operatorId,subject:connectionPrivacyAppUserId(c)}))],locks=await Promise.all(identities.flatMap(i=>[tx.get(this.db.collection("platform_lifecycle_locks").doc(enrollmentLockKey(i.appId,i.operatorId))),tx.get(this.db.collection("platform_meta_privacy_subject_locks").doc(privacySubjectHash(i.appId,i.subject)))]));if(locks.some(lock=>lock.exists))throw new PlatformDenied("APP_PROMOTION_CONTROL_DEPENDENCY_LOCKED");}
      checkControlCommit(input);
      const ordinarySetupLocks=await Promise.all(ordinarySetupPhoneKeys(input).map(id=>tx.get(this.db.collection("platform_whatsapp_setup_phone_locks").doc(id))));if(ordinarySetupLocks.some(doc=>doc.exists))throw new PlatformDenied("WHATSAPP_SETUP_PHONE_UNRESOLVED");
      const setupLockRef=input.setupPhoneLock?this.db.collection("platform_whatsapp_setup_phone_locks").doc(input.setupPhoneLock.key):null,setupLock=setupLockRef?await tx.get(setupLockRef):null;if(input.setupPhoneLock&&(input.setupPhoneLock.operation==="CLAIM"?setupLock?.exists:!setupLock?.exists||setupLock.data()?.commandId!==input.setupPhoneLock.commandId))throw new PlatformDenied("WHATSAPP_SETUP_PHONE_UNRESOLVED");
      const targetProvenance=controlPrivacyRecords(input,provenanceIdentities);
      if(setupLockRef&&input.setupPhoneLock){if(input.setupPhoneLock.operation==="CLAIM")tx.create(setupLockRef,{commandId:input.setupPhoneLock.commandId,createdAt:input.audit.timestamp});else tx.delete(setupLockRef);}
      for(const write of input.writes){const ref=this.collection(write.collection,input.tenantId).doc(key(write.collection,input.tenantId,write.id));if(write.createOnly)tx.create(ref,persistedControlValue(write));else tx.set(ref,persistedControlValue(write));}
      tx.create(auditRef,input.audit);
      for(const p of targetProvenance)tx.set(this.db.collection(PRIVACY_PROVENANCE_COLLECTION).doc(p.id),p.record);
    });
  }

  async assertResearchReadCurrent(input:ResearchReadCheckpoint):Promise<void>{input=structuredClone(input);const scope=researchReadScope(input),authApp=process.env.META_APP_ID;if(!authApp||authApp!==input.appId)throw new PlatformDenied("RESEARCH_AUTH_APP_REQUIRED");const identities=[...scope.members.map(m=>({appId:authApp,operatorId:m.operatorId,appUserId:m.operatorId})),...scope.connections.map(c=>({appId:c.appId,operatorId:c.operatorId,appUserId:connectionPrivacyAppUserId(c)}))];await this.db.runTransaction(async tx=>{const rows=await Promise.all(input.expectedRecords.map(e=>tx.get(this.collection(e.collection,input.principal.tenantId).doc(key(e.collection,input.principal.tenantId,e.id))))),indices=await Promise.all(scope.members.map(m=>tx.get(this.db.collection("platform_operator_index").doc(key("operatorIndex","_index",m.operatorId))))),locks=await Promise.all(identities.flatMap(i=>[tx.get(this.db.collection("platform_lifecycle_locks").doc(enrollmentLockKey(i.appId,i.operatorId))),tx.get(this.db.collection("platform_meta_privacy_subject_locks").doc(privacySubjectHash(i.appId,i.appUserId)))]));for(let i=0;i<rows.length;i++)if(canonicalJson(rows[i].exists?recordValue(input.expectedRecords[i].collection,rows[i].data()!):null)!==input.expectedRecords[i].canonical)throw new PlatformDenied("RESEARCH_READ_AUTHORIZATION_CHANGED");for(let i=0;i<indices.length;i++)if(canonicalJson(indices[i].exists?indices[i].data():null)!==canonicalJson({operatorId:scope.members[i].operatorId,tenantId:input.principal.tenantId}))throw new PlatformDenied("RESEARCH_READ_AUTHORIZATION_CHANGED");if(locks.some(l=>l.exists))throw new PlatformDenied("RESEARCH_READ_PRIVACY_OR_LIFECYCLE_LOCKED");researchReadScope(input);});if(process.env.META_APP_ID!==authApp)throw new PlatformDenied("RESEARCH_AUTH_APP_CHANGED");researchReadScope(input);}
  async assertResearchComparisonReadCurrent(input:ResearchComparisonReadCheckpoint):Promise<void>{input=structuredClone(input);const scope=researchComparisonReadScope(input),authApp=process.env.META_APP_ID;if(!authApp||authApp!==input.appId)throw new PlatformDenied("RESEARCH_COMPARISON_AUTH_APP_REQUIRED");const identities=[...scope.members.map(m=>({appId:authApp,operatorId:m.operatorId,appUserId:m.operatorId})),...scope.connections.map(c=>({appId:c.appId,operatorId:c.operatorId,appUserId:connectionPrivacyAppUserId(c)}))];await this.db.runTransaction(async tx=>{const rows=await Promise.all(input.expectedRecords.map(e=>tx.get(this.collection(e.collection,input.principal.tenantId).doc(key(e.collection,input.principal.tenantId,e.id))))),indices=await Promise.all(scope.members.map(m=>tx.get(this.db.collection("platform_operator_index").doc(key("operatorIndex","_index",m.operatorId))))),locks=await Promise.all(identities.flatMap(i=>[tx.get(this.db.collection("platform_lifecycle_locks").doc(enrollmentLockKey(i.appId,i.operatorId))),tx.get(this.db.collection("platform_meta_privacy_subject_locks").doc(privacySubjectHash(i.appId,i.appUserId)))]));for(let i=0;i<rows.length;i++)if(canonicalJson(rows[i].exists?recordValue(input.expectedRecords[i].collection,rows[i].data()!):null)!==input.expectedRecords[i].canonical)throw new PlatformDenied("RESEARCH_COMPARISON_AUTHORIZATION_CHANGED");for(let i=0;i<indices.length;i++)if(canonicalJson(indices[i].exists?indices[i].data():null)!==canonicalJson({operatorId:scope.members[i].operatorId,tenantId:input.principal.tenantId}))throw new PlatformDenied("RESEARCH_COMPARISON_AUTHORIZATION_CHANGED");if(locks.some(l=>l.exists))throw new PlatformDenied("RESEARCH_COMPARISON_PRIVACY_OR_LIFECYCLE_LOCKED");researchComparisonReadScope(input);});if(process.env.META_APP_ID!==authApp)throw new PlatformDenied("RESEARCH_COMPARISON_AUTH_APP_CHANGED");researchComparisonReadScope(input);}
  async assertResearchListReadCurrent(input:ResearchListReadCheckpoint):Promise<void>{input=structuredClone(input);const scope=researchListReadScope(input),authApp=process.env.META_APP_ID;if(!authApp||authApp!==input.appId)throw new PlatformDenied("RESEARCH_LIST_AUTH_APP_REQUIRED");const identities=[...scope.members.map(m=>({appId:authApp,operatorId:m.operatorId,appUserId:m.operatorId})),...scope.connections.map(c=>({appId:c.appId,operatorId:c.operatorId,appUserId:connectionPrivacyAppUserId(c)}))];await this.db.runTransaction(async tx=>{const rows=await Promise.all(input.expectedRecords.map(e=>tx.get(this.collection(e.collection,input.principal.tenantId).doc(key(e.collection,input.principal.tenantId,e.id))))),indices=await Promise.all(scope.members.map(m=>tx.get(this.db.collection("platform_operator_index").doc(key("operatorIndex","_index",m.operatorId))))),locks=await Promise.all(identities.flatMap(i=>[tx.get(this.db.collection("platform_lifecycle_locks").doc(enrollmentLockKey(i.appId,i.operatorId))),tx.get(this.db.collection("platform_meta_privacy_subject_locks").doc(privacySubjectHash(i.appId,i.appUserId)))]));for(let i=0;i<rows.length;i++)if(canonicalJson(rows[i].exists?recordValue(input.expectedRecords[i].collection,rows[i].data()!):null)!==input.expectedRecords[i].canonical)throw new PlatformDenied("RESEARCH_LIST_AUTHORIZATION_CHANGED");for(let i=0;i<indices.length;i++)if(canonicalJson(indices[i].exists?indices[i].data():null)!==canonicalJson({operatorId:scope.members[i].operatorId,tenantId:input.principal.tenantId}))throw new PlatformDenied("RESEARCH_LIST_AUTHORIZATION_CHANGED");if(locks.some(l=>l.exists))throw new PlatformDenied("RESEARCH_LIST_PRIVACY_OR_LIFECYCLE_LOCKED");researchListReadScope(input);});if(process.env.META_APP_ID!==authApp)throw new PlatformDenied("RESEARCH_LIST_AUTH_APP_CHANGED");researchListReadScope(input);}
  async assertSignalDiscoveryReadCurrent(input:SignalDiscoveryReadCheckpoint):Promise<void>{input={...input,principal:{...input.principal},expected:structuredClone(input.expected)};const scope=signalDiscoveryReadScope(input),authApp=process.env.META_APP_ID;if(!authApp||!/^\d{1,100}$/.test(authApp))throw new PlatformDenied("SIGNAL_DISCOVERY_AUTH_APP_REQUIRED");const identities=[...scope.members.map(m=>({appId:authApp,operatorId:m.operatorId,appUserId:m.operatorId})),...scope.connections.map(c=>({appId:c.appId,operatorId:c.operatorId,appUserId:connectionPrivacyAppUserId(c)}))];await this.db.runTransaction(async tx=>{const rows=await Promise.all(input.expected.map(e=>tx.get(this.collection(e.collection,input.tenantId).doc(key(e.collection,input.tenantId,e.id))))),indices=await Promise.all(scope.members.map(m=>tx.get(this.db.collection("platform_operator_index").doc(key("operatorIndex","_index",m.operatorId))))),locks=await Promise.all(identities.flatMap(i=>[tx.get(this.db.collection("platform_lifecycle_locks").doc(enrollmentLockKey(i.appId,i.operatorId))),tx.get(this.db.collection("platform_meta_privacy_subject_locks").doc(privacySubjectHash(i.appId,i.appUserId)))]));for(let i=0;i<rows.length;i++)if(canonicalJson(rows[i].exists?recordValue(input.expected[i].collection,rows[i].data()!):null)!==input.expected[i].canonical)throw new PlatformDenied("SIGNAL_DISCOVERY_READ_AUTHORIZATION_CHANGED");for(let i=0;i<indices.length;i++)if(canonicalJson(indices[i].exists?indices[i].data():null)!==canonicalJson({operatorId:scope.members[i].operatorId,tenantId:input.tenantId}))throw new PlatformDenied("SIGNAL_DISCOVERY_READ_AUTHORIZATION_CHANGED");if(locks.some(l=>l.exists))throw new PlatformDenied("SIGNAL_DISCOVERY_READ_PRIVACY_OR_LIFECYCLE_LOCKED");signalDiscoveryReadScope(input);});if(process.env.META_APP_ID!==authApp)throw new PlatformDenied("SIGNAL_DISCOVERY_AUTH_APP_CHANGED");signalDiscoveryReadScope(input);}
  async assertAppPromotionReadCurrent(input:AppPromotionReadCheckpoint):Promise<void>{input={...input,principal:{...input.principal},expected:structuredClone(input.expected)};const scope=appPromotionReadScope(input),authApp=process.env.META_APP_ID;if(!authApp||!/^\d{1,100}$/.test(authApp))throw new PlatformDenied("APP_PROMOTION_AUTH_APP_REQUIRED");const identities=[...scope.members.map(m=>({appId:authApp,operatorId:m.operatorId,appUserId:m.operatorId})),...scope.connections.map(c=>({appId:c.appId,operatorId:c.operatorId,appUserId:connectionPrivacyAppUserId(c)}))];await this.db.runTransaction(async tx=>{const rows=await Promise.all(input.expected.map(e=>tx.get(this.collection(e.collection,input.tenantId).doc(key(e.collection,input.tenantId,e.id))))),indices=await Promise.all(scope.members.map(m=>tx.get(this.db.collection("platform_operator_index").doc(key("operatorIndex","_index",m.operatorId))))),locks=await Promise.all(identities.flatMap(i=>[tx.get(this.db.collection("platform_lifecycle_locks").doc(enrollmentLockKey(i.appId,i.operatorId))),tx.get(this.db.collection("platform_meta_privacy_subject_locks").doc(privacySubjectHash(i.appId,i.appUserId)))]));for(let i=0;i<rows.length;i++)if(canonicalJson(rows[i].exists?recordValue(input.expected[i].collection,rows[i].data()!):null)!==input.expected[i].canonical)throw new PlatformDenied("APP_PROMOTION_READ_AUTHORIZATION_CHANGED");for(let i=0;i<indices.length;i++)if(canonicalJson(indices[i].exists?indices[i].data():null)!==canonicalJson({operatorId:scope.members[i].operatorId,tenantId:input.tenantId}))throw new PlatformDenied("APP_PROMOTION_READ_AUTHORIZATION_CHANGED");if(locks.some(l=>l.exists))throw new PlatformDenied("APP_PROMOTION_READ_PRIVACY_OR_LIFECYCLE_LOCKED");appPromotionReadScope(input);});if(process.env.META_APP_ID!==authApp)throw new PlatformDenied("APP_PROMOTION_AUTH_APP_CHANGED");appPromotionReadScope(input);}
  async assertTrackingReadCurrent(input:TrackingReadCheckpoint):Promise<void>{const scope=trackingReadScope(input);await this.db.runTransaction(async tx=>{const records=await Promise.all(input.expected.map(e=>tx.get(this.collection(e.collection,input.tenantId).doc(key(e.collection,input.tenantId,e.id))))),indices=await Promise.all(scope.operators.map(id=>tx.get(this.db.collection("platform_operator_index").doc(key("operatorIndex","_index",id))))),locks=await Promise.all([tx.get(this.db.collection("platform_lifecycle_locks").doc(enrollmentLockKey(scope.job.appId,scope.job.actorId))),...[...new Set([scope.job.metaAppUserId,...scope.operators])].map(id=>tx.get(this.db.collection("platform_meta_privacy_subject_locks").doc(privacySubjectHash(scope.job.appId,id))))]);for(let i=0;i<records.length;i++)if(canonicalJson(records[i].exists?recordValue(input.expected[i].collection,records[i].data()!):null)!==input.expected[i].canonical)throw new PlatformDenied("TRACKING_READ_AUTHORIZATION_CHANGED");for(let i=0;i<indices.length;i++)if(canonicalJson(indices[i].exists?indices[i].data():null)!==canonicalJson({operatorId:scope.operators[i],tenantId:input.tenantId}))throw new PlatformDenied("TRACKING_READ_AUTHORIZATION_CHANGED");if(locks.some(lock=>lock.exists))throw new PlatformDenied("TRACKING_READ_PRIVACY_OR_LIFECYCLE_LOCKED");});}
  async assertBatchReadCurrent(input:BatchReadCheckpoint):Promise<void>{const scope=batchReadScope(input);await this.db.runTransaction(async tx=>{const records=await Promise.all(input.expected.map(e=>tx.get(this.collection(e.collection,input.tenantId).doc(key(e.collection,input.tenantId,e.id))))),indices=await Promise.all(scope.operators.map(id=>tx.get(this.db.collection("platform_operator_index").doc(key("operatorIndex","_index",id))))),locks=await Promise.all([tx.get(this.db.collection("platform_lifecycle_locks").doc(enrollmentLockKey(scope.job.appId,scope.job.actorId))),...[...new Set([scope.job.metaAppUserId,...scope.operators])].map(id=>tx.get(this.db.collection("platform_meta_privacy_subject_locks").doc(privacySubjectHash(scope.job.appId,id))))]);for(let i=0;i<records.length;i++)if(canonicalJson(records[i].exists?recordValue(input.expected[i].collection,records[i].data()!):null)!==input.expected[i].canonical)throw new PlatformDenied("BATCH_READ_AUTHORIZATION_CHANGED");for(let i=0;i<indices.length;i++)if(canonicalJson(indices[i].exists?indices[i].data():null)!==canonicalJson({operatorId:scope.operators[i],tenantId:input.tenantId}))throw new PlatformDenied("BATCH_READ_AUTHORIZATION_CHANGED");if(locks.some(lock=>lock.exists))throw new PlatformDenied("BATCH_READ_PRIVACY_OR_LIFECYCLE_LOCKED");});}
  async listClientHealthRecords<K extends "assets"|"grants"|"audit">(collection:K,tenantId:string,clientId:string):Promise<Records[K][]> {let query=this.collection(collection,tenantId).where("clientId","==",clientId);if(collection==="audit")query=query.where("event","in",["FAILED","UNKNOWN","PARTIAL"]).orderBy("timestamp","desc").limit(50);else query=query.limit(201);const result=await query.get();if(collection!=="audit"&&result.docs.length>200)throw new PlatformDenied("HEALTH_CLIENT_REGISTRY_CAPACITY_HOLD");return result.docs.map(d=>recordValue(collection,d.data()) as unknown as Records[K]).filter(r=>r.tenantId===tenantId&&r.clientId===clientId);}
  async resolvePrincipal(operatorId: string): Promise<PlatformPrincipal | null> {
    const snap = await this.db.collection("platform_operator_index").doc(key("operatorIndex", "_index", operatorId)).get();
    const principal = snap.exists ? snap.data() as PlatformPrincipal : null;
    if(!principal || principal.operatorId !== operatorId) return null;
    if(process.env.META_APP_ID&&await this.isAppUserLifecycleLocked(process.env.META_APP_ID,operatorId,operatorId))return null;
    const member = await this.get("members", principal.tenantId, operatorId);
    return member && member.operatorId === operatorId && member.tenantId === principal.tenantId && member.disabledAt === null ? principal : null;
  }
  private collection(collection: Collection, tenantId: string) { return this.db.collection("platform_v1").doc(key("tenants", tenantId, tenantId)).collection(collection); }
  async get<K extends Collection>(collection: K, tenantId: string, id: string): Promise<Records[K] | null> { const snap = await this.collection(collection, tenantId).doc(key(collection, tenantId, id)).get(); return snap.exists ? recordValue(collection,snap.data()!) : null; }
  async list<K extends Collection>(collection: K, tenantId: string): Promise<Records[K][]> { const snap = await this.collection(collection, tenantId).limit(1001).get(); if(snap.size > 1000) throw new PlatformDenied("REGISTRY_LIMIT_REQUIRES_PAGINATION"); return snap.docs.map(d => recordValue(collection,d.data())); }
  async put<K extends Collection>(collection: K, tenantId: string, id: string, value: Records[K]): Promise<void> { const ref = collection === "operatorIndex" ? this.db.collection("platform_operator_index").doc(key(collection,"_index",id)) : this.collection(collection, tenantId).doc(key(collection, tenantId, id)); if(["audit","controlAudit"].includes(collection)) await ref.create(value); else await ref.set(collection === "approvalRequests" ? {...value,expireTime:new Date((value as ApprovalRequest).expiresAt)} : value); }
  async prepareOperation(input: Preparation): Promise<void> {
    checkPreparation(input);
    const op = input.operation;
    const opRef = this.collection("operations", op.tenantId).doc(key("operations", op.tenantId, op.id));
    const auditRef = this.collection("audit", op.tenantId).doc(key("audit", op.tenantId, input.audit.id));
    const approvalRef = input.approvalId ? this.collection("approvals", op.tenantId).doc(key("approvals", op.tenantId, input.approvalId)) : null;
    await this.db.runTransaction(async tx => {
      const existing = await tx.get(opRef);
      const audit = await tx.get(auditRef);
      const approval = approvalRef ? await tx.get(approvalRef) : null;
      const approvalDoc = approval?.exists ? approval.data() as Approval : null;
      const selectedConnections=input.expectedRecords.filter(e=>e.collection==="connections").map(e=>JSON.parse(e.canonical) as Connection),provenanceIdentities=privacyIdentities(selectedConnections,[op.actorId,...(approvalDoc?[approvalDoc.approverId]:[])]);
      const privacyLocks=await Promise.all(provenanceIdentities.map(i=>tx.get(this.db.collection("platform_meta_privacy_subject_locks").doc(privacySubjectHash(i.appId,i.appUserId)))));if(privacyLocks.some(lock=>lock.exists))throw new PlatformDenied("APP_USER_PRIVACY_LOCKED");
      const lifecycleLocks=await Promise.all(selectedConnections.map(c=>tx.get(this.db.collection("platform_lifecycle_locks").doc(enrollmentLockKey(c.appId,c.operatorId)))));if(lifecycleLocks.some(lock=>lock.exists))throw new PlatformDenied("APP_USER_LIFECYCLE_EGRESS_LOCKED");
      const approver = approvalDoc ? await tx.get(this.collection("members",op.tenantId).doc(key("members",op.tenantId,approvalDoc.approverId))) : null;
      const checks = await Promise.all(input.expectedRecords.map(expected => tx.get(this.collection(expected.collection,op.tenantId).doc(key(expected.collection,op.tenantId,expected.id)))));
      for(let i = 0; i < checks.length; i++) if(canonicalJson(checks[i].exists ? recordValue(input.expectedRecords[i].collection,checks[i].data()!) : null) !== input.expectedRecords[i].canonical) throw new PlatformDenied("AUTHORIZATION_CHANGED");
      if(existing.exists || audit.exists) throw new PlatformDenied("OPERATION_ALREADY_EXISTS");
      if(approvalRef) { checkApproval(approvalDoc, input); checkApprover(approver?.exists ? approver.data() as Member : null,approvalDoc!,input); }
      for(const claim of input.publicationClaims??[])tx.set(this.collection("assets",op.tenantId).doc(key("assets",op.tenantId,claim.after.key)),claim.after);
      if(input.creativeRepointClaim)tx.set(this.collection("assets",op.tenantId).doc(key("assets",op.tenantId,input.creativeRepointClaim.after.key)),input.creativeRepointClaim.after);
      if(input.deletionClaim)tx.set(this.collection("assets",op.tenantId).doc(key("assets",op.tenantId,input.deletionClaim.after.key)),input.deletionClaim.after);
      if(input.publicationClaim)tx.set(this.collection("assets",op.tenantId).doc(key("assets",op.tenantId,input.publicationClaim.after.key)),input.publicationClaim.after);
      if(approvalRef) tx.update(approvalRef, { consumedAt: input.now, operationId: op.id });
      tx.create(opRef, op); tx.create(auditRef, input.audit);
      for(const p of privacyRecords(provenanceIdentities,op.tenantId,[{collection:"operations",id:op.id},{collection:"audit",id:input.audit.id},...(input.approvalId?[{collection:"approvals",id:input.approvalId}]:[])]))tx.set(this.db.collection(PRIVACY_PROVENANCE_COLLECTION).doc(p.id),p.record);
    });
  }
  async finishOperation(input: Completion): Promise<void> {
    const opRef = this.collection("operations",input.tenantId).doc(key("operations",input.tenantId,input.operationId));
    const auditRef = this.collection("audit",input.tenantId).doc(key("audit",input.tenantId,input.audit.id));
    await this.db.runTransaction(async tx => {
      const operation = await tx.get(opRef);
      const audit = await tx.get(auditRef);
      if(checkCompletion(operation.exists ? operation.data() as Operation : null,audit.exists ? audit.data() as AuditRecord : null,input) === "IDEMPOTENT") return;
      const storedOperation=operation.data() as Operation,provenanceIdentities=privacyIdentities([], [storedOperation.actorId]);if(storedOperation.appId&&storedOperation.metaAppUserId)provenanceIdentities.push({appId:storedOperation.appId,appUserId:storedOperation.metaAppUserId});
      const privacyLocks=await Promise.all(provenanceIdentities.map(i=>tx.get(this.db.collection("platform_meta_privacy_subject_locks").doc(privacySubjectHash(i.appId,i.appUserId)))));if(privacyLocks.some(lock=>lock.exists))throw new PlatformDenied("APP_USER_PRIVACY_LOCKED");
      if(input.created){
        const c=input.created;
        const privacyLock=await tx.get(this.db.collection("platform_meta_privacy_subject_locks").doc(privacySubjectHash(c.connectionBefore.appId,connectionPrivacyAppUserId(c.connectionBefore)))),lifecycleLock=await tx.get(this.db.collection("platform_lifecycle_locks").doc(enrollmentLockKey(c.connectionBefore.appId,c.connectionBefore.operatorId)));if(privacyLock.exists||lifecycleLock.exists)throw new PlatformDenied("APP_USER_PRIVACY_LOCKED");
        const checks=await Promise.all(c.expectedRecords.map(e=>tx.get(this.collection(e.collection,input.tenantId).doc(key(e.collection,input.tenantId,e.id)))));
        const assets=await tx.get(this.collection("assets",input.tenantId).limit(1001));
        const grant=await tx.get(this.collection("grants",input.tenantId).doc(key("grants",input.tenantId,c.grant.id)));
        for(let i=0;i<checks.length;i++)if(canonicalJson(checks[i].exists?recordValue(c.expectedRecords[i].collection,checks[i].data()!):null)!==c.expectedRecords[i].canonical)throw new PlatformDenied("CREATED_ASSET_AUTHORIZATION_CHANGED");
        if(assets.size>1000)throw new PlatformDenied("CREATED_ASSET_REGISTRATION_REJECTED");
        checkCreated(input,assets.docs.map(d=>d.data() as MetaAsset),grant.exists?grant.data() as AssetGrant:null);
        tx.create(this.collection("assets",input.tenantId).doc(key("assets",input.tenantId,c.asset.key)),c.asset);
        tx.create(this.collection("grants",input.tenantId).doc(key("grants",input.tenantId,c.grant.id)),c.grant);
        tx.set(this.collection("connections",input.tenantId).doc(key("connections",input.tenantId,c.connectionAfter.id)),c.connectionAfter);
      }
      if(input.deleted){const d=input.deleted;if(!d.connectionsBefore.length)throw new PlatformDenied("DELETED_AD_CONNECTION_REQUIRED");const checks=await Promise.all(d.expectedRecords.map(e=>tx.get(this.collection(e.collection,input.tenantId).doc(key(e.collection,input.tenantId,e.id))))),assets=await tx.get(this.collection("assets",input.tenantId).limit(1001)),grants=await tx.get(this.collection("grants",input.tenantId).limit(1001)),connections=await tx.get(this.collection("connections",input.tenantId).limit(1001)),lock=await tx.get(this.db.collection("platform_lifecycle_locks").doc(enrollmentLockKey(d.connectionsBefore[0].appId,storedOperation.actorId)));if(lock.exists||assets.size>1000||grants.size>1000||connections.size>1000)throw new PlatformDenied("DELETED_AD_COMMIT_CAPACITY_OR_LOCK_HOLD");for(let i=0;i<checks.length;i++)if(canonicalJson(checks[i].exists?recordValue(d.expectedRecords[i].collection,checks[i].data()!):null)!==d.expectedRecords[i].canonical)throw new PlatformDenied("DELETED_AD_AUTHORIZATION_CHANGED");validateDeletedAdCompletion(input,assets.docs.map(row=>row.data() as MetaAsset),grants.docs.map(row=>row.data() as AssetGrant),connections.docs.map(row=>row.data() as Connection),storedOperation);tx.set(this.collection("assets",input.tenantId).doc(key("assets",input.tenantId,d.assetAfter.key)),d.assetAfter);for(const g of d.grantsAfter)tx.set(this.collection("grants",input.tenantId).doc(key("grants",input.tenantId,g.id)),g);for(const c of d.connectionsAfter)tx.set(this.collection("connections",input.tenantId).doc(key("connections",input.tenantId,c.id)),c);}
      if(input.repointed){const r=input.repointed,deps=repointDependencies(r.expectedRecords),indices=await Promise.all(deps.operators.map(id=>tx.get(this.db.collection("platform_operator_index").doc(key("operatorIndex","_index",id))))),depLocks=await Promise.all([...deps.connections.map(c=>tx.get(this.db.collection("platform_lifecycle_locks").doc(enrollmentLockKey(c.appId,c.operatorId)))),...deps.operators.map(id=>tx.get(this.db.collection("platform_lifecycle_locks").doc(enrollmentLockKey(deps.authAppId,id)))),...privacyIdentities(deps.connections,deps.operators).map(i=>tx.get(this.db.collection("platform_meta_privacy_subject_locks").doc(privacySubjectHash(i.appId,i.appUserId))))]);for(let i=0;i<indices.length;i++)if(canonicalJson(indices[i].exists?indices[i].data():null)!==canonicalJson({operatorId:deps.operators[i],tenantId:input.tenantId}))throw new PlatformDenied("REPOINTED_AD_AUTHORIZATION_CHANGED");if(depLocks.some(lock=>lock.exists))throw new PlatformDenied("REPOINT_DEPENDENCY_LOCKED");const checks=await Promise.all(r.expectedRecords.map(e=>tx.get(this.collection(e.collection,input.tenantId).doc(key(e.collection,input.tenantId,e.id))))),assets=await tx.get(this.collection("assets",input.tenantId).limit(1001)),grants=await tx.get(this.collection("grants",input.tenantId).limit(1001)),connections=await tx.get(this.collection("connections",input.tenantId).limit(1001)),lock=await tx.get(this.db.collection("platform_lifecycle_locks").doc(enrollmentLockKey(r.connection.appId,r.connection.operatorId)));if(lock.exists||assets.size>1000||grants.size>1000||connections.size>1000)throw new PlatformDenied("REPOINTED_AD_CAPACITY_OR_LOCK_HOLD");for(let i=0;i<checks.length;i++)if(canonicalJson(checks[i].exists?recordValue(r.expectedRecords[i].collection,checks[i].data()!):null)!==r.expectedRecords[i].canonical)throw new PlatformDenied("REPOINTED_AD_AUTHORIZATION_CHANGED");validateRepointedAdCompletion(input,assets.docs.map(d=>d.data() as MetaAsset),grants.docs.map(d=>d.data() as AssetGrant),connections.docs.map(d=>d.data() as Connection),storedOperation);tx.set(this.collection("assets",input.tenantId).doc(key("assets",input.tenantId,r.assetAfter.key)),r.assetAfter);}
      tx.create(auditRef,input.audit);
      for(const p of privacyRecords(provenanceIdentities,input.tenantId,[{collection:"audit",id:input.audit.id}]))tx.set(this.db.collection(PRIVACY_PROVENANCE_COLLECTION).doc(p.id),p.record);
      tx.update(opRef,{state:input.result,updatedAt:input.audit.timestamp});
    });
  }
}
