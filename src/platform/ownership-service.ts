import {BILLING_CONFIGURATION_FIELDS,billingConfigurationReport} from "./billing-configuration.js";
import {clientBusinessBound,loadClientBusinessEvidence,clientBusinessExpected} from "./client-business.js";
import {randomUUID,createHash} from "node:crypto";
import {z} from "zod";
import {encryptToken} from "../auth/crypto.js";
import {readBodyWithLimit} from "../utils/bounded-body.js";
import {canonicalJson} from "./policy.js";
import {PlatformDenied,type OperationContext,type PlatformPrincipal} from "./models.js";
import type {PlatformRepository,ControlCommit} from "./repository.js";
import {authorizeOperation,finishOperation,getExecutionScope,revalidateExecutionPermit,runWithExecutionPermit,withConnectionCredential} from "./execution.js";
import {assertLegacyMarketingReadEligibility} from "./legacy-egress.js";
import {productRateController} from "./clients.js";
import {agencyOwnershipBound,ACCOUNT_OWNERSHIP_SOURCE,validateOwnerAttestation,ownershipObservationAad,type OwnerBillingAttestation,type AccountOwnershipObservation} from "./ownership-evidence.js";
import {ownershipAsset,newOwnershipAudit,ownershipHash} from "./ownership-control.js";
export class OwnershipEvidenceService {
 constructor(private readonly repo:PlatformRepository,private readonly fetcher:typeof fetch=fetch){}
 private async human(principal:PlatformPrincipal,clientId:string,accountKey:string){
  const trusted=await this.repo.resolvePrincipal(principal.operatorId),[tenant,member,client,account]=await Promise.all([this.repo.get("tenants",principal.tenantId,principal.tenantId),this.repo.get("members",principal.tenantId,principal.operatorId),this.repo.get("clients",principal.tenantId,clientId),this.repo.get("assets",principal.tenantId,accountKey)]);
  if(!trusted||canonicalJson(trusted)!==canonicalJson(principal)||!tenant||tenant.status!=="ACTIVE"||tenant.migrationState!=="READY"||!member||member.disabledAt!==null||!member.allowedClientIds.includes(clientId)||!member.roles.some(r=>["admin","connection_admin"].includes(r))||!client||client.status!=="ACTIVE"||!account||account.clientId!==clientId||account.type!=="AD_ACCOUNT"||account.provider!=="META_MARKETING"||account.revokedAt!==null)throw new PlatformDenied("OWNERSHIP_CONNECTION_ADMIN_REQUIRED");
  const businessOwnerEvidence=await loadClientBusinessEvidence(this.repo,client);
  const expected:ControlCommit["expected"]=[{collection:"tenants",id:tenant.id,canonical:canonicalJson(tenant)},{collection:"members",id:member.operatorId,canonical:canonicalJson(member)},{collection:"clients",id:client.id,canonical:canonicalJson(client)},{collection:"assets",id:account.key,canonical:canonicalJson(account)},...clientBusinessExpected(businessOwnerEvidence)];return {tenant,member,client,account,businessOwnerEvidence,expected};
 }
 /** Human browser controller only: billing is an explicit artifact-backed assertion, never a Meta API conclusion. */
 async attest(principal:PlatformPrincipal,clientId:string,input:{accountKey:string;businessId:string;documentReferenceHash:string;expiresAt:number;reviewedAccountHash?:string}):Promise<{attestationId:string;expiresAt:number}>{
  const s=await this.human(principal,clientId,input.accountKey),now=Date.now();if(input.reviewedAccountHash!==undefined&&input.reviewedAccountHash!==ownershipHash(s.account))throw new PlatformDenied("OWNERSHIP_REVIEW_ACCOUNT_CHANGED");
  const row:OwnerBillingAttestation={id:randomUUID(),tenantId:principal.tenantId,clientId,appId:s.account.appId,accountKey:s.account.key,accountId:s.account.id.replace(/^act_/,""),businessId:input.businessId,source:agencyOwnershipBound(principal.tenantId,clientId,input.businessId)?"AGENCY_OWNER_ATTESTATION":"CLIENT_OWNER_ATTESTATION",approvedBy:principal.operatorId,documentReferenceHash:input.documentReferenceHash,checkedAt:now,expiresAt:input.expiresAt,revokedAt:null,revision:1};validateOwnerAttestation(row,now);
  if(!clientBusinessBound(s.client,row.businessId,now,s.businessOwnerEvidence,s.account.appId))throw new PlatformDenied("ATTESTED_BUSINESS_NOT_CLIENT_REGISTERED");
  await this.repo.commitControlPlane({tenantId:principal.tenantId,expected:s.expected,writes:[{collection:"ownerBillingAttestations",id:row.id,value:row,createOnly:true},{collection:"assets",id:s.account.key,value:ownershipAsset(s.account,row),createOnly:false}],audit:newOwnershipAudit(row,principal.operatorId,"OWNER_BILLING_ATTESTED")});return {attestationId:row.id,expiresAt:row.expiresAt};
 }
 private async readBillingConfiguration(ctx:OperationContext,accountKey:string,connectionId:string){
  const initial=await this.human(ctx.principal,ctx.clientId,accountKey),configuration=()=>JSON.stringify([process.env.LUMIN_AGENCY_META_BUSINESS_ID,process.env.LUMIN_AGENCY_TENANT_ID,process.env.LUMIN_AGENCY_INTERNAL_CLIENT_ID,process.env.LUMIN_AGENCY_BILLING_COMPARISON_JSON]),initialConfiguration=configuration();
  const permit=await authorizeOperation(this.repo,ctx,{assets:[{type:"AD_ACCOUNT",id:initial.account.id}],classes:["READ"],capability:"legacy.ads_get_account_info",requiredScopes:["ads_read"],tokenTypes:["user","system_user"],parameters:{fields:BILLING_CONFIGURATION_FIELDS}},{writesEnabled:false,selectedConnectionId:connectionId});
  try{return await runWithExecutionPermit(permit,async()=>withConnectionCredential(permit,async token=>{
   await revalidateExecutionPermit(permit);assertLegacyMarketingReadEligibility();const scope=getExecutionScope(),bucket=createHash("sha256").update(JSON.stringify(["META_MARKETING",scope.snapshot.connection.appId,createHash("sha256").update(token).digest("hex")])).digest("hex");productRateController.bind(bucket,scope.snapshot.connection.appId);productRateController.check(bucket);
   let raw:unknown;try{const response=await this.fetcher(`https://graph.facebook.com/v26.0/act_${initial.account.id.replace(/^act_/,"")}?fields=${encodeURIComponent(BILLING_CONFIGURATION_FIELDS)}`,{headers:{Authorization:`Bearer ${token}`},redirect:"error",signal:AbortSignal.timeout(15000)});productRateController.observe(bucket,response,null);if(!response.ok)throw new Error();raw=JSON.parse(await readBodyWithLimit(response,16384));}catch{throw new PlatformDenied("BILLING_CONFIGURATION_PROVIDER_READ_FAILED");}
   await revalidateExecutionPermit(permit);assertLegacyMarketingReadEligibility();const snapshot=getExecutionScope().snapshot,account=snapshot.assets.find(a=>a.key===accountKey);if(!account||canonicalJson(account)!==canonicalJson(initial.account))throw new PlatformDenied("BILLING_CONFIGURATION_ACCOUNT_CHANGED");
   if(configuration()!==initialConfiguration)throw new PlatformDenied("BILLING_CONFIGURATION_CHANGED");const result={snapshot,account,raw,checkedAt:Date.now()};await finishOperation(permit,"SUCCEEDED");return result;
  }));}catch(error){await finishOperation(permit,"FAILED");throw error;}
 }
 async inspectBillingConfiguration(ctx:OperationContext,accountKey:string,connectionId:string){
  const configuration=process.env.LUMIN_AGENCY_BILLING_COMPARISON_JSON,configurationIdentity=()=>JSON.stringify([process.env.LUMIN_AGENCY_BILLING_COMPARISON_JSON,process.env.LUMIN_AGENCY_META_BUSINESS_ID,process.env.LUMIN_AGENCY_TENANT_ID,process.env.LUMIN_AGENCY_INTERNAL_CLIENT_ID]),initialIdentity=configurationIdentity();
  let agency:Awaited<ReturnType<OwnershipEvidenceService["readBillingConfiguration"]>>|null=null;
  if(configuration){let binding:{clientId:string;accountKey:string;connectionId:string};try{binding=z.object({clientId:z.string().min(1).max(128),accountKey:z.string().min(1).max(200),connectionId:z.string().min(1).max(128)}).strict().parse(JSON.parse(configuration));}catch{throw new PlatformDenied("AGENCY_BILLING_COMPARISON_CONFIGURATION_INVALID");}
   if(binding.clientId!==process.env.LUMIN_AGENCY_INTERNAL_CLIENT_ID||ctx.principal.tenantId!==process.env.LUMIN_AGENCY_TENANT_ID)throw new PlatformDenied("AGENCY_BILLING_COMPARISON_SCOPE_INVALID");
   agency=await this.readBillingConfiguration({...ctx,clientId:binding.clientId,requestId:randomUUID()},binding.accountKey,binding.connectionId);
  }
  const client=await this.readBillingConfiguration(ctx,accountKey,connectionId);
  for(const observed of [agency,client]){if(!observed)continue;const scope=observed.snapshot,permit=await authorizeOperation(this.repo,{...ctx,clientId:scope.client.id,requestId:randomUUID()},{assets:[{type:"AD_ACCOUNT",id:observed.account.id}],classes:["READ"],capability:"legacy.ads_get_account_info",requiredScopes:["ads_read"],tokenTypes:["user","system_user"],parameters:{fields:BILLING_CONFIGURATION_FIELDS}},{writesEnabled:false,selectedConnectionId:scope.connection.id});
   try{await runWithExecutionPermit(permit,async()=>{await revalidateExecutionPermit(permit);const current=getExecutionScope().snapshot;if(canonicalJson(current.assets)!==canonicalJson(scope.assets)||canonicalJson(current.connection)!==canonicalJson(scope.connection)||canonicalJson(current.grants)!==canonicalJson(scope.grants)||canonicalJson(current.client)!==canonicalJson(scope.client)||canonicalJson(current.member)!==canonicalJson(scope.member))throw new PlatformDenied("BILLING_CONFIGURATION_AUTHORIZATION_CHANGED");});await finishOperation(permit,"SUCCEEDED");}catch(error){await finishOperation(permit,"FAILED");throw error;}
  }
  if(configurationIdentity()!==initialIdentity)throw new PlatformDenied("BILLING_CONFIGURATION_CHANGED");
  return billingConfigurationReport(client.snapshot,client.account,client.raw,Date.now(),agency);
 }
 async observe(ctx:OperationContext,accountKey:string,connectionId:string):Promise<{observationId:string;expiresAt:number}>{
  const initial=await this.human(ctx.principal,ctx.clientId,accountKey),attestation=initial.account.ownerBillingAttestationId?await this.repo.get("ownerBillingAttestations",ctx.principal.tenantId,initial.account.ownerBillingAttestationId):null;if(!attestation)throw new PlatformDenied("CLIENT_OWNER_BILLING_ATTESTATION_REQUIRED");validateOwnerAttestation(attestation);
  const permit=await authorizeOperation(this.repo,{...ctx,tool:"meta_observe_account_owner"},{assets:[{type:"AD_ACCOUNT",id:initial.account.id}],classes:["READ"],capability:"legacy.ads_get_account_info",requiredScopes:["ads_read"],tokenTypes:["user","system_user"],parameters:{fields:"id,account_id,business{id}"}},{writesEnabled:false,selectedConnectionId:connectionId});
  try{return await runWithExecutionPermit(permit,async()=>withConnectionCredential(permit,async token=>{
   await revalidateExecutionPermit(permit);assertLegacyMarketingReadEligibility();const scope=getExecutionScope(),bucket=createHash("sha256").update(JSON.stringify(["META_MARKETING",scope.snapshot.connection.appId,createHash("sha256").update(token).digest("hex")])).digest("hex");productRateController.bind(bucket,scope.snapshot.connection.appId);productRateController.check(bucket);
   let raw:unknown;try{const response=await this.fetcher(`https://graph.facebook.com/v26.0/act_${initial.account.id.replace(/^act_/,"")}?fields=id,account_id,business{id}`,{headers:{Authorization:`Bearer ${token}`},redirect:"error",signal:AbortSignal.timeout(15000)});productRateController.observe(bucket,response,null);if(!response.ok)throw new Error();raw=JSON.parse(await readBodyWithLimit(response,16384));}catch{throw new PlatformDenied("ACCOUNT_OWNER_PROVIDER_READ_FAILED");}
   const parsed=z.object({id:z.string(),account_id:z.string(),business:z.object({id:z.string()}).passthrough()}).passthrough().parse(raw),proof={id:parsed.id,account_id:parsed.account_id,business:{id:parsed.business.id}};
   await revalidateExecutionPermit(permit);assertLegacyMarketingReadEligibility();const s=getExecutionScope().snapshot,account=s.assets.find(a=>a.key===accountKey);if(!account||canonicalJson(account)!==canonicalJson(initial.account)||proof.business.id!==attestation.businessId||proof.account_id!==account.id.replace(/^act_/,"")||proof.id!==`act_${proof.account_id}`)throw new PlatformDenied("ACCOUNT_OWNER_CHANGED_OR_FOREIGN");
   const checkedAt=Date.now(),row:AccountOwnershipObservation={id:randomUUID(),tenantId:ctx.principal.tenantId,clientId:ctx.clientId,appId:account.appId,accountKey:account.key,accountId:proof.account_id,businessId:proof.business.id,actorId:ctx.principal.operatorId,connectionId:s.connection.id,attestationId:attestation.id,source:"META_AD_ACCOUNT_BUSINESS",sourceUrl:ACCOUNT_OWNERSHIP_SOURCE,checkedAt,expiresAt:Math.min(checkedAt+300000,attestation.expiresAt,s.connection.expiresAt??0,...s.grants.map(g=>g.expiresAt)),revokedAt:null,revision:1,encryptedProof:{iv:"",tag:"",ciphertext:""}};
   if(!/^[a-f0-9]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY??""))throw new PlatformDenied("OWNERSHIP_ENCRYPTION_REQUIRED");row.encryptedProof=encryptToken(canonicalJson(proof),ownershipObservationAad(row));
   const expected:ControlCommit["expected"]=[...initial.expected,{collection:"connections",id:s.connection.id,canonical:canonicalJson(s.connection)},...s.grants.map(g=>({collection:"grants" as const,id:g.id,canonical:canonicalJson(g)})),{collection:"ownerBillingAttestations",id:attestation.id,canonical:canonicalJson(attestation)}];
   await this.repo.commitControlPlane({tenantId:row.tenantId,expected,writes:[{collection:"accountOwnershipObservations",id:row.id,value:row,createOnly:true},{collection:"assets",id:account.key,value:ownershipAsset(account,attestation,row),createOnly:false}],audit:newOwnershipAudit(row,row.actorId,"ACCOUNT_OWNER_OBSERVED")});await finishOperation(permit,"SUCCEEDED");return {observationId:row.id,expiresAt:row.expiresAt};
  }));}catch(error){await finishOperation(permit,"FAILED");throw error;}
 }
}
