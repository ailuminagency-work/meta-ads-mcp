import {createHash} from "node:crypto";
import {PlatformDenied} from "./models.js";
export const PRIVACY_PROVENANCE_COLLECTION="platform_meta_privacy_provenance";
/** Shared client obligations contain no actor/query/results. Individual withdrawal
 * must not erase an unresolved cost reservation or make a paid attempt replayable. */
export const PRIVACY_SHARED_CLIENT_FINANCIAL_COLLECTIONS=Object.freeze(["researchBudgets","researchFinancialCheckpoints"]);
export const PRIVACY_OWNED_COLLECTIONS=Object.freeze(["signalDiscoveryProposals","appPromotionProposals","trackingChangeJobs","pausedAdBatchJobs","businessOwnerAttestations","manualEligibilityAttestations","connections","grants","credentials","pageInspectionDelegations","mediaProposals","videoProposals","attachmentProposals","whatsappSetupLeases","whatsappSetupCommands","researchJobs","researchApprovals","discoveryProposals","compatibilityObservations","targetingLookups","accountOwnershipObservations","approvalRequests","approvals","operations","audit","controlAudit","ownerBillingAttestations"]);
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const privacySubjectHash=(appId:string,appUserId:string):string=>hash(["meta-privacy-subject",appId,appUserId]);
export interface PrivacyProvenance {version:1;subjectHash:string;targetCollection:string;tenantHash:string;targetIdHash:string;targetPath:string;targetHash:string;createdAt:number}
/** Call only inside the same trusted repository transaction that writes the target.
 * App/user identity must come from validated expected connection/account+actor, never MCP parameters.
 * Minimal hashed provenance has no asynchronous TTL: deleting it before a surviving target would lose erasure coverage.
 */
export function createPrivacyProvenance(input:{appId:string;appUserId:string;tenantId:string;collection:string;id:string;now:number}):{id:string;record:PrivacyProvenance}{
 if(!/^\d{1,100}$/.test(input.appId)||!input.appUserId||input.appUserId.length>128||!input.tenantId||!input.id||!PRIVACY_OWNED_COLLECTIONS.includes(input.collection)||!Number.isSafeInteger(input.now)||input.now<=0)throw new PlatformDenied("PRIVACY_PROVENANCE_BINDING_REQUIRED");const tenantHash=hash(["tenants",input.tenantId,input.tenantId]),targetIdHash=hash([input.collection,input.tenantId,input.id]),targetPath=`platform_v1/${tenantHash}/${input.collection}/${targetIdHash}`,subjectHash=privacySubjectHash(input.appId,input.appUserId),targetHash=hash([targetPath]),id=hash([subjectHash,targetHash]);return {id,record:{version:1,subjectHash,targetCollection:input.collection,tenantHash,targetIdHash,targetPath,targetHash,createdAt:input.now}};
}
export function validatePrivacyProvenance(id:string,row:PrivacyProvenance,subjectHash:string):void {
 if(row.version!==1||row.subjectHash!==subjectHash||!PRIVACY_OWNED_COLLECTIONS.includes(row.targetCollection)||!/^[a-f0-9]{64}$/.test(row.tenantHash)||!/^[a-f0-9]{64}$/.test(row.targetIdHash)||row.targetPath!==`platform_v1/${row.tenantHash}/${row.targetCollection}/${row.targetIdHash}`||row.targetHash!==hash([row.targetPath])||id!==hash([subjectHash,row.targetHash])||!Number.isSafeInteger(row.createdAt)||row.createdAt<=0)throw new PlatformDenied("PRIVACY_PROVENANCE_CORRUPT_HOLD");
}
