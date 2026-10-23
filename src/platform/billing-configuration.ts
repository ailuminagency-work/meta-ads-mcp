import {createHash} from "node:crypto";
import {z} from "zod";
import {clientBusinessBound} from "./client-business.js";
import {agencyOwnershipBound} from "./ownership-evidence.js";
import {PlatformDenied,type AuthorizationSnapshot,type MetaAsset} from "./models.js";
export const BILLING_CONFIGURATION_FIELDS="id,account_id,business{id},owner,funding_source,funding_source_details{id},capabilities,account_status";
export const BILLING_CONFIGURATION_SOURCE="https://developers.facebook.com/docs/marketing-api/reference/ad-account/";
const id=z.string().regex(/^\d{1,32}$/);
export function billingConfigurationReport(snapshot:AuthorizationSnapshot,account:MetaAsset,raw:unknown,now=Date.now(),agency?:{snapshot:AuthorizationSnapshot;account:MetaAsset;raw:unknown;checkedAt:number}|null){
 const parsed=z.object({id:z.string().regex(/^act_\d{1,32}$/),account_id:id,business:z.object({id}).optional(),owner:id.optional(),account_status:z.number().int().optional(),funding_source:id.nullish(),funding_source_details:z.object({id:id.optional()}).nullish(),capabilities:z.array(z.string().regex(/^[A-Z0-9_]{1,100}$/)).max(200).optional()}).safeParse(raw);
 if(!parsed.success||typeof raw!=="object"||raw===null||Object.hasOwn(raw,"error"))throw new PlatformDenied("BILLING_CONFIGURATION_RESPONSE_INVALID");
 const r=parsed.data;if(r.owner&&r.business?.id&&r.owner!==r.business.id)throw new PlatformDenied("BILLING_CONFIGURATION_OWNER_CONFLICT");
 if(!Number.isSafeInteger(now)||now<=0)throw new PlatformDenied("BILLING_CONFIGURATION_TIME_INVALID");
 if(account.tenantId!==snapshot.tenant.id||account.clientId!==snapshot.client.id||snapshot.client.tenantId!==snapshot.tenant.id||account.type!=="AD_ACCOUNT"||account.provider!=="META_MARKETING"||account.revokedAt!==null||r.account_id!==account.id.replace(/^act_/,"")||r.id!==`act_${r.account_id}`)throw new PlatformDenied("BILLING_CONFIGURATION_ACCOUNT_BINDING_INVALID");
 if(r.funding_source&&r.funding_source_details?.id&&r.funding_source!==r.funding_source_details.id)throw new PlatformDenied("BILLING_CONFIGURATION_FUNDING_CONFLICT");
 const business=r.business?.id,rawFunding=r.funding_source??r.funding_source_details?.id,funding=rawFunding&&rawFunding!=="0"?rawFunding:null;
 let agencyFunding:string[]|null=null;
 if(agency){const r=z.object({id:z.string(),account_id:id,business:z.object({id}),owner:id.optional(),funding_source:id.nullish(),funding_source_details:z.object({id:id.optional()}).nullish()}).safeParse(agency.raw);
  if(!r.success||r.data.owner!==undefined&&r.data.owner!==r.data.business.id||r.data.id!==`act_${agency.account.id.replace(/^act_/,"")}`||r.data.account_id!==agency.account.id.replace(/^act_/,"")||!agencyOwnershipBound(agency.account.tenantId,agency.account.clientId,r.data.business.id)||!clientBusinessBound(agency.snapshot.client,r.data.business.id,now,agency.snapshot.businessOwnerEvidence,agency.account.appId)||agency.account.ownerBusinessId!==undefined&&agency.account.ownerBusinessId!==r.data.business.id||now-agency.checkedAt>300000||agency.checkedAt>now)throw new PlatformDenied("AGENCY_BILLING_COMPARISON_UNVERIFIED");
  if(r.data.funding_source&&r.data.funding_source_details?.id&&r.data.funding_source!==r.data.funding_source_details.id)throw new PlatformDenied("AGENCY_BILLING_COMPARISON_UNVERIFIED");const f=r.data.funding_source??r.data.funding_source_details?.id;if(f&&f!=="0")agencyFunding=[f];
 }
 const configured=!!funding&&r.capabilities?.includes("HAS_VALID_PAYMENT_METHODS")===true;
 const agencyBusiness=process.env.LUMIN_AGENCY_META_BUSINESS_ID;
 let status="UNVERIFIED";
 if(business&&agencyOwnershipBound(account.tenantId,account.clientId,business)&&clientBusinessBound(snapshot.client,business,now,snapshot.businessOwnerEvidence,account.appId))status="AGENCY_OWNED_ACCOUNT";
 else if(business&&agencyBusiness&&business===agencyBusiness)status="AGENCY_OWNED_ACCOUNT";
 else if(!agencyBusiness)status="AGENCY_FUNDING_COMPARISON_UNAVAILABLE";
 else if(account.ownerBusinessId!==undefined&&account.ownerBusinessId!==business)status="ACCOUNT_OWNER_CHANGED";
 else if(!business||!clientBusinessBound(snapshot.client,business,now,snapshot.businessOwnerEvidence,account.appId))status="CLIENT_BUSINESS_BINDING_UNVERIFIED";
 else if(r.account_status!==1)status="ACCOUNT_STATUS_NOT_ACTIVE_OR_UNKNOWN";
 else if(!configured)status="BILLING_NOT_VERIFIABLE";
 else if(!agencyFunding)status="AGENCY_FUNDING_COMPARISON_UNAVAILABLE";
 else if(agencyFunding.includes(funding!))status="AGENCY_FUNDING_CONFLICT";
 else status="CLIENT_OWNED_BILLING_CONFIGURED";
 return {status,observation_only:true,requires_refresh:true,tenant_id:account.tenantId,client_id:account.clientId,account_id:r.id,client_binding_matches:!!business&&clientBusinessBound(snapshot.client,business,now,snapshot.businessOwnerEvidence,account.appId)&&(business!==agencyBusiness||agencyOwnershipBound(account.tenantId,account.clientId,business)),business_id:business??null,checked_at:now,expires_at:now,source:BILLING_CONFIGURATION_SOURCE,receipt_sha256:createHash("sha256").update(JSON.stringify({id:r.id,business_id:business??null,account_status:r.account_status??null,configured,checked_at:now})).digest("hex"),account_status:r.account_status??null,payment_configuration_present:configured?true:null,known_agency_funding_match:funding&&agencyFunding?agencyFunding.includes(funding):null,billing_liability_verified:false,spend_authorized:false,provider_writes:0,interpretation:"Account ownership and configured payment availability only; not payment instrument ownership or liability. No authorization or billing liability state is changed."};
}
