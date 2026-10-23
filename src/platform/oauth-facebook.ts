import {isCrmOAuthProfile,validateCrmOAuthProfile,crmOAuthRoots,proveCrmOAuth} from "./crm-oauth.js";
import {isSignalDatasetOAuthProfile,validateSignalDatasetOAuthProfile,signalDatasetOAuthRoots,proveSignalDatasetOAuth} from "./dataset-oauth.js";
import {isAppPromotionOAuthProfile,validateAppPromotionOAuthProfile,appPromotionOAuthRoots,proveAppPromotionOAuth} from "./app-promotion-oauth.js";
import {AUDIENCE_ESTIMATE_TOOL} from "./audience-estimate-contract.js";
import {INVOICE_METADATA_CAPABILITY,invoiceMetadataEnabled,invoiceProfileRootRefs,invoiceRegisteredScope,verifyInvoiceFinancePermission,verifyInvoiceAccountAccess} from './business-invoice-metadata.js';
import {LEGACY_TARGETING_TAXONOMY_TOOLS} from "./legacy-targeting-taxonomy.js";
import {clientBusinessBound,type ClientBusinessEvidence} from "./client-business.js";
import type {Client,PlatformPrincipal} from "./models.js";
import {MARKETING_STUDY_CAPABILITY,MARKETING_STUDY_CONTRACT} from "./marketing-study-contract.js";
import {studyRegisteredScope,verifyStudyBusinessAccess,studyProfileRootRefs} from "./marketing-study-proof.js";
import {verifyRegisteredAdVideo} from "./legacy-video-creative.js";
import {MARKETING_CONTROL_CAPABILITIES,marketingControlOAuthProof,usesRegisteredMarketingAdProof} from "./marketing-control-oauth-proof.js";
import type {MetaAsset} from "./models.js";
import {PRODUCT_CONTRACTS} from "./products/contracts.js";
import { z } from "zod";
import { readBodyWithLimit } from "../utils/bounded-body.js";
import { assertMetaApiVersion, resolveMetaApiVersion } from "../meta/api-version.js";
import { PlatformDenied, type AssetRef } from "./models.js";
import { validateConnectionProfile } from "./connection-profiles.js";
import { canonicalJson } from "./policy.js";
import type { InspectedOAuthToken, TrustedOAuthProfile, VerifiedProviderAdapter } from "./oauth.js";
import { LEGACY_CORE_READ_TOOLS } from "./legacy-read.js";
import { LEGACY_CORE_WRITE_TOOLS } from "./legacy-write.js";
import { expandVerifiedPermissionDependencies } from "./products/permission-dependencies.js";
import { logger } from "../utils/logger.js";

export const FACEBOOK_OAUTH_DOCUMENTATION=Object.freeze([
  "https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow",
  "https://developers.facebook.com/documentation/facebook-login/guides/access-tokens",
  "https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived",
  "https://www.postman.com/meta/whatsapp-business-platform/request/i1mz7w8/debug-token",
  "https://developers.facebook.com/docs/graph-api/reference/user/businesses/",
]);
const TOKEN=z.string().min(1).max(16384).regex(/^[^\s\x00-\x1f\x7f]+$/);
const ID=z.string().regex(/^\d{1,100}$/);
const SCOPE=z.string().regex(/^[a-z][a-z0-9_]{0,100}$/);
// Meta's Business Login token exchange has returned expiry metadata in more
// than one valid shape. Keep the response bounded and require a finite expiry
// later, but do not reject a valid exchange merely because one endpoint omits
// expires_in while /debug_token supplies expires_at or data_access_expires_at.
const tokenResponse=z.object({access_token:TOKEN,token_type:z.string().optional(),expires_in:z.number().int().positive().max(31536000).optional(),expires_at:z.number().int().nonnegative().max(Math.floor(Number.MAX_SAFE_INTEGER/1000)).optional(),data_access_expiration_time:z.number().int().nonnegative().max(Math.floor(Number.MAX_SAFE_INTEGER/1000)).optional()});
const debugResponse=z.object({data:z.object({app_id:z.union([ID,z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]),type:z.literal("USER"),user_id:ID,is_valid:z.literal(true),scopes:z.array(SCOPE).min(1).max(100),expires_at:z.number().int().positive().max(Math.floor(Number.MAX_SAFE_INTEGER/1000)),data_access_expires_at:z.number().int().nonnegative().max(Math.floor(Number.MAX_SAFE_INTEGER/1000)).optional()})});
const permissionResponse=z.object({data:z.array(z.object({permission:SCOPE,status:z.enum(["granted","declined","expired"])})).max(100),paging:z.object({next:z.unknown().optional()}).optional()});
const scopeKey=(scopes:string[])=>canonicalJson([...scopes].sort());
function parse<T>(schema:z.ZodType<T>,value:unknown):T{const parsed=schema.safeParse(value);if(!parsed.success)throw new PlatformDenied("FACEBOOK_OAUTH_RESPONSE_SCHEMA_INVALID");return parsed.data;}
interface FacebookAdapterOptions { fetcher?:typeof fetch; apiVersion?:string; now?:()=>number; timeoutMs?:number }

const facebookProviderErrorEnvelope=z.object({
  error:z.object({
    code:z.number().int().optional(),
    error_subcode:z.number().int().optional(),
    fbtrace_id:z.string().max(128).optional(),
  }).passthrough(),
});
function facebookProviderDenialReason(status:number,body:unknown):string{
  const parsed=facebookProviderErrorEnvelope.safeParse(body);
  const code=parsed.success?parsed.data.error.code:undefined;
  if(code===10||code===200)return "FACEBOOK_GRAPH_PERMISSION_DENIED";
  if(code===102||code===190||status===401)return "FACEBOOK_GRAPH_TOKEN_INVALID";
  return "FACEBOOK_OAUTH_PROVIDER_REJECTED";
}
function logFacebookProviderError(status:number,body:unknown,path:string):void{
  const parsed=facebookProviderErrorEnvelope.safeParse(body);
  if(!parsed.success){
    logger.warn({event:"facebook_graph_provider_error",status,path},"Meta Graph rejected an OAuth request without a safe error envelope");
    return;
  }
  const {code,error_subcode,fbtrace_id}=parsed.data.error;
  logger.warn({event:"facebook_graph_provider_error",status,path,code,subcode:error_subcode,fbtrace_id},"Meta Graph rejected an OAuth request");
}
export class FacebookBusinessOAuthAdapter implements VerifiedProviderAdapter {
  readonly verified:boolean;
  private readonly version:string;
  private readonly fetcher:typeof fetch;
  private readonly clock:()=>number;
  private readonly timeoutMs:number;
  constructor(readonly provider:"META_MARKETING"|"META_BUSINESS",options:FacebookAdapterOptions={}) {
    if(!["META_MARKETING","META_BUSINESS"].includes(provider))throw new PlatformDenied("FACEBOOK_PROVIDER_ADAPTER_UNVERIFIED_HOLD");
    this.version=assertMetaApiVersion(options.apiVersion??resolveMetaApiVersion());
    this.verified=this.version==="v26.0";
    this.fetcher=options.fetcher??fetch;this.clock=options.now??Date.now;this.timeoutMs=options.timeoutMs??15000;
    if(!Number.isSafeInteger(this.timeoutMs)||this.timeoutMs<1||this.timeoutMs>30000)throw new PlatformDenied("FACEBOOK_OAUTH_TIMEOUT_INVALID");
  }
  private now():number{const now=this.clock();if(!Number.isSafeInteger(now)||now<=0)throw new PlatformDenied("FACEBOOK_OAUTH_CLOCK_INVALID");return now;}
  private async get(path:string,parameters:Record<string,string>,bearer?:string):Promise<unknown>{
    const url=new URL(`/${this.version}${path}`,"https://graph.facebook.com");
    for(const [key,value] of Object.entries(parameters))url.searchParams.set(key,value);
    try {
      const response=await this.fetcher(url,{method:"GET",redirect:"error",signal:AbortSignal.timeout(this.timeoutMs),headers:{Accept:"application/json",...(bearer?{Authorization:`Bearer ${bearer}`}:{})}});
      const raw=await readBodyWithLimit(response,131072);
      let body:unknown;
      try { body=JSON.parse(raw); } catch {
        throw new PlatformDenied("FACEBOOK_OAUTH_PROVIDER_REJECTED");
      }
      if(!response.ok||!body||typeof body!=="object"||Array.isArray(body)||"error" in body){
        logFacebookProviderError(response.status,body,path);
        throw new PlatformDenied(facebookProviderDenialReason(response.status,body));
      }
      return body;
    } catch(error) {
      // Preserve deliberate provider classifications. The old catch block
      // converted permission denials into transport failures, making a real
      // Meta scope/app-access problem look like a network outage.
      if(error instanceof PlatformDenied)throw error;
      logger.warn({event:"facebook_oauth_transport_failure",path,error:error instanceof Error?error.name:"unknown"},"Meta OAuth provider request failed");
      throw new PlatformDenied("FACEBOOK_OAUTH_TRANSPORT_OR_RESPONSE_FAILED");
    }
  }
  validateProfile(profile:TrustedOAuthProfile):void {
    if(!this.verified)throw new PlatformDenied("FACEBOOK_OAUTH_VERSION_CONTRACT_UNVERIFIED_HOLD");
    validateConnectionProfile(profile);
    if(profile.derivedTokenScopes!==undefined)throw new PlatformDenied("FACEBOOK_USER_DERIVED_SCOPE_PROFILE_DENIED");
    if(profile.provider!==this.provider||profile.strategy!=="facebook_business"||profile.authorizeUrl!==`https://www.facebook.com/${this.version}/dialog/oauth`||profile.tokenTypes.length!==1||profile.tokenTypes[0]!=="user"||!ID.safeParse(profile.appId).success)throw new PlatformDenied("FACEBOOK_USER_PROFILE_REQUIRED");
    if(!profile.scopes.includes("public_profile"))throw new PlatformDenied("FACEBOOK_BASELINE_SCOPE_REQUIRED");
    if(profile.crmRootIds!==undefined&&!isCrmOAuthProfile(profile))throw new PlatformDenied("CRM_OAUTH_ROOTS_PROFILE_FORBIDDEN");
    if(isCrmOAuthProfile(profile)){validateCrmOAuthProfile(profile);return;}
    if(profile.datasetRootIds!==undefined&&!isSignalDatasetOAuthProfile(profile))throw new PlatformDenied("SIGNAL_DISCOVERY_PROFILE_ROOTS_REQUIRED");
    if(isSignalDatasetOAuthProfile(profile)){validateSignalDatasetOAuthProfile(profile);return;}
    if(profile.appPromotionBinding!==undefined&&!isAppPromotionOAuthProfile(profile))throw new PlatformDenied("APP_PROMOTION_BINDING_PROFILE_FORBIDDEN");
    if(isAppPromotionOAuthProfile(profile)){validateAppPromotionOAuthProfile(profile);return;}
    if(profile.invoiceRootIds!==undefined&&!(this.provider==='META_MARKETING'&&profile.capabilities.includes(INVOICE_METADATA_CAPABILITY)))throw new PlatformDenied('INVOICE_ROOTS_PROFILE_FORBIDDEN');
    if(this.provider==='META_MARKETING'&&profile.capabilities.includes(INVOICE_METADATA_CAPABILITY)){invoiceProfileRootRefs(profile.invoiceRootIds);const required=expandVerifiedPermissionDependencies(['public_profile','ads_read','business_management']);if(!invoiceMetadataEnabled()||profile.studyRootIds!==undefined||profile.marketingControlMode!==undefined||profile.requiredTasks.length||canonicalJson(profile.actions)!==canonicalJson(['READ'])||new Set(profile.capabilities).size!==profile.capabilities.length||profile.capabilities.some(cap=>![INVOICE_METADATA_CAPABILITY,'legacy.ads_get_account_info'].includes(cap))||scopeKey(profile.scopes)!==scopeKey(required))throw new PlatformDenied('FACEBOOK_INVOICE_READ_ONLY_PROFILE_REQUIRED');return;}
    if(profile.studyRootIds!==undefined&&!(this.provider==="META_MARKETING"&&profile.capabilities.includes(MARKETING_STUDY_CAPABILITY)))throw new PlatformDenied("STUDY_ROOTS_PROFILE_FORBIDDEN");
    if(this.provider==="META_MARKETING"&&profile.capabilities.includes(MARKETING_STUDY_CAPABILITY)){
      studyProfileRootRefs(profile.studyRootIds);const capabilities=[MARKETING_STUDY_CAPABILITY,"legacy.ads_get_account_info","legacy.ads_get_campaign_details"],required=expandVerifiedPermissionDependencies(["public_profile",...MARKETING_STUDY_CONTRACT.requiredScopes]);
      if(process.env.LUMIN_MARKETING_STUDIES_ENABLED!=="true"||profile.marketingControlMode!==undefined||profile.requiredTasks.length||canonicalJson([...profile.actions].sort())!==canonicalJson(["READ","WRITE_AD_CONFIGURATION"])||canonicalJson([...profile.capabilities].sort())!==canonicalJson([...capabilities].sort())||scopeKey(profile.scopes)!==scopeKey(required))throw new PlatformDenied("FACEBOOK_CLASSIC_STUDY_PROFILE_REQUIRED");return;
    }
    if(this.provider==="META_MARKETING") {
      const read=profile.actions.includes("READ"),write=profile.actions.includes("WRITE_AD_CONFIGURATION"),content=profile.actions.includes("WRITE_CONTENT");
      const readCapabilities=[`legacy.${AUDIENCE_ESTIMATE_TOOL}`,...LEGACY_TARGETING_TAXONOMY_TOOLS.map(tool=>`legacy.${tool}`),...LEGACY_CORE_READ_TOOLS.map(tool=>`legacy.${tool}`),"legacy.ads_search_geo_locations","legacy.ads_search_interests",...PRODUCT_CONTRACTS.filter(c=>c.provider==="META_MARKETING"&&["marketing_inspect_image","marketing_inspect_creative_image","marketing_inspect_video","marketing_inspect_creative_video","marketing_search_ad_library","marketing_get_ad_preview","catalog_get_campaign_input_diagnostics"].includes(c.tool)&&c.verified&&c.tokenTypes.includes("user")&&canonicalJson(c.operationClasses)===canonicalJson(["READ"])&&!c.requiredTasks?.length).map(c=>c.id)],legacyWriteCapabilities=LEGACY_CORE_WRITE_TOOLS.map(tool=>`legacy.${tool}`),audienceCapabilities=PRODUCT_CONTRACTS.filter(c=>c.provider==="META_MARKETING"&&c.verified&&["marketing_create_empty_custom_audience","marketing_create_lookalike_audience","marketing_create_purchase_conversion"].includes(c.tool)&&c.tokenTypes.includes("user")&&canonicalJson(c.operationClasses)===canonicalJson(["WRITE_AD_CONFIGURATION"])&&!c.requiredTasks?.length).map(c=>c.id),writeCapabilities=[...legacyWriteCapabilities,...audienceCapabilities];
      const contentContracts=PRODUCT_CONTRACTS.filter(c=>c.provider==="META_MARKETING"&&c.verified&&["marketing_upload_image","marketing_upload_video","marketing_create_async_report"].includes(c.tool)&&c.tokenTypes.includes("user")&&canonicalJson(c.operationClasses)===canonicalJson(["WRITE_CONTENT"])&&!c.requiredTasks?.length),contentCapabilities=contentContracts.map(c=>c.id);
      const controlContracts=PRODUCT_CONTRACTS.filter(c=>c.provider==="META_MARKETING"&&c.verified&&MARKETING_CONTROL_CAPABILITIES.includes(c.id as typeof MARKETING_CONTROL_CAPABILITIES[number])&&c.tokenTypes.includes("user")&&c.requiredTaskAssetType==="PAGE"&&canonicalJson(c.requiredTasks)===canonicalJson(["ADVERTISE"])),selectedControl=controlContracts.filter(c=>profile.capabilities.includes(c.id));
      if(profile.marketingControlMode&&!usesRegisteredMarketingAdProof(profile)||selectedControl.length&&!["TRAFFIC","INSTANT_FORM_LEADS"].includes(profile.marketingControlMode??""))throw new PlatformDenied("MARKETING_CONTROL_PROFILE_MODE_REQUIRED");
      if(usesRegisteredMarketingAdProof(profile)&&canonicalJson(profile.requiredTasks)!==canonicalJson(["ADVERTISE"]))throw new PlatformDenied("MARKETING_CONTROL_OAUTH_ADVERTISE_PROFILE_REQUIRED");
      if(!profile.actions.length||new Set(profile.actions).size!==profile.actions.length||profile.actions.some(action=>!["READ","WRITE_AD_CONFIGURATION","WRITE_BUDGET","WRITE_CONTENT",...selectedControl.flatMap(c=>c.operationClasses)].includes(action))||(profile.actions.includes("WRITE_BUDGET")&&(!write||!profile.capabilities.some(c=>legacyWriteCapabilities.includes(c))))||((profile.capabilities.some(c=>audienceCapabilities.includes(c))||selectedControl.length>0)&&!read)||!profile.capabilities.length||new Set(profile.capabilities).size!==profile.capabilities.length||profile.capabilities.some(capability=>!((read&&readCapabilities.includes(capability))||(write&&writeCapabilities.includes(capability))||(content&&contentCapabilities.includes(capability))||selectedControl.some(c=>c.id===capability&&c.operationClasses.every(action=>profile.actions.includes(action)))))|| (write&&!profile.capabilities.some(capability=>writeCapabilities.includes(capability))) || (read&&!profile.capabilities.some(capability=>readCapabilities.includes(capability))) || (profile.actions.some(action=>["ACTIVATE_SPEND","DELETE"].includes(action)&&!selectedControl.some(c=>c.operationClasses.includes(action)))) || (content&&!read) || (content&&!profile.capabilities.some(capability=>contentCapabilities.includes(capability))))throw new PlatformDenied("FACEBOOK_MARKETING_PROFILE_PRIVILEGE_EXPANSION_HOLD");
      const selectedContent=contentContracts.filter(c=>profile.capabilities.includes(c.id));
      const required=expandVerifiedPermissionDependencies(["public_profile",...(read?["ads_read"]:[]),...(write?["ads_management"]:[]),...selectedContent.flatMap(c=>c.requiredScopes),...selectedControl.flatMap(c=>c.requiredScopes),...(profile.marketingControlMode==="INSTANT_FORM_LEADS"?["pages_manage_ads"]:[])]);
      if(scopeKey(profile.scopes)!==scopeKey(required))throw new PlatformDenied("FACEBOOK_INCREMENTAL_SCOPE_PROFILE_REQUIRED");
      // Enrollment proves token consent and account identity only. No manage-role,
      // billing ownership, app access tier or mutation eligibility is inferred.
    } else {
      if(!profile.scopes.includes("business_management"))throw new PlatformDenied("FACEBOOK_BASELINE_SCOPE_REQUIRED");
      if(!profile.actions.length||profile.actions.some(action=>action!=="READ"))throw new PlatformDenied("FACEBOOK_WRITE_ASSET_TASK_PROOF_UNVERIFIED_HOLD");
      const selected=profile.capabilities.map(id=>PRODUCT_CONTRACTS.find(c=>c.id===id&&c.provider==="META_BUSINESS"&&c.verified&&c.operationClasses.every(action=>action==="READ")&&c.tokenTypes.includes("user")&&!c.requiredTasks?.length));
      if(!selected.length||selected.some(c=>!c)||new Set(profile.capabilities).size!==profile.capabilities.length)throw new PlatformDenied("FACEBOOK_VERIFIED_BUSINESS_READ_CAPABILITIES_REQUIRED");
      if(scopeKey(profile.scopes)!==scopeKey(expandVerifiedPermissionDependencies(["public_profile","business_management",...selected.flatMap(c=>c!.requiredScopes)])))throw new PlatformDenied("FACEBOOK_INCREMENTAL_SCOPE_PROFILE_REQUIRED");
    }
    if(profile.requiredTasks.length&&!(this.provider==="META_MARKETING"&&usesRegisteredMarketingAdProof(profile)&&canonicalJson(profile.requiredTasks)===canonicalJson(["ADVERTISE"])))throw new PlatformDenied("FACEBOOK_USER_TASK_INSPECTION_UNVERIFIED_HOLD");
  }
  validateEnrollmentContext(input:{profile:TrustedOAuthProfile;principal:PlatformPrincipal;clientId:string;client:Client;businessOwnerEvidence?:ClientBusinessEvidence}):void{if(isCrmOAuthProfile(input.profile)&&input.profile.crmRootIds?.businessId){if(input.client.id!==input.clientId||input.client.tenantId!==input.principal.tenantId||!clientBusinessBound(input.client,input.profile.crmRootIds.businessId,this.now(),input.businessOwnerEvidence,input.profile.appId))throw new PlatformDenied("CRM_CLIENT_BUSINESS_BINDING_REQUIRED");return;}if(isSignalDatasetOAuthProfile(input.profile)){const roots=input.profile.datasetRootIds!;if(input.client.id!==input.clientId||input.client.tenantId!==input.principal.tenantId||!clientBusinessBound(input.client,roots.businessId,this.now(),input.businessOwnerEvidence,input.profile.appId))throw new PlatformDenied("SIGNAL_DISCOVERY_CLIENT_BUSINESS_BINDING_REQUIRED");return;}if(isAppPromotionOAuthProfile(input.profile)){const b=input.profile.appPromotionBinding!;if(b.tenantId!==input.principal.tenantId||b.clientId!==input.clientId||input.client.id!==input.clientId||input.client.tenantId!==b.tenantId)throw new PlatformDenied("APP_PROMOTION_CLIENT_PROFILE_REQUIRED");return;}if(this.provider==='META_MARKETING'&&input.profile.capabilities.includes(INVOICE_METADATA_CAPABILITY)){const refs=invoiceProfileRootRefs(input.profile.invoiceRootIds),business=refs.find(r=>r.type==='BUSINESS')!;if(input.client.id!==input.clientId||input.client.tenantId!==input.principal.tenantId||!clientBusinessBound(input.client,business.id,this.now(),input.businessOwnerEvidence,input.profile.appId))throw new PlatformDenied('INVOICE_CLIENT_BUSINESS_BINDING_REQUIRED');return;}if(this.provider!=="META_MARKETING"||!input.profile.capabilities.includes(MARKETING_STUDY_CAPABILITY))return;const refs=studyProfileRootRefs(input.profile.studyRootIds),business=refs.find(r=>r.type==="BUSINESS")!;if(input.client.id!==input.clientId||input.client.tenantId!==input.principal.tenantId||!clientBusinessBound(input.client,business.id,this.now(),input.businessOwnerEvidence,input.profile.appId))throw new PlatformDenied("CLASSIC_STUDY_CLIENT_BUSINESS_BINDING_REQUIRED");}
  private validate(profile:TrustedOAuthProfile,appSecret:string,requested:AssetRef[],code:string,registeredAssets?:MetaAsset[]):void {
    this.validateProfile(profile);
    if(!TOKEN.safeParse(appSecret).success||!code||code.length>4096||/[\s\x00-\x1f\x7f]/.test(code))throw new PlatformDenied("FACEBOOK_OAUTH_INPUT_INVALID");
    if(isCrmOAuthProfile(profile)){const roots=crmOAuthRoots(profile,registeredAssets??[],this.now());if(requested.length!==roots.length||requested.some(ref=>!roots.some(a=>a.type===ref.type&&a.id.replace(/^act_/,"")===ref.id.replace(/^act_/,""))))throw new PlatformDenied("CRM_EXACT_OAUTH_ROOTS_REQUIRED");return;}
    if(isSignalDatasetOAuthProfile(profile)){const roots=signalDatasetOAuthRoots(profile,registeredAssets??[],this.now());if(requested.length!==roots.length||requested.some(ref=>!roots.some(a=>a.type===ref.type&&a.id.replace(/^act_/,"")===ref.id.replace(/^act_/,""))))throw new PlatformDenied("SIGNAL_DISCOVERY_EXACT_OAUTH_ROOTS_REQUIRED");return;}
    if(isAppPromotionOAuthProfile(profile)){const roots=appPromotionOAuthRoots(profile,registeredAssets??[],this.now());if(requested.length!==2||requested.some(ref=>!roots.some(a=>a.type===ref.type&&a.id.replace(/^act_/,"")===ref.id.replace(/^act_/,""))))throw new PlatformDenied("APP_PROMOTION_EXACT_OAUTH_ROOTS_REQUIRED");return;}
    if(this.provider==='META_MARKETING'&&profile.capabilities.includes(INVOICE_METADATA_CAPABILITY)){const roots=invoiceProfileRootRefs(profile.invoiceRootIds);if(canonicalJson(requested.map(r=>({type:r.type,id:r.id.replace(/^act_/,'' )})).sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b))))!==canonicalJson(roots.sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b)))))throw new PlatformDenied('INVOICE_PROFILE_ROOT_BINDING_REQUIRED');invoiceRegisteredScope(registeredAssets??[],requested,this.now());return;}
    if(this.provider==="META_MARKETING"&&profile.capabilities.includes(MARKETING_STUDY_CAPABILITY)){const roots=studyProfileRootRefs(profile.studyRootIds);if(canonicalJson(requested.map(r=>({type:r.type,id:r.id.replace(/^act_/,"")})).sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b))))!==canonicalJson(roots.sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b)))))throw new PlatformDenied("CLASSIC_STUDY_PROFILE_ROOT_BINDING_REQUIRED");studyRegisteredScope(registeredAssets??[],requested,this.now());return;}
    if(this.provider==="META_MARKETING"&&usesRegisteredMarketingAdProof(profile)){const proof=marketingControlOAuthProof(registeredAssets??[],this.now());if(profile.marketingControlMode==="TRAFFIC"?proof.forms.length!==0:proof.forms.length!==1)throw new PlatformDenied("MARKETING_CONTROL_OAUTH_MODE_RELATIONSHIP_MISMATCH");if(requested.length!==proof.assets.length||requested.some(a=>!proof.assets.some(row=>row.type===a.type&&row.id.replace(/^act_/,"")===a.id.replace(/^act_/,""))))throw new PlatformDenied("MARKETING_CONTROL_OAUTH_EXACT_ROOT_PAIR_REQUIRED");return;}
    const type=this.provider==="META_MARKETING"?"AD_ACCOUNT":"BUSINESS";
    if(!requested.length||requested.length>98||requested.some(a=>a.type!==type||! /^(?:act_)?\d{1,100}$/.test(a.id)||(a.type!=="AD_ACCOUNT"&&a.id.startsWith("act_")))||new Set(requested.map(a=>a.id.replace(/^act_/,""))).size!==requested.length)throw new PlatformDenied("FACEBOOK_REGISTERED_ROOT_TYPE_REQUIRED");
  }
  private async proveControlAssets(token:string,registered:MetaAsset[],mode:TrustedOAuthProfile["marketingControlMode"]):Promise<InspectedOAuthToken["assets"]>{
    const p=marketingControlOAuthProof(registered,this.now()),accountId=p.account.id.replace(/^act_/,""),ad=parse(z.object({id:ID,account_id:ID,adset_id:ID,campaign_id:ID,creative:z.object({id:ID})}),await this.get("/"+p.ad.id,{fields:"id,account_id,adset_id,campaign_id,creative{id}"},token)),creativeRaw=parse(z.object({id:ID,account_id:ID,object_story_spec:z.object({page_id:ID,link_data:z.object({image_hash:z.string(),call_to_action:z.object({value:z.object({lead_gen_form_id:ID.optional()})})}).optional(),video_data:z.object({video_id:ID,image_hash:z.string(),call_to_action:z.object({value:z.object({lead_gen_form_id:ID.optional()})})}).optional()})}),await this.get("/"+p.creative.id,{fields:"id,account_id,object_story_spec"},token));
    const story=creativeRaw.object_story_spec;if((story.link_data?1:0)+(story.video_data?1:0)!==1||p.videos.length!==(story.video_data?1:0)||story.video_data&&story.video_data.video_id!==p.videos[0].id)throw new PlatformDenied("MARKETING_CONTROL_OAUTH_VIDEO_CLOSURE_REQUIRED");const creative={...creativeRaw,object_story_spec:{page_id:story.page_id,link_data:(story.link_data??story.video_data)!}};if(p.videos.length)verifyRegisteredAdVideo({assets:p.assets.map(a=>({type:a.type,id:a.id}))} as Parameters<typeof verifyRegisteredAdVideo>[0],p.assets,await this.get("/act_"+accountId+"/advideos",{fields:"id",limit:"100"},token),await this.get("/"+p.videos[0].id,{fields:"id,status{video_status,processing_progress}"},token));
    const row=z.object({id:ID,tasks:z.array(z.string())}),rows=parse(z.object({data:z.array(row).max(100),paging:z.object({next:z.string().optional()}).optional()}),await this.get("/me/accounts",{ad_id:p.ad.id,fields:"id,tasks",limit:"100"},token));
    if(ad.id!==p.ad.id||ad.account_id!==accountId||ad.adset_id!==p.adset.id||ad.campaign_id!==p.campaign.id||ad.creative.id!==p.creative.id||creative.id!==p.creative.id||creative.account_id!==accountId||creative.object_story_spec.page_id!==p.page.id||creative.object_story_spec.link_data.image_hash!==p.image.id||rows.paging?.next||rows.data.filter(row=>row.id===p.page.id&&row.tasks.includes("ADVERTISE")).length!==1)throw new PlatformDenied("MARKETING_CONTROL_OAUTH_CURRENT_AD_PAGE_TASK_REQUIRED");
    const targeting=z.object({custom_audiences:z.array(z.object({id:ID})).optional(),excluded_custom_audiences:z.array(z.object({id:ID})).optional()}),set=parse(z.object({id:ID,account_id:ID,campaign_id:ID,destination_type:z.string(),optimization_goal:z.string(),targeting:targeting}),await this.get("/"+p.adset.id,{fields:"id,account_id,campaign_id,destination_type,optimization_goal,targeting"},token)),campaign=parse(z.object({id:ID,account_id:ID}),await this.get("/"+p.campaign.id,{fields:"id,account_id"},token)),account=parse(z.object({id:z.string(),account_id:ID}),await this.get("/act_"+accountId,{fields:"id,account_id"},token));
    if(set.id!==p.adset.id||set.account_id!==accountId||set.campaign_id!==p.campaign.id||campaign.id!==p.campaign.id||campaign.account_id!==accountId||account.id!=="act_"+accountId||account.account_id!==accountId||(mode==="TRAFFIC"?set.destination_type!=="WEBSITE"||set.optimization_goal!=="LINK_CLICKS"||p.forms.length>0:set.destination_type!=="ON_AD"||set.optimization_goal!=="LEAD_GENERATION"||p.forms.length!==1))throw new PlatformDenied("MARKETING_CONTROL_OAUTH_CURRENT_PARENT_MODE_REQUIRED");
    const ids=[...(set.targeting.custom_audiences??[]),...(set.targeting.excluded_custom_audiences??[])].map(a=>a.id);if(new Set(ids).size!==ids.length||ids.length!==p.audiences.length||ids.some(id=>!p.audiences.some(a=>a.id===id)))throw new PlatformDenied("MARKETING_CONTROL_OAUTH_CURRENT_AUDIENCE_REFERENCES_REQUIRED");
    const images=parse(z.object({data:z.array(z.object({hash:z.string(),account_id:ID})).max(100),paging:z.object({next:z.string().optional()}).optional()}),await this.get("/act_"+accountId+"/adimages",{fields:"hash,account_id",limit:"100"},token));if(images.paging?.next||images.data.filter(image=>image.hash===p.image.id&&image.account_id===accountId).length!==1)throw new PlatformDenied("MARKETING_CONTROL_OAUTH_CURRENT_IMAGE_REQUIRED");
    if(p.forms.length){const forms=parse(z.object({data:z.array(z.object({id:ID,status:z.string()})).max(100),paging:z.object({next:z.string().optional()}).optional()}),await this.get("/"+p.page.id+"/leadgen_forms",{fields:"id,status",limit:"100"},token));if(forms.paging?.next||creative.object_story_spec.link_data.call_to_action.value.lead_gen_form_id!==p.forms[0].id||forms.data.filter(form=>form.id===p.forms[0].id&&form.status==="ACTIVE").length!==1)throw new PlatformDenied("MARKETING_CONTROL_OAUTH_CURRENT_FORM_REQUIRED");}else if(creative.object_story_spec.link_data.call_to_action.value.lead_gen_form_id!==undefined)throw new PlatformDenied("MARKETING_CONTROL_OAUTH_CURRENT_FORM_REQUIRED");
    for(const audience of p.audiences){const actual=parse(z.object({id:ID,account_id:ID,operation_status:z.object({code:z.literal(200)}),delivery_status:z.object({code:z.literal(200)})}),await this.get("/"+audience.id,{fields:"id,account_id,operation_status,delivery_status"},token));if(actual.id!==audience.id||actual.account_id!==accountId)throw new PlatformDenied("MARKETING_CONTROL_OAUTH_CURRENT_AUDIENCE_REQUIRED");}
    return p.assets.map(asset=>({type:asset.type,id:asset.type==="AD_ACCOUNT"?accountId:asset.id,tasks:asset.type==="PAGE"?["ADVERTISE"]:[]}));
  }
  private async proveAssets(token:string,requested:AssetRef[],registeredAssets?:MetaAsset[],mode?:TrustedOAuthProfile["marketingControlMode"],invoice=false):Promise<InspectedOAuthToken["assets"]> {
    if(this.provider==="META_MARKETING") {
      if(invoice){const selected=invoiceRegisteredScope(registeredAssets??[],requested,this.now()),businessId=selected.business.id,accountIds=selected.accounts.map(a=>a.id.replace(/^act_/,''));verifyInvoiceFinancePermission(await this.get('/me/business_users',{fields:'id,business{id},finance_permission',limit:'100'},token),businessId);const businesses=await this.get('/me/businesses',{fields:'id',limit:'100'},token),ownedAccounts=await this.get('/'+businessId+'/owned_ad_accounts',{fields:'id,account_id',limit:'100'},token),accounts=[];for(const id of accountIds)accounts.push(await this.get('/act_'+id,{fields:'id,account_id,business{id}'},token));verifyInvoiceAccountAccess({businesses,ownedAccounts,accounts},businessId,accountIds);return requested.map(a=>({type:a.type,id:a.id.replace(/^act_/,''),tasks:[]}));}
      if(requested.some(a=>a.type==="BUSINESS")){const selected=studyRegisteredScope(registeredAssets??[],requested,this.now()),businessId=selected.business.id,accountId=selected.account.id.replace(/^act_/,""),campaignIds=selected.campaigns.map(c=>c.id),businesses=await this.get("/me/businesses",{fields:"id",limit:"100"},token),ownedAccounts=await this.get("/"+businessId+"/owned_ad_accounts",{fields:"id,account_id",limit:"100"},token),account=await this.get("/act_"+accountId,{fields:"id,account_id,business{id},user_tasks"},token),campaigns=[];for(const id of campaignIds)campaigns.push(await this.get("/"+id,{fields:"id,account_id,status"},token));verifyStudyBusinessAccess(businessId,accountId,{businesses,ownedAccounts,account,campaigns},campaignIds);return requested.map(a=>({type:a.type,id:a.id.replace(/^act_/,""),tasks:[]}));}
      if(requested.some(a=>a.type==="PAGE"))return this.proveControlAssets(token,registeredAssets??[],mode);
      const result:InspectedOAuthToken["assets"]=[];
      for(const asset of requested){
        const id=asset.id.replace(/^act_/,"");
        const object=parse(z.object({id:z.string().regex(/^act_\d{1,100}$/),account_id:ID}),await this.get(`/act_${id}`,{fields:"id,account_id"},token));
        if(object.id!==`act_${id}`||object.account_id!==id)throw new PlatformDenied("FACEBOOK_ASSET_READ_PROOF_MISMATCH");
        result.push({type:"AD_ACCOUNT",id,tasks:[]});
      }
      return result;
    }
    const found=new Set<string>();let after:string|undefined;
    for(let page=0;page<5;page++){
      const body=parse(z.object({data:z.array(z.object({id:ID})).max(100),paging:z.object({next:z.unknown().optional(),cursors:z.object({after:z.string().max(2048).optional()}).optional()}).optional()}),await this.get("/me/businesses",{fields:"id",limit:"100",...(after?{after}:{})},token));
      for(const business of body.data)if(requested.some(a=>a.id===business.id))found.add(business.id);
      if(found.size===requested.length)return requested.map(a=>({...a,tasks:[]}));
      if(!body.paging?.next)break;
      const cursor=body.paging.cursors?.after;
      if(!cursor||cursor===after||! /^[A-Za-z0-9._~+\/=\-]{1,2048}$/.test(cursor))throw new PlatformDenied("FACEBOOK_ASSET_PROOF_CURSOR_INVALID");after=cursor;
    }
    throw new PlatformDenied("FACEBOOK_BUSINESS_MEMBERSHIP_PROOF_REQUIRED");
  }
  async exchangeAndInspect(input:{code:string;profile:TrustedOAuthProfile;appSecret:string;requestedAssets:AssetRef[];registeredAssets?:MetaAsset[]}):Promise<InspectedOAuthToken> {
    this.validate(input.profile,input.appSecret,input.requestedAssets,input.code,input.registeredAssets);
    const {profile,appSecret}=input;
    const issuedAt=this.now();
    // Current manual-flow contract requires GET query credentials. These URLs
    // stay server-side and are never logged or attached to thrown errors.
    const short=parse(tokenResponse,await this.get("/oauth/access_token",{client_id:profile.appId,client_secret:appSecret,redirect_uri:profile.redirectUri,code:input.code}));
    if(short.token_type&&short.token_type.toLowerCase()!=="bearer")throw new PlatformDenied("FACEBOOK_TOKEN_TYPE_MISMATCH");
    const long=parse(tokenResponse,await this.get("/oauth/access_token",{grant_type:"fb_exchange_token",client_id:profile.appId,client_secret:appSecret,fb_exchange_token:short.access_token}));
    if(long.token_type&&long.token_type.toLowerCase()!=="bearer")throw new PlatformDenied("FACEBOOK_TOKEN_TYPE_MISMATCH");
    const token=long.access_token;
    const debug=parse(debugResponse,await this.get("/debug_token",{input_token:token},`${profile.appId}|${appSecret}`)).data;
    if(String(debug.app_id)!==profile.appId||new Set(debug.scopes).size!==debug.scopes.length||scopeKey(debug.scopes)!==scopeKey(profile.scopes))throw new PlatformDenied("FACEBOOK_ACTUAL_APP_AND_SCOPES_REQUIRED");
    const inspectedAt=this.now();
    const expiryCandidates=[
      ...(short.expires_in!==undefined?[issuedAt+short.expires_in*1000]:[]),
      ...(long.expires_in!==undefined?[issuedAt+long.expires_in*1000]:[]),
      ...(short.expires_at!==undefined&&short.expires_at>0?[short.expires_at*1000]:[]),
      ...(long.expires_at!==undefined&&long.expires_at>0?[long.expires_at*1000]:[]),
      ...(short.data_access_expiration_time!==undefined&&short.data_access_expiration_time>0?[short.data_access_expiration_time*1000]:[]),
      ...(long.data_access_expiration_time!==undefined&&long.data_access_expiration_time>0?[long.data_access_expiration_time*1000]:[]),
      ...(debug.expires_at>0?[debug.expires_at*1000]:[]),
      ...(debug.data_access_expires_at!==undefined&&debug.data_access_expires_at>0?[debug.data_access_expires_at*1000]:[]),
    ].filter(Number.isSafeInteger);
    const expiry=expiryCandidates.length?Math.min(...expiryCandidates):0;
    if(!Number.isSafeInteger(expiry)||expiry<=inspectedAt)throw new PlatformDenied("FACEBOOK_TOKEN_EXPIRY_REQUIRED");
    const me=parse(z.object({id:ID}),await this.get("/me",{fields:"id"},token));
    if(me.id!==debug.user_id)throw new PlatformDenied("FACEBOOK_ACTUAL_USER_SUBJECT_REQUIRED");
    const permissions=parse(permissionResponse,await this.get("/me/permissions",{},token));
    if(permissions.paging?.next||new Set(permissions.data.map(p=>p.permission)).size!==permissions.data.length)throw new PlatformDenied("FACEBOOK_PERMISSION_INSPECTION_INCOMPLETE");
    const granted=permissions.data.filter(p=>p.status==="granted").map(p=>p.permission);
    if(scopeKey(granted)!==scopeKey(debug.scopes))throw new PlatformDenied("FACEBOOK_ACTUAL_GRANTED_PERMISSIONS_REQUIRED");
    const assets=isCrmOAuthProfile(input.profile)?await proveCrmOAuth(input.profile,crmOAuthRoots(input.profile,input.registeredAssets??[],this.now()),(path,query)=>this.get(path,query,token)):isSignalDatasetOAuthProfile(input.profile)?await proveSignalDatasetOAuth(input.profile,(path,query)=>this.get(path,query,token)):isAppPromotionOAuthProfile(input.profile)?await proveAppPromotionOAuth(input.profile,(path,query)=>this.get(path,query,token)):await this.proveAssets(token,input.requestedAssets,input.registeredAssets,input.profile.marketingControlMode,input.profile.capabilities.includes(INVOICE_METADATA_CAPABILITY));
    if(this.now()>=expiry)throw new PlatformDenied("FACEBOOK_TOKEN_EXPIRED");
    return {accessToken:token,provider:this.provider,appId:profile.appId,subjectId:me.id,tokenType:"user",grantedScopes:granted,expiresAt:expiry,assets};
  }

}
