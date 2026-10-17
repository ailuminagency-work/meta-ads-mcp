import {IMAGE_INSPECTION_TOOLS,IMAGE_INSPECTION_FIELDS,CREATIVE_IMAGE_INSPECTION_FIELDS} from "./image-inspection-contract.js";
import {APP_EVENT_TYPES_TOOL} from "./app-event-types-contract.js";
import {VIDEO_INSPECTION_TOOL,VIDEO_INSPECTION_FIELDS,CREATIVE_VIDEO_INSPECTION_TOOL,CREATIVE_VIDEO_INSPECTION_FIELDS} from "./video-inspection-contract.js";
import {CATALOG_CAMPAIGN_TOOL,CATALOG_CAMPAIGN_FIELDS,CATALOG_CAMPAIGN_GROUP_FIELDS} from "./catalog-campaign-contract.js";
import {INVOICE_METADATA_TOOL,invoiceMetadataQuery} from "./business-invoice-metadata.js";
import {CRM_SIGNAL_TOOL} from "./crm-contract.js";
import {CATALOG_OPERATIONAL_TOOLS} from "./catalog-operational-contracts.js";
import {PAGE_COMMENT_READ_TOOL} from "./page-comment-read-contract.js";
import {MARKETING_PREVIEW_TOOL} from "./marketing-preview-contract.js";
import {PURCHASE_CONVERSION_TOOL,purchaseConversionBody} from "./purchase-conversion-contract.js";
import {DATASET_READ_TOOL,DATASET_READ_FIELDS} from "./dataset-read-contract.js";
import {MARKETING_STUDY_TOOL,marketingStudyBody} from "./marketing-study-contract.js";
import {MARKETING_RULE_TOOL,marketingRuleBody} from "./marketing-rule-contract.js";
import {MARKETING_REPORT_TOOL,MARKETING_REPORT_FIELDS} from "./marketing-report-contracts.js";
import {WHATSAPP_QR_TOOLS} from "./whatsapp-qr-contracts.js";
import {PAGE_REPLY_TOOL,PAGE_REPLY_PREFLIGHT,resolvePageReplyContext,assertPageReplyComment,assertPageReplyPost,assertPageReplyMembership} from './page-comment-reply.js';
import {MARKETING_CONTROL_TOOLS} from './marketing-control-contracts.js';
import {AD_LIBRARY_TOOL,AD_LIBRARY_FIELDS} from "./ad-library-contract.js";
import {MARKETING_VIDEO_TOOL} from "./marketing-video-contract.js";
import {MARKETING_AUDIENCE_TOOLS} from "./marketing-audience-contracts.js";
import {MESSENGER_UTILITY_TOOLS,MESSENGER_UTILITY_TRANSPORT} from "./messenger-utility-contracts.js";
import {MESSENGER_ATTACHMENT_TOOLS} from "./messaging-attachment-contracts.js";
import {INSTAGRAM_STORY_TOOLS,INSTAGRAM_STORY_PREFLIGHT,assertInstagramStoryAccountType} from "./instagram-story-eligibility.js";
import {INSTAGRAM_IMAGE_VARIANT_TOOLS,instagramImageVariantBody} from "./instagram-image-variants.js";
import {assertWhatsAppOwnerOperational} from "./whatsapp-operational-policy.js";
import {THREADS_IMAGE_TOOLS,threadsImageBody} from "./threads-image-contracts.js";
import {assertManualEligibilityAttestation,type ManualEligibilityEvidence} from "./manual-eligibility.js";
import {INSTAGRAM_CAROUSEL_TOOLS,instagramCarouselBody} from "./instagram-carousel-contracts.js";
import {THREADS_CAROUSEL_TOOLS,threadsCarouselBody} from "./threads-carousel-contracts.js";
import {THREADS_VIDEO_TOOLS,threadsVideoBody} from "./threads-video-contracts.js";
import {MARKETING_IMAGE_TOOL} from "./marketing-image-contract.js";
import {INSTAGRAM_VIDEO_TOOLS,instagramVideoBody} from "./instagram-video-contracts.js";
import {MESSAGING_IMAGE_TOOLS,messagingImageBody} from "./messaging-image.js";
import {LEAD_FORM_TOOL} from "./lead-form-contract.js";
import {WHATSAPP_SEND_TOOLS} from "./whatsapp-send-contracts.js";
import {OFFLINE_QUALITY_TOOL} from "./offline-quality-contract.js";
import {MESSENGER_TYPED_TOOLS,messengerTypedFixedBody,messengerTypedBody,normalizeMessengerTypedReceipt} from "./messenger-typed.js";
import {assertOfflinePixelConsolidation} from "./offline-signal.js";
import {OEMBED_TOOLS} from "./oembed-contracts.js";
import {readProductUsage,productUsageDelay} from "./product-rate-usage.js";
import {CATALOG_ASSIGNED_USERS_QUERY,catalogAssignedBusiness,normalizeCatalogAssignedUsers} from "./catalog-assigned-users.js";
import {INSTAGRAM_MENTION_TOOLS,INSTAGRAM_MENTION_QUERY,instagramMentionFields,normalizeInstagramMention} from "./instagram-mentions.js";
import {WHATSAPP_ANALYTICS_TOOLS} from "./whatsapp-analytics-contracts.js";
import {THREADS_DISCOVERY_TOOLS,THREADS_DISCOVERY_QUERY} from "./threads-discovery-contracts.js";
import {INSTAGRAM_HASHTAG_QUERY} from "./instagram-hashtag-contract.js";
import {INSTAGRAM_BUSINESS_DISCOVERY_QUERY,instagramBusinessDiscoveryFields,normalizeInstagramBusinessDiscovery} from "./instagram-business-discovery.js";
import {normalizePageInsights} from "./page-insights.js";
import {normalizeInstagramInsights,INSTAGRAM_MEDIA_INSIGHTS_TOOLS} from "./instagram-insights.js";
import {normalizePagePhotoReceipt} from "./page-photo.js";
import {PAGE_POST_EDIT_PREFLIGHT,assertPagePostEditAsset,assertPagePostEditResponse} from "./page-post-edit.js";
import {INSTAGRAM_COMMENT_TOOLS,INSTAGRAM_COMMENT_PREFLIGHT,resolveInstagramCommentContext,assertInstagramCommentMedia,assertInstagramCommentState,normalizeInstagramCommentResponse} from "./instagram-comments.js";
import {WHATSAPP_PHONE_TOOLS} from "./whatsapp-phone-contracts.js";
import {WHATSAPP_TEMPLATE_TOOLS} from "./whatsapp-template-contracts.js";
import {normalizeLeadReadResponse,reviewedLeadStringArray} from "./lead-read.js";
import {WHATSAPP_SUBSCRIPTION_TOOLS} from "./whatsapp-subscription-contracts.js";
import {WHATSAPP_FLOW_TOOLS} from "./whatsapp-flow-contracts.js";
import {normalizeThreadsInsights} from "./threads-insights.js";
import {applyProductTaskRequirements} from "./product-task-requirements.js";
import {validateProductInput,assertProductAssetRelationships,assertProductClientOwnership} from "./product-inputs.js";
import {normalizeProductResponse} from "./product-private-response.js";
import { assertThreadsPublicationQuota, THREADS_PUBLICATION_PREFLIGHT, requiresThreadsPublicationQuota } from "./threads-quota.js";
import { assertInstagramPublicationQuota, INSTAGRAM_PUBLICATION_PREFLIGHT, requiresInstagramPublicationQuota } from "./instagram-quota.js";
import { assertNoCredentialShapedString } from "./input-safety.js";
import { createHash } from "node:crypto";
import type { Connection, Provider } from "./models.js";
import { PlatformDenied } from "./models.js";
import { assertExecutionPermit, claimMutationStep, getExecutionScope, revalidateExecutionPermit, withConnectionCredential } from "./execution.js";
import { canonicalJson, classifyPlan } from "./policy.js";
import { readBodyWithLimit } from "../utils/bounded-body.js";
import { unsafeIpReason } from "../utils/url-guard.js";
import { assertPreparedSignal, revalidatePreparedSignal, type PreparedSignal } from "./signals.js";
import type { MessagingExecution, MessagingRequest } from "./messaging-policy.js";
import type { ProductContract } from "./products/contracts.js";
import {productVersion} from "./product-version.js";
export {productVersion} from "./product-version.js";

const HOSTS: Record<Provider, string> = {
  META_MARKETING: "https://graph.facebook.com", META_FACEBOOK_PAGES: "https://graph.facebook.com",
  META_INSTAGRAM_FACEBOOK_LOGIN: "https://graph.facebook.com", META_INSTAGRAM_LOGIN: "https://graph.instagram.com",
  META_MESSENGER: "https://graph.facebook.com", META_WHATSAPP: "https://graph.facebook.com",
  META_THREADS: "https://graph.threads.com", META_BUSINESS: "https://graph.facebook.com",
};
export class ProductApiError extends Error {
  constructor(readonly provider: Provider, readonly status: number, readonly code: number | null, readonly requestId: string | null) { super(`PROVIDER_REQUEST_FAILED:${provider}:HTTP_${status}:CODE_${code ?? "UNKNOWN"}`); }
}
const SECRET_KEYS = /^(access_token|refresh_token|appsecret_proof|client_secret|app_secret|encryptedToken|encrypted_token|credential|credentials|authorization)$/i;
export function sanitizeProviderResponse(value: unknown, depth = 0): unknown {
  if (depth > 25) throw new PlatformDenied("PROVIDER_RESPONSE_TOO_DEEP");
  if (typeof value === "string") return value.replace(/([?&](?:access_token|appsecret_proof|client_secret)=)[^&#\s]*/gi, "$1[REDACTED]").replace(/EAA[A-Za-z0-9]{20,}/g, "[REDACTED]");
  if (Array.isArray(value)) return value.map(v => sanitizeProviderResponse(v, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !SECRET_KEYS.test(k)).map(([k,v]) => [k, sanitizeProviderResponse(v, depth + 1)]));
}
interface ProjectionNode { stringArray?:boolean; leaf?: boolean; children: Map<string, ProjectionNode> }
export function projectProviderResponse(value: unknown, contract: ProductContract): unknown {
  if (!contract.responseFields?.length) throw new PlatformDenied("RESPONSE_PROJECTION_REQUIRED");
  const root: ProjectionNode = { children: new Map() };
  for (const field of contract.responseFields) {
    const parts = field.split(".");
    if (parts.length > 10 || parts.some(p => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(p) || SECRET_KEYS.test(p) || ["__proto__", "constructor", "prototype"].includes(p))) throw new PlatformDenied("INVALID_RESPONSE_PROJECTION");
    if (parts.includes("paging") && (!contract.pagination || !/^(?:[A-Za-z_]+\.)*paging\.cursors\.(before|after)$/.test(field))) continue;
    let cursor = root;
    for (const part of parts) {
      if (!cursor.children.has(part)) cursor.children.set(part, { children: new Map() });
      cursor = cursor.children.get(part)!;
    }
    cursor.leaf = true;
    if(contract.tool==="leads_retrieve" && contract.privateResponse==="client_leads" && field==="data.field_data.values")cursor.stringArray=true;
  }
  let nodes = 0;
  const project = (source: unknown, node: ProjectionNode, depth: number): unknown => {
    if (++nodes > 10000 || depth > 25) throw new PlatformDenied("PROVIDER_RESPONSE_TOO_COMPLEX");
    if(node.leaf && node.stringArray)return reviewedLeadStringArray(source);
    if (node.leaf) return !source || typeof source !== "object" ? sanitizeProviderResponse(source) : undefined;
    if (Array.isArray(source)) return source.map(item => project(item, node, depth + 1));
    if (!source || typeof source !== "object") return undefined;
    const output: Record<string, unknown> = {};
    for (const [key, child] of node.children) {
      if (!Object.hasOwn(source, key)) continue;
      const projected = project((source as Record<string, unknown>)[key], child, depth + 1);
      if (projected !== undefined) output[key] = projected;
    }
    return output;
  };
  const output = project(value, root, 0);
  if (!output || typeof output !== "object" || Array.isArray(output) || Object.keys(output).length === 0) throw new PlatformDenied("PROVIDER_RESPONSE_SCHEMA_INVALID");
  return output;
}
interface RateState { blockedUntil: number; failures: number; lastStatus: number; updatedAt: number }
export class ProductRateController {
  private states = new Map<string, RateState>();
  private apps=new Map<string,string>();
  private appBlocks=new Map<string,number>();
  bind(key:string,appId:string):void {if(!key||key.length>200||!/^[A-Za-z0-9_.-]{1,100}$/.test(appId))throw new PlatformDenied("PRODUCT_RATE_APP_BINDING_REQUIRED");const app=createHash("sha256").update(JSON.stringify(["meta-product-app",appId])).digest("hex"),prior=this.apps.get(key);if(prior&&prior!==app)throw new PlatformDenied("PRODUCT_RATE_APP_REBIND_DENIED");if(!prior&&this.apps.size>=10000)throw new PlatformDenied("PRODUCT_RATE_CAPACITY_HOLD");this.apps.set(key,app);}
  check(key: string, now = Date.now()): void { if (Math.max(this.states.get(key)?.blockedUntil ?? 0,this.appBlocks.get(this.apps.get(key)??"")??0) > now) throw new PlatformDenied("PRODUCT_RATE_LIMIT_OR_CIRCUIT_OPEN"); }
  observe(key: string, response: Response, code: number | null, now = Date.now()): void {
    if(!this.states.has(key)&&this.states.size>=10000)throw new PlatformDenied("PRODUCT_RATE_CAPACITY_HOLD");
    const app=this.apps.get(key),appHeader=response.headers.get("x-app-usage");if(app&&appHeader!==null){const delay=productUsageDelay(readProductUsage(new Headers({"x-app-usage":appHeader})));if(delay)this.appBlocks.set(app,Math.max(this.appBlocks.get(app)??0,now+delay));}
    const previous = this.states.get(key);
    const usageWait=productUsageDelay(readProductUsage(response.headers));
    const throttled = response.status === 429 || [4,17,32,613,80000,80001,80002,80003,80004,80005,80006,80008,80009,80014].includes(code ?? -1);
    const retry = response.headers.get("retry-after");
    const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : null;
    const date = retry ? Date.parse(retry) : NaN;
    const wait = seconds !== null ? seconds * 1000 : Number.isFinite(date) ? Math.max(0,date-now) : 60_000;
    const failures = response.status >= 500 ? (previous?.failures ?? 0) + 1 : 0;
    this.states.set(key, { blockedUntil: Math.max(previous?.blockedUntil ?? 0, usageWait?now+usageWait:0, throttled ? now + (Number.isFinite(wait) ? Math.min(Number.MAX_SAFE_INTEGER-now,Math.max(wait,1000)) : 60_000) : failures >= 3 ? now + 60_000 : 0), failures, lastStatus: response.status, updatedAt: now });
  }
  scopedObservation(key:string,appId:string):{blockedUntil:number;failures:number;lastStatus:number;updatedAt:number}|null{const app=createHash("sha256").update(JSON.stringify(["meta-product-app",appId])).digest("hex");if(this.apps.get(key)!==app)return null;const state=this.states.get(key);return state?{...state,blockedUntil:Math.max(state.blockedUntil,this.appBlocks.get(app)??0)}:null;}
  snapshot(): Record<string, RateState> { return Object.fromEntries([...this.states].map(([key,state]) => [key,{...state}])); }
}
export const productRateController = new ProductRateController();
type MessagingPolicyVerifier = (scope:MessagingExecution,input:MessagingRequest)=>Promise<{messagingAccountId?:string;validUntil?:number}>;
let verifyMessagingPolicy:MessagingPolicyVerifier=async()=>{throw new PlatformDenied("MESSAGING_POLICY_RUNTIME_REQUIRED");};
export function configureMessagingPolicyVerifier(verifier:MessagingPolicyVerifier|undefined):void{verifyMessagingPolicy=verifier??(async()=>{throw new PlatformDenied("MESSAGING_POLICY_RUNTIME_REQUIRED");});verifyWindow=verifier?async(_provider,assetId,recipient)=>{const proof=await verifier(getExecutionScope(),{assetId,recipient,mode:"text"});if(!Number.isSafeInteger(proof.validUntil)||proof.validUntil!<=Date.now())throw new PlatformDenied("MESSAGING_POLICY_DEADLINE_REQUIRED");return {validUntil:proof.validUntil!};}:async()=>false;}
type WindowVerifier = (provider: Provider, assetId: string, recipientId: string) => Promise<boolean|{validUntil:number}>;
let verifyWindow: WindowVerifier = async () => false;
export function configureMessagingWindowVerifier(verifier: WindowVerifier): void { verifyWindow = verifier; }
export async function verifyProductMessagingWindow(provider:Provider,assetId:string,recipient:string):Promise<{validUntil:number}>{const proof=await verifyWindow(provider,assetId,recipient);if(!proof||typeof proof!=="object"||!Number.isSafeInteger(proof.validUntil)||proof.validUntil<=Date.now())throw new PlatformDenied("MESSAGING_POLICY_DEADLINE_REQUIRED");return {validUntil:proof.validUntil};}
export function validateContractParameters(contract: ProductContract, parameters: Record<string, unknown>): void {
  for (const key of Object.keys(parameters)) if (!contract.allowedInputKeys.includes(key) || SECRET_KEYS.test(key) || ["fields","batch","path","auto_publish_text"].includes(key)) throw new PlatformDenied("UNSUPPORTED_ENDPOINT_PARAMETER");
  const visit = (value: unknown, depth: number): void => {
    if (depth > 20) throw new PlatformDenied("INPUT_TOO_DEEP");
    assertNoCredentialShapedString(value);
    if (Array.isArray(value)) { value.forEach(v => visit(v,depth+1)); return; }
    if (!value || typeof value !== "object") return;
    for (const [key,v] of Object.entries(value)) { if (SECRET_KEYS.test(key) || ["__proto__","constructor","prototype","auto_publish_text"].includes(key)) throw new PlatformDenied("UNSAFE_ENDPOINT_PARAMETER"); visit(v,depth+1); }
  };
  validateProductInput(contract.tool,parameters);
  canonicalJson(parameters);
  visit(parameters,0);
  if ("url" in parameters) {
    if (typeof parameters.url !== "string") throw new PlatformDenied("INVALID_PUBLIC_MEDIA_URL");
    const media = new URL(parameters.url);
    if (media.protocol !== "https:" || media.username || media.password || media.searchParams.has("access_token")) throw new PlatformDenied("INVALID_PUBLIC_MEDIA_URL");
  }
  if (contract.tool === "messenger_send_text") {
    const recipient = parameters.recipient as Record<string,unknown> | undefined;
    const message = parameters.message as Record<string,unknown> | undefined;
    if (!recipient || Object.keys(recipient).join() !== "id" || typeof recipient.id !== "string" || !/^\d{1,100}$/.test(recipient.id) || !message || Object.keys(message).join() !== "text" || typeof message.text !== "string" || message.text.trim().length < 1 || message.text.length > 2000) throw new PlatformDenied("LUMIN_TEXT_RESPONSE_POLICY_REQUIRED");
  }
  if (contract.tool === "whatsapp_platform_send_message") {
    if(typeof parameters.to !== "string" || !/^\+[1-9][0-9]{7,14}$/.test(parameters.to) || typeof parameters.text !== "string" || !parameters.text.trim() || parameters.text.length>2000)throw new PlatformDenied("LUMIN_WHATSAPP_TEXT_SCHEMA_REQUIRED");
  }
  if (contract.tool === "pages_create_feed") {
    const message = parameters.message, link = parameters.link;
    if ((message !== undefined && (typeof message !== "string" || !message.trim() || message.length > 10000 || /@\[[^\]]+\]/.test(message))) || (link !== undefined && (typeof link !== "string" || !link)) || (message === undefined && link === undefined) || (parameters.published !== undefined && typeof parameters.published !== "boolean")) throw new PlatformDenied("LUMIN_PAGE_POST_SCHEMA_REQUIRED");
    if (link !== undefined) {
      let url: URL;
      try { url = new URL(link as string); } catch { throw new PlatformDenied("LUMIN_PAGE_LINK_POLICY_REQUIRED"); }
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443") || !hostname.includes(".") || unsafeIpReason(hostname) || /(?:^|\.)(localhost|local|internal)$/i.test(hostname) || [...url.searchParams.keys()].some(key => /token|secret|password|credential|authorization/i.test(key))) throw new PlatformDenied("LUMIN_PAGE_LINK_POLICY_REQUIRED");
    }
  }
}
export function contractPlanParameters(contract: ProductContract, assetId: string, input: Record<string,unknown>): Record<string,unknown> {
  return structuredClone({asset_id:assetId,input,endpointContract:{appEventTypesTransport:contract.tool===APP_EVENT_TYPES_TOOL?{fields:"event_name",limit:100,assignment_fields:"id",assignment_limit:1,application_fields:"id,object_store_urls,supported_platforms",no_auto_pagination:true,no_event_parameters:true}:null,videoInspectionTransport:[VIDEO_INSPECTION_TOOL,CREATIVE_VIDEO_INSPECTION_TOOL].includes(contract.tool)?{creative_fields:contract.tool===CREATIVE_VIDEO_INSPECTION_TOOL?CREATIVE_VIDEO_INSPECTION_FIELDS:null,fields:VIDEO_INSPECTION_FIELDS,membership_fields:"id",membership_limit:100,maximum_frames:4,maximum_bytes:16777216,no_redirects:true,private_source_url:true,actual_decode:true,no_transcription:true}:null,existingAdPreviewTransport:contract.tool===MARKETING_PREVIEW_TOOL?{endpoint:"/{asset_id}/previews",format:"approved_ad_format",maximum_receipts:1,provider_limit_parameter:false,model_output:"authenticated_local_preview_path_only",raw_provider_html:"withheld"}:null,purchaseConversionTransport:contract.tool===PURCHASE_CONVERSION_TOOL?purchaseConversionBody(input):null,datasetReadTransport:contract.tool===DATASET_READ_TOOL?{edge:"/{business_id}/ads_dataset",fields:DATASET_READ_FIELDS,id_filter:"exact_registered_dataset",account_fields:"id,account_id,business{id}",limit:100,no_pagination:true,no_implicit_grants:true}:null,catalogCampaignTransport:contract.tool===CATALOG_CAMPAIGN_TOOL?{adset_fields:CATALOG_CAMPAIGN_FIELDS,campaign_fields:CATALOG_CAMPAIGN_GROUP_FIELDS,independent_catalog_proof:true,no_cross_provider_grant_union:true,no_activation:true}:null,invoiceMetadataTransport:contract.tool===INVOICE_METADATA_TOOL?{query:invoiceMetadataQuery(input),all_accounts_explicit:true,whole_invoice_filter:true,no_amounts:true,no_downloads:true}:null,crmTransport:contract.tool===CRM_SIGNAL_TOOL?{action_source:"system_generated",event_source:"crm",immutable_deployment_funnel:true,actual_signed_instant_form_origin:true,no_test_events:true,one_attempt:true,credential_compatibility_gate:true}:null,catalogOperationalTransport:(CATALOG_OPERATIONAL_TOOLS as readonly string[]).includes(contract.tool)?{registered_catalog_membership:true,owner_business_current:true,private_feed_urls:false,health_certification:false}:null,studyTransport:contract.tool===MARKETING_STUDY_TOOL?marketingStudyBody(input):null,ruleTransport:contract.tool===MARKETING_RULE_TOOL?marketingRuleBody(input):null,reportTransport:contract.tool===MARKETING_REPORT_TOOL?{level:"account",fields:MARKETING_REPORT_FIELDS,use_unified_attribution_setting:true,maximum_inclusive_days:31,receipt:"report_run_id",no_exports:true,no_automatic_retry:true}:null,authMode:contract.authMode??null,id:contract.id,tool:contract.tool,provider:contract.provider,method:contract.method,path:contract.path,assetType:contract.assetType,assetInputKeys:contract.assetInputKeys ?? {},assetInputArrayKeys:contract.assetInputArrayKeys ?? {},fixedQuery:contract.fixedQuery ?? {},fixedBody:INSTAGRAM_IMAGE_VARIANT_TOOLS.includes(contract.tool)?{mode:contract.createdAssetKind,source:contract.tool.includes("story")?"registered_instagram_story_publishing_jpeg":"registered_instagram_content_publishing_jpeg"}:THREADS_IMAGE_TOOLS.includes(contract.tool)?{mode:contract.createdAssetKind,source:"registered_threads_content_publishing_jpeg"}:INSTAGRAM_CAROUSEL_TOOLS.includes(contract.tool)||THREADS_CAROUSEL_TOOLS.includes(contract.tool)?{mode:contract.createdAssetKind,children:"ordered_registered_ready_containers"}:THREADS_VIDEO_TOOLS.includes(contract.tool)?{mode:contract.createdAssetKind,source:"registered_threads_video_publishing_mp4"}:INSTAGRAM_VIDEO_TOOLS.includes(contract.tool)?{mode:contract.createdAssetKind,source:"registered_instagram_video_publishing_mp4"}:MESSAGING_IMAGE_TOOLS.includes(contract.tool)?{media_source:"registered_messaging_purpose_jpeg",image_body:contract.provider==="META_MESSENGER"?"attachment":"attachments"}:MESSENGER_TYPED_TOOLS.includes(contract.tool)?messengerTypedFixedBody(contract.tool):contract.tool==="pages_create_photos"?{url_source:"registered_facebook_content_publishing_jpeg"}:contract.tool === "messenger_send_text" ? {messaging_type:"RESPONSE"} : contract.tool === "whatsapp_platform_send_message" ? {messaging_product:"whatsapp",recipient_type:"individual",type:"text",preview_url:false,messaging_account_source:"authorized_client_parent"} : {},requiredScopes:contract.requiredScopes,tokenTypes:contract.tokenTypes,operationClasses:contract.operationClasses,requiredTasks:contract.requiredTasks ?? [],requiredTaskAssetType:contract.requiredTaskAssetType ?? null,manualRequirements:contract.manualRequirements,eligibilityRequirements:contract.eligibilityRequirements??null,eligibilityPolicies:contract.eligibilityPolicies??{},responseFields:contract.responseFields ?? [],pagination:contract.pagination ?? false,requiresMessagingWindow:contract.requiresMessagingWindow ?? false,createOrCopy:contract.createOrCopy ?? false,createdAssetType:contract.createdAssetType ?? null,createdAssetKind:contract.createdAssetKind ?? null,assetEvidenceUpdate:contract.assetEvidenceUpdate ?? null,returnedAssetType:contract.returnedAssetType ?? null,privateResponse:contract.privateResponse ?? null,requiresClientOwnedBusiness:contract.requiresClientOwnedBusiness ?? false,serverOnlyInputKeys:contract.serverOnlyInputKeys ?? [],utilityTransport:MESSENGER_UTILITY_TOOLS.includes(contract.tool)?MESSENGER_UTILITY_TRANSPORT:null,...(IMAGE_INSPECTION_TOOLS.includes(contract.tool)?{imageInspectionQuery:{accountSource:"registered_same_client_AD_ACCOUNT",hashSource:"registered_AD_IMAGE",edge:"/act_{account}/adimages",fields:IMAGE_INSPECTION_FIELDS,hashes:"exact_single_registered_hash",limit:1,creativeFields:contract.tool==="marketing_inspect_creative_image"?CREATIVE_IMAGE_INSPECTION_FIELDS:null,download:"authenticated_receipt_public_pinned_Meta_CDN_JPEG",sourceMetadataRemoved:true}}:{}),archiveResearchQuery:contract.tool===AD_LIBRARY_TOOL?{fields:AD_LIBRARY_FIELDS,ad_type:"ALL",limit:25,unmask_removed_content:false,coverage:"EU_ONLY",no_implicit_grants:true}:null,catalogAssignedUsersQuery:contract.tool==="catalog_list_assigned_users"?CATALOG_ASSIGNED_USERS_QUERY:null,mentionQuery:INSTAGRAM_MENTION_TOOLS.includes(contract.tool)?INSTAGRAM_MENTION_QUERY:null,threadsDiscoveryQuery:THREADS_DISCOVERY_TOOLS.includes(contract.tool)?THREADS_DISCOVERY_QUERY:null,hashtagQuery:contract.tool==="instagram_hashtag_search"?INSTAGRAM_HASHTAG_QUERY:null,businessDiscoveryQuery:contract.tool==="instagram_business_discovery"?INSTAGRAM_BUSINESS_DISCOVERY_QUERY:null,pageReplyPreflight:contract.tool===PAGE_REPLY_TOOL?PAGE_REPLY_PREFLIGHT:null,pageEditPreflight:contract.tool==="pages_edit_post"?PAGE_POST_EDIT_PREFLIGHT:null,commentPreflight:(INSTAGRAM_COMMENT_TOOLS.includes(contract.tool)||INSTAGRAM_MEDIA_INSIGHTS_TOOLS.includes(contract.tool))?INSTAGRAM_COMMENT_PREFLIGHT:null,storyBusinessPreflight:INSTAGRAM_STORY_TOOLS.includes(contract.tool)?INSTAGRAM_STORY_PREFLIGHT:null,publicationPreflight:requiresInstagramPublicationQuota(contract.tool)?INSTAGRAM_PUBLICATION_PREFLIGHT:requiresThreadsPublicationQuota(contract.tool)?THREADS_PUBLICATION_PREFLIGHT:null}});
}
export function isOfficialEligibilitySource(source: string): boolean {
  try {
    const url = new URL(source);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") && ((url.hostname === "developers.facebook.com" && /^\/(docs|documentation)\//.test(url.pathname)) || (url.hostname === "www.postman.com" && url.pathname.startsWith("/meta/")));
  } catch { return false; }
}
export function assertContractEligibility(contract: ProductContract, connection: Connection, now=Date.now(),manual?:{evidence?:ManualEligibilityEvidence;clientId:string}): void {
  // Source URLs constrain trusted stored attestations; a public documentation
  // URL alone never proves the app's approval or the client's current consent.
  if(contract.provider==="META_WHATSAPP"&&connection.tokenType==="business_integration_system_user")assertWhatsAppOwnerOperational(connection,contract.operationClasses.some(c=>c!=="READ"),now);
  const maximumAge = contract.operationClasses.some(c => c !== "READ") ? 300000 : 3600000;
  for (const requirement of contract.eligibilityRequirements??contract.manualRequirements) {if(contract.eligibilityPolicies?.[requirement]?.kind==="HUMAN_ATTESTATION"){let proof=manual;if(!proof){try{const scope=getExecutionScope();proof={evidence:scope.snapshot.manualEligibilityEvidence,clientId:scope.context.clientId};}catch{throw new PlatformDenied("MANUAL_ELIGIBILITY_RECORD_REQUIRED");}}assertManualEligibilityAttestation(contract,connection,requirement,proof.evidence,proof.clientId,now);continue;}if (!connection.eligibility?.some(e => e.requirement === requirement && e.verified === true && isOfficialEligibilitySource(e.source) && Number.isFinite(e.checkedAt) && e.checkedAt > 0 && e.checkedAt <= now && Number.isFinite(e.expiresAt) && e.expiresAt > now && now-e.checkedAt <= maximumAge)) throw new PlatformDenied("PRODUCT_ELIGIBILITY_UNVERIFIED");}
}
export function signalPlanParameters(contract:ProductContract,assetId:string,input:Record<string,unknown>,event:Record<string,unknown>):Record<string,unknown>{return {...contractPlanParameters(contract,assetId,input),prepared_event:structuredClone(event)};}
export class MetaGraphClient {
  constructor(readonly provider: Provider, private readonly fetcher: typeof fetch = fetch, private readonly timeoutMs = 30_000) {}
  async request(contract: ProductContract, assetId: string, parameters: Record<string, unknown> = {}): Promise<unknown> {
    if(WHATSAPP_ANALYTICS_TOOLS.includes(contract.tool))throw new PlatformDenied("DEDICATED_WHATSAPP_ANALYTICS_CLIENT_REQUIRED");
    if(THREADS_DISCOVERY_TOOLS.includes(contract.tool))throw new PlatformDenied("DEDICATED_THREADS_DISCOVERY_CLIENT_REQUIRED");
    if(contract.tool===MARKETING_IMAGE_TOOL)throw new PlatformDenied("DEDICATED_MARKETING_IMAGE_CLIENT_REQUIRED");
    if(contract.tool===AD_LIBRARY_TOOL)throw new PlatformDenied("DEDICATED_AD_LIBRARY_CLIENT_REQUIRED");
    if(contract.tool===PAGE_COMMENT_READ_TOOL)throw new PlatformDenied("DEDICATED_PAGE_COMMENT_READ_CLIENT_REQUIRED");
    if(contract.tool===APP_EVENT_TYPES_TOOL)throw new PlatformDenied("DEDICATED_APP_EVENT_TYPES_CLIENT_REQUIRED");
    if(IMAGE_INSPECTION_TOOLS.includes(contract.tool))throw new PlatformDenied("DEDICATED_IMAGE_INSPECTION_CLIENT_REQUIRED");
    if([VIDEO_INSPECTION_TOOL,CREATIVE_VIDEO_INSPECTION_TOOL].includes(contract.tool))throw new PlatformDenied("DEDICATED_VIDEO_INSPECTION_CLIENT_REQUIRED");
    if(contract.tool===CATALOG_CAMPAIGN_TOOL)throw new PlatformDenied("DEDICATED_DUAL_CATALOG_CAMPAIGN_CLIENT_REQUIRED");
    if(contract.tool===INVOICE_METADATA_TOOL)throw new PlatformDenied("DEDICATED_INVOICE_METADATA_CLIENT_REQUIRED");
    if(contract.tool===CRM_SIGNAL_TOOL)throw new PlatformDenied("DEDICATED_CRM_DISPATCHER_REQUIRED");
    if((CATALOG_OPERATIONAL_TOOLS as readonly string[]).includes(contract.tool))throw new PlatformDenied("DEDICATED_CATALOG_OPERATIONAL_CLIENT_REQUIRED");
    if((MARKETING_CONTROL_TOOLS as readonly string[]).includes(contract.tool)||contract.tool===MARKETING_STUDY_TOOL||contract.tool===MARKETING_RULE_TOOL||contract.tool===MARKETING_PREVIEW_TOOL||contract.tool===PURCHASE_CONVERSION_TOOL||contract.tool===DATASET_READ_TOOL||contract.tool===MARKETING_REPORT_TOOL||contract.tool===MARKETING_VIDEO_TOOL||(MARKETING_AUDIENCE_TOOLS as readonly string[]).includes(contract.tool))throw new PlatformDenied("DEDICATED_MARKETING_PRODUCT_CLIENT_REQUIRED");
    if(MESSENGER_UTILITY_TOOLS.includes(contract.tool))throw new PlatformDenied("DEDICATED_MESSENGER_UTILITY_CLIENT_REQUIRED");
    if((MESSENGER_ATTACHMENT_TOOLS as readonly string[]).includes(contract.tool))throw new PlatformDenied("DEDICATED_MESSENGER_ATTACHMENT_CLIENT_REQUIRED");
    if(contract.tool===LEAD_FORM_TOOL)throw new PlatformDenied("DEDICATED_LEAD_FORM_CLIENT_REQUIRED");
    if(WHATSAPP_SEND_TOOLS.includes(contract.tool))throw new PlatformDenied("DEDICATED_WHATSAPP_SEND_CLIENT_REQUIRED");
    if(contract.tool===OFFLINE_QUALITY_TOOL)throw new PlatformDenied("DEDICATED_OFFLINE_QUALITY_CLIENT_REQUIRED");
    if(["pages_create_videos","pages_get_video_status"].includes(contract.tool))throw new PlatformDenied("DEDICATED_PAGE_VIDEO_CLIENT_REQUIRED");
    if(OEMBED_TOOLS.includes(contract.tool)||contract.authMode)throw new PlatformDenied("DEDICATED_TOKENLESS_FRONTEND_REQUIRED");
    if(contract.tool==="instagram_hashtag_search")throw new PlatformDenied("DEDICATED_INSTAGRAM_HASHTAG_CLIENT_REQUIRED");
    if(WHATSAPP_QR_TOOLS.includes(contract.tool))throw new PlatformDenied("DEDICATED_WHATSAPP_QR_CLIENT_REQUIRED");
    if(WHATSAPP_PHONE_TOOLS.includes(contract.tool))throw new PlatformDenied("DEDICATED_WHATSAPP_PHONE_CLIENT_REQUIRED");
    if(WHATSAPP_SUBSCRIPTION_TOOLS.includes(contract.tool))throw new PlatformDenied("DEDICATED_WHATSAPP_SUBSCRIPTION_CLIENT_REQUIRED");
    if(WHATSAPP_TEMPLATE_TOOLS.includes(contract.tool))throw new PlatformDenied("DEDICATED_WHATSAPP_TEMPLATE_CLIENT_REQUIRED");
    if(WHATSAPP_FLOW_TOOLS.includes(contract.tool))throw new PlatformDenied("DEDICATED_WHATSAPP_FLOW_CLIENT_REQUIRED");
    if(contract.tool === "signals_send_pixel_events")throw new PlatformDenied("DEDICATED_FIRST_PARTY_SIGNAL_REQUIRED");
    return this.perform(contract,assetId,parameters);
  }
  async requestPreparedSignal(contract:ProductContract,assetId:string,input:Record<string,unknown>,prepared:PreparedSignal):Promise<unknown>{
    if(contract.tool!=="signals_send_pixel_events")throw new PlatformDenied("DEDICATED_SIGNAL_CONTRACT_REQUIRED");
    return this.perform(contract,assetId,input,prepared);
  }
  private async perform(contract: ProductContract, assetId: string, parameters: Record<string, unknown>, prepared?:PreparedSignal): Promise<unknown> {
    contract = structuredClone(contract);
    parameters = structuredClone(parameters);
    if (!contract.verified) throw new PlatformDenied("ENDPOINT_CONTRACT_OR_ELIGIBILITY_UNVERIFIED");
    if (!contract.responseFields?.length) throw new PlatformDenied("RESPONSE_PROJECTION_REQUIRED");
    if (contract.provider !== this.provider) throw new PlatformDenied("PROVIDER_CONTRACT_MISMATCH");
    validateContractParameters(contract,parameters);
    const permit = assertExecutionPermit({provider: this.provider, mutation: contract.method !== "GET", tool: contract.tool});
    const scope = getExecutionScope();
    if(prepared)assertPreparedSignal(prepared,{tenantId:scope.context.principal.tenantId,clientId:scope.context.clientId,datasetId:assetId});
    const preparedEvent=prepared?structuredClone(prepared.event):undefined;
    if (scope.plan.capability !== contract.id || canonicalJson(scope.plan.parameters) !== canonicalJson(preparedEvent?signalPlanParameters(contract,assetId,parameters,preparedEvent):contractPlanParameters(contract,assetId,parameters))) throw new PlatformDenied("APPROVED_ENDPOINT_PLAN_MISMATCH");
    if (canonicalJson(scope.plan.requiredScopes) !== canonicalJson(contract.requiredScopes) || canonicalJson(scope.plan.tokenTypes) !== canonicalJson(contract.tokenTypes) || canonicalJson({global:scope.plan.requiredTasks??[],scoped:scope.plan.requiredAssetTasks??[]}) !== canonicalJson((()=>{const expected=applyProductTaskRequirements(structuredClone(scope.plan),contract,scope.snapshot.assets);return {global:expected.requiredTasks??[],scoped:expected.requiredAssetTasks??[]};})()) || !contract.operationClasses.every(c => scope.plan.classes.includes(c))) throw new PlatformDenied("APPROVED_ENDPOINT_CONTRACT_MISMATCH");
    if (canonicalJson(scope.plan.classes) !== canonicalJson(classifyPlan({ ...scope.plan, classes: contract.operationClasses })) || (scope.plan.createOrCopy ?? false) !== (contract.createOrCopy ?? false)) throw new PlatformDenied("APPROVED_ENDPOINT_CONTRACT_MISMATCH");
    assertContractEligibility(contract,scope.snapshot.connection);
    assertProductClientOwnership(contract,assetId,scope.snapshot.client,scope.snapshot.assets,scope.snapshot.businessOwnerEvidence);
    if (!scope.snapshot.assets.some(a => a.id === assetId && a.type === contract.assetType && a.provider === this.provider)) throw new PlatformDenied("ENDPOINT_ASSET_NOT_AUTHORIZED");
    for (const [key, type] of Object.entries(contract.assetInputKeys ?? {})) {
      const id = parameters[key];
      if (id === undefined) continue;
      if (typeof id !== "string" || !scope.snapshot.assets.some(a => a.type === type && a.provider === this.provider && a.id.replace(/^act_/, "") === id.replace(/^act_/, ""))) throw new PlatformDenied("INDIRECT_ENDPOINT_ASSET_NOT_AUTHORIZED");
    }
    for(const [key,type] of Object.entries(contract.assetInputArrayKeys??{})){const values=parameters[key];if(!Array.isArray(values)||values.length<2||values.length>(this.provider==="META_THREADS"?20:10)||new Set(values).size!==values.length||values.some(id=>typeof id!=="string"||!scope.snapshot.assets.some(a=>a.type===type&&a.provider===this.provider&&a.id===id)))throw new PlatformDenied("INDIRECT_ARRAY_ASSETS_NOT_AUTHORIZED");}
    let messagingAccountId:string|undefined;
    if(contract.tool === "whatsapp_platform_send_message"){
      const policy=await verifyMessagingPolicy(scope,{assetId,recipient:String(parameters.to),mode:"text"});
      const phone=scope.snapshot.assets.find(a=>a.type==="WHATSAPP_PHONE" && a.id===assetId);
      const parent=scope.snapshot.assets.find(a=>a.type==="MESSAGING_ACCOUNT" && a.id===policy.messagingAccountId);
      if(!phone || !parent || !phone.parents.some(p=>p.type==="MESSAGING_ACCOUNT" && p.id===parent.id))throw new PlatformDenied("VERIFIED_CLIENT_MESSAGING_ACCOUNT_REQUIRED");
      messagingAccountId=parent.id;
    } else if (contract.requiresMessagingWindow) {
      const recipient = parameters.recipient;
      const id = recipient && typeof recipient === "object" && "id" in recipient ? String(recipient.id) : "";
      if (!id || !await verifyWindow(this.provider,assetId,id)) throw new PlatformDenied("VERIFIED_RECIPIENT_AND_MESSAGING_WINDOW_REQUIRED");
    }
    if (!/^[A-Za-z0-9_:$\.\-=]{1,200}$/.test(assetId)) throw new PlatformDenied("INVALID_ASSET_ID");
    const path = contract.path.replace("{asset_id}",encodeURIComponent(assetId));
    if (!path.startsWith("/") || /[?#]|\.\.|\{/.test(path)) throw new PlatformDenied("INVALID_ENDPOINT_CONTRACT");
    const url = new URL(`/${productVersion(this.provider)}${path}`,HOSTS[this.provider]);
    if (contract.method === "GET") for (const [k,v] of Object.entries(parameters).filter(([key])=>!contract.serverOnlyInputKeys?.includes(key))) url.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    if(contract.tool==="catalog_list_assigned_users"){url.searchParams.set("business",catalogAssignedBusiness(assetId,scope.snapshot.assets).id);url.searchParams.set("fields","role");url.searchParams.set("limit","100");}
    if(INSTAGRAM_MENTION_TOOLS.includes(contract.tool))url.searchParams.set("fields",instagramMentionFields(contract.tool,parameters));
    if(contract.tool==="instagram_business_discovery")url.searchParams.set("fields",instagramBusinessDiscoveryFields(parameters));
    for (const [key,value] of Object.entries(contract.fixedQuery ?? {})) url.searchParams.set(key,value);
    await revalidateExecutionPermit(permit);
    return withConnectionCredential(permit,async token => {
      assertContractEligibility(contract,scope.snapshot.connection);
      const bucket = createHash("sha256").update(JSON.stringify([this.provider,scope.snapshot.connection.appId,createHash("sha256").update(token).digest("hex")])).digest("hex");
      productRateController.bind(bucket,scope.snapshot.connection.appId);
      productRateController.check(bucket);
      await revalidateExecutionPermit(permit);
      let publicationDeadline:number|undefined;
      let messagingDeadline:number|undefined;
      if(contract.tool === "whatsapp_platform_send_message"){
        const current=await verifyMessagingPolicy(scope,{assetId,recipient:String(parameters.to),mode:"text"});
        messagingDeadline=current.validUntil;
        if(current.messagingAccountId!==messagingAccountId)throw new PlatformDenied("MESSAGING_POLICY_CHANGED");
      }else if(contract.requiresMessagingWindow){
        const recipient=parameters.recipient as {id?:string};
        const windowProof=await verifyWindow(this.provider,assetId,String(recipient?.id ?? ""));
        if(!windowProof)throw new PlatformDenied("MESSAGING_WINDOW_CHANGED");
        if(typeof windowProof==="object")messagingDeadline=windowProof.validUntil;
      }
      if(prepared)await revalidatePreparedSignal(prepared,{tenantId:scope.context.principal.tenantId,clientId:scope.context.clientId,datasetId:assetId});
      assertProductAssetRelationships(contract,assetId,parameters,scope.snapshot.assets,permit.operationId);
      assertProductClientOwnership(contract,assetId,scope.snapshot.client,scope.snapshot.assets);
      productRateController.check(bucket);
      assertContractEligibility(contract,scope.snapshot.connection);
      if(preparedEvent?.action_source==="physical_store"){
        if(contract.tool!=="signals_send_pixel_events"||this.provider!=="META_MARKETING")throw new PlatformDenied("OFFLINE_CONSOLIDATED_DATASET_REQUIRED");
        const offlineUrl=new URL('/'+productVersion(this.provider)+'/'+encodeURIComponent(assetId),HOSTS[this.provider]);offlineUrl.searchParams.set("fields","id,is_consolidated_container");
        let offlineResponse:Response;try{offlineResponse=await this.fetcher(offlineUrl,{method:"GET",redirect:"error",signal:AbortSignal.timeout(this.timeoutMs),headers:{Authorization:`Bearer ${token}`}});}catch{throw new PlatformDenied("OFFLINE_CONSOLIDATION_PREFLIGHT_UNAVAILABLE");}
        productRateController.observe(bucket,offlineResponse,null);let offlineBody:unknown;try{offlineBody=JSON.parse(await readBodyWithLimit(offlineResponse,64000));}catch{throw new PlatformDenied("OFFLINE_CONSOLIDATED_DATASET_REQUIRED");}if(!offlineResponse.ok)throw new PlatformDenied("OFFLINE_CONSOLIDATED_DATASET_REQUIRED");assertOfflinePixelConsolidation(offlineBody,assetId);
        await revalidateExecutionPermit(permit);await revalidatePreparedSignal(prepared!,{tenantId:scope.context.principal.tenantId,clientId:scope.context.clientId,datasetId:assetId});assertContractEligibility(contract,scope.snapshot.connection);productRateController.check(bucket);
      }
      if (requiresInstagramPublicationQuota(contract.tool)) {
        const quotaUrl = new URL(`/${productVersion(this.provider)}/${encodeURIComponent(assetId)}/content_publishing_limit`, HOSTS[this.provider]);
        quotaUrl.searchParams.set("fields", INSTAGRAM_PUBLICATION_PREFLIGHT.fields);
        let quotaResponse: Response;
        try { quotaResponse = await this.fetcher(quotaUrl, { method: "GET", redirect: "error", signal: AbortSignal.timeout(this.timeoutMs), headers: { Authorization: `Bearer ${token}` } }); }
        catch { throw new ProductApiError(this.provider, 0, null, null); }
        const quotaText = await readBodyWithLimit(quotaResponse, 64_000);
        let quotaBody: unknown;
        try { quotaBody = JSON.parse(quotaText); } catch { throw new PlatformDenied("INSTAGRAM_PUBLISHING_QUOTA_UNVERIFIED"); }
        if (!quotaResponse.ok || quotaBody && typeof quotaBody === "object" && "error" in quotaBody) throw new PlatformDenied("INSTAGRAM_PUBLISHING_QUOTA_UNVERIFIED");
        assertInstagramPublicationQuota(quotaBody);
        await revalidateExecutionPermit(permit);
        assertContractEligibility(contract, scope.snapshot.connection);
        assertProductAssetRelationships(contract, assetId, parameters, scope.snapshot.assets, permit.operationId);
        productRateController.check(bucket);
      }
      if(requiresThreadsPublicationQuota(contract.tool)){
        if(this.provider!=="META_THREADS")throw new PlatformDenied("THREADS_PUBLISHING_QUOTA_UNVERIFIED");
        await revalidateExecutionPermit(permit);productRateController.check(bucket);
        const quotaUrl=new URL('/'+productVersion(this.provider)+'/'+encodeURIComponent(assetId)+'/threads_publishing_limit',HOSTS[this.provider]);quotaUrl.searchParams.set('fields',THREADS_PUBLICATION_PREFLIGHT.fields);
        let response:Response;try{response=await this.fetcher(quotaUrl,{method:'GET',redirect:'error',signal:AbortSignal.timeout(this.timeoutMs),headers:{Authorization:'Bearer '+token}});}catch{throw new ProductApiError(this.provider,0,null,null);}
        productRateController.observe(bucket,response,null);let value:unknown;try{value=JSON.parse(await readBodyWithLimit(response,32000));}catch{throw new PlatformDenied('THREADS_PUBLISHING_QUOTA_UNVERIFIED');}
        if(!response.ok||value&&typeof value==='object'&&'error' in value)throw new PlatformDenied('THREADS_PUBLISHING_QUOTA_UNVERIFIED');assertThreadsPublicationQuota(value);
        publicationDeadline=Date.now()+60000;
        await revalidateExecutionPermit(permit);assertContractEligibility(contract,scope.snapshot.connection);assertProductAssetRelationships(contract,assetId,parameters,scope.snapshot.assets,permit.operationId);productRateController.check(bucket);
      }
      if(INSTAGRAM_COMMENT_TOOLS.includes(contract.tool)||INSTAGRAM_MEDIA_INSIGHTS_TOOLS.includes(contract.tool)){
        const context=resolveInstagramCommentContext(contract,assetId,scope.snapshot.assets);
        const readPreflight=async(id:string,fields:string):Promise<unknown>=>{
          productRateController.check(bucket);await revalidateExecutionPermit(permit);
          const preflightUrl=new URL('/'+productVersion(this.provider)+'/'+encodeURIComponent(id),HOSTS[this.provider]);preflightUrl.searchParams.set('fields',fields);
          let response:Response;try{response=await this.fetcher(preflightUrl,{method:'GET',redirect:'error',signal:AbortSignal.timeout(this.timeoutMs),headers:{Authorization:'Bearer '+token}});}catch{throw new ProductApiError(this.provider,0,null,null);}
          productRateController.observe(bucket,response,null);
          const text=await readBodyWithLimit(response,64000);let result:unknown;try{result=JSON.parse(text);}catch{throw new PlatformDenied('INSTAGRAM_COMMENT_PREFLIGHT_UNVERIFIED');}
          if(!response.ok||result&&typeof result==='object'&&'error' in result)throw new PlatformDenied('INSTAGRAM_COMMENT_PREFLIGHT_UNVERIFIED');return result;
        };
        assertInstagramCommentMedia(await readPreflight(context.mediaId,INSTAGRAM_COMMENT_PREFLIGHT.mediaFields),context.mediaId,context.accountId);
        if(contract.assetType==='COMMENT')assertInstagramCommentState(contract.tool,await readPreflight(assetId,INSTAGRAM_COMMENT_PREFLIGHT.commentFields),assetId,context.mediaId,context.parentCommentId);
        await revalidateExecutionPermit(permit);assertContractEligibility(contract,scope.snapshot.connection);assertProductAssetRelationships(contract,assetId,parameters,scope.snapshot.assets,permit.operationId);
      }
      if(contract.tool===PAGE_REPLY_TOOL){
        const context=resolvePageReplyContext(assetId,scope.snapshot.assets),read=async(id:string,fields:string,edge=false)=>{const u=new URL('/'+productVersion(this.provider)+'/'+encodeURIComponent(id)+(edge?'/comments':''),HOSTS[this.provider]);u.searchParams.set('fields',fields);if(edge)u.searchParams.set('limit','100');await revalidateExecutionPermit(permit);productRateController.check(bucket);let r:Response;try{r=await this.fetcher(u,{method:'GET',redirect:'error',signal:AbortSignal.timeout(this.timeoutMs),headers:{Authorization:'Bearer '+token}});}catch{throw new ProductApiError(this.provider,0,null,null);}productRateController.observe(bucket,r,null);const text=await readBodyWithLimit(r,64000);let value:unknown;try{value=JSON.parse(text);}catch{throw new PlatformDenied('PAGE_REPLY_PREFLIGHT_UNVERIFIED');}if(!r.ok||value&&typeof value==='object'&&'error' in value)throw new PlatformDenied('PAGE_REPLY_PREFLIGHT_UNVERIFIED');return value;};
        assertPageReplyPost(await read(context.postId,PAGE_REPLY_PREFLIGHT.postFields),context.postId,context.pageId);
        for(const comment of context.comments)assertPageReplyComment(await read(comment.id,PAGE_REPLY_PREFLIGHT.commentFields),comment,comment.id===assetId);
        assertPageReplyMembership(await read(context.postId,PAGE_REPLY_PREFLIGHT.membershipFields,true),context.comments[context.comments.length-1].id);
        await revalidateExecutionPermit(permit);assertContractEligibility(contract,scope.snapshot.connection);resolvePageReplyContext(assetId,scope.snapshot.assets);
      }
      if(contract.tool==="pages_edit_post"){
        const context=assertPagePostEditAsset(assetId,scope.snapshot.assets),preflightUrl=new URL('/'+productVersion(this.provider)+'/'+encodeURIComponent(assetId),HOSTS[this.provider]);preflightUrl.searchParams.set('fields',PAGE_POST_EDIT_PREFLIGHT.fields);
        await revalidateExecutionPermit(permit);productRateController.check(bucket);let response:Response;
        try{response=await this.fetcher(preflightUrl,{method:'GET',redirect:'error',signal:AbortSignal.timeout(this.timeoutMs),headers:{Authorization:'Bearer '+token}});}catch{throw new ProductApiError(this.provider,0,null,null);}
        productRateController.observe(bucket,response,null);const text=await readBodyWithLimit(response,64000);let value:unknown;try{value=JSON.parse(text);}catch{throw new PlatformDenied('PAGE_POST_APP_OWNERSHIP_UNVERIFIED');}
        if(!response.ok||value&&typeof value==='object'&&'error' in value)throw new PlatformDenied('PAGE_POST_APP_OWNERSHIP_UNVERIFIED');assertPagePostEditResponse(value,assetId,context.pageId,context.appId);
        await revalidateExecutionPermit(permit);assertContractEligibility(contract,scope.snapshot.connection);assertPagePostEditAsset(assetId,scope.snapshot.assets);
      }
      if(contract.requiresMessagingWindow){await revalidateExecutionPermit(permit);assertContractEligibility(contract,scope.snapshot.connection);assertProductAssetRelationships(contract,assetId,parameters,scope.snapshot.assets,permit.operationId);}
      if(INSTAGRAM_STORY_TOOLS.includes(contract.tool)&&this.provider==="META_INSTAGRAM_LOGIN"){
        const storyUrl=new URL('/'+productVersion(this.provider)+INSTAGRAM_STORY_PREFLIGHT.independent.path,HOSTS[this.provider]);storyUrl.searchParams.set('fields',INSTAGRAM_STORY_PREFLIGHT.independent.fields);await revalidateExecutionPermit(permit);productRateController.check(bucket);let proof:Response;try{proof=await this.fetcher(storyUrl,{method:'GET',redirect:'error',signal:AbortSignal.timeout(this.timeoutMs),headers:{Authorization:'Bearer '+token}});}catch{throw new ProductApiError(this.provider,0,null,null);}productRateController.observe(bucket,proof,null);const text=await readBodyWithLimit(proof,32000);let value:unknown;try{value=JSON.parse(text);}catch{throw new PlatformDenied('INSTAGRAM_STORY_EXACT_BUSINESS_ACCOUNT_REQUIRED');}if(!proof.ok)throw new PlatformDenied('INSTAGRAM_STORY_EXACT_BUSINESS_ACCOUNT_REQUIRED');assertInstagramStoryAccountType(this.provider,value,assetId,scope.snapshot.connection);await revalidateExecutionPermit(permit);assertContractEligibility(contract,scope.snapshot.connection);assertProductAssetRelationships(contract,assetId,parameters,scope.snapshot.assets,permit.operationId);
      }
      productRateController.check(bucket);
      if(messagingDeadline!==undefined&&(!Number.isSafeInteger(messagingDeadline)||Date.now()>=messagingDeadline))throw new PlatformDenied("MESSAGING_WINDOW_EXPIRED_BEFORE_EGRESS");
      if(publicationDeadline!==undefined&&(!Number.isSafeInteger(publicationDeadline)||Date.now()>=publicationDeadline))throw new PlatformDenied("THREADS_PUBLISHING_QUOTA_OBSERVATION_EXPIRED");
      if (contract.method !== "GET") claimMutationStep(permit);
      const bodyParameters=INSTAGRAM_IMAGE_VARIANT_TOOLS.includes(contract.tool)?instagramImageVariantBody(contract.tool,parameters):THREADS_IMAGE_TOOLS.includes(contract.tool)?threadsImageBody(contract.tool,parameters):INSTAGRAM_CAROUSEL_TOOLS.includes(contract.tool)?instagramCarouselBody(parameters):THREADS_CAROUSEL_TOOLS.includes(contract.tool)?threadsCarouselBody(parameters):THREADS_VIDEO_TOOLS.includes(contract.tool)?threadsVideoBody(contract.tool,parameters):INSTAGRAM_VIDEO_TOOLS.includes(contract.tool)?instagramVideoBody(contract.tool,parameters):MESSAGING_IMAGE_TOOLS.includes(contract.tool)?messagingImageBody(contract.tool,parameters):MESSENGER_TYPED_TOOLS.includes(contract.tool)?messengerTypedBody(contract.tool,parameters):preparedEvent?{data:[preparedEvent]}:contract.tool==="pages_create_photos"?{url:parameters.image_url}:contract.tool === "whatsapp_platform_send_message"?{messaging_product:"whatsapp",recipient_type:"individual",to:parameters.to,type:"text",text:{body:parameters.text,preview_url:false},messaging_account_id:messagingAccountId}:{...Object.fromEntries(Object.entries(parameters).filter(([key])=>!(contract.serverOnlyInputKeys??[]).includes(key))),...(contract.tool === "messenger_send_text" ? {messaging_type:"RESPONSE"} : {})};
      let response: Response;
      try { response = await this.fetcher(url,{method:contract.method,redirect:"error",signal:AbortSignal.timeout(this.timeoutMs),headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},...(contract.method !== "GET" ? {body:JSON.stringify(bodyParameters)} : {})}); }
      catch { throw new ProductApiError(this.provider,0,null,null); }
      if (response.status === 429) productRateController.observe(bucket,response,null);
      const text = await readBodyWithLimit(response,2_000_000);
      let body: unknown;
      try { body = JSON.parse(text); } catch { throw new ProductApiError(this.provider,response.status,null,null); }
      const error = body && typeof body === "object" && "error" in body ? body.error as {code?:unknown} : null;
      const code = error && typeof error.code === "number" ? error.code : null;
      productRateController.observe(bucket,response,code);
      const requestId = response.headers.get("x-fb-trace-id")?.slice(0,128) ?? null;
      if (!response.ok || error) throw new ProductApiError(this.provider,response.status,code,requestId);
      if (contract.method === "GET") await revalidateExecutionPermit(permit);
      if(MESSENGER_TYPED_TOOLS.includes(contract.tool)||MESSAGING_IMAGE_TOOLS.includes(contract.tool))return normalizeMessengerTypedReceipt(contract.tool,projectProviderResponse(body,contract),parameters);
      if(contract.tool==="catalog_list_assigned_users")return normalizeCatalogAssignedUsers(projectProviderResponse(body,contract));
      if(INSTAGRAM_MENTION_TOOLS.includes(contract.tool))return normalizeInstagramMention(contract.tool,projectProviderResponse(body,contract),assetId,parameters);
      if(contract.tool==="instagram_business_discovery")return normalizeInstagramBusinessDiscovery(projectProviderResponse(body,contract),assetId,parameters);
      if(contract.tool==="pages_get_insights")return normalizePageInsights(contract.tool,projectProviderResponse(body,contract));
      if(["instagram_get_insights","instagram_login_get_insights",...INSTAGRAM_MEDIA_INSIGHTS_TOOLS].includes(contract.tool))return normalizeInstagramInsights(contract.tool,assetId,projectProviderResponse(body,contract));
      if(contract.tool==="pages_create_photos")return normalizePagePhotoReceipt(projectProviderResponse(body,contract),assetId);
      if(["instagram_list_comments","instagram_login_list_comments"].includes(contract.tool))return normalizeInstagramCommentResponse(contract.tool,projectProviderResponse(body,contract));
      return normalizeProductResponse(contract.tool,normalizeLeadReadResponse(contract.tool,assetId,parameters,normalizeThreadsInsights(contract.tool,assetId,projectProviderResponse(body,contract)),scope.snapshot.assets),assetId,scope.snapshot.assets.filter(asset=>asset.type===(contract.provider==="META_MESSENGER"?"PAGE":"INSTAGRAM_ACCOUNT")).map(asset=>asset.id));
    });
  }
}
export class MarketingApiClient extends MetaGraphClient { constructor(fetcher?: typeof fetch) { super("META_MARKETING",fetcher); } }
export class InstagramClient extends MetaGraphClient { constructor(provider: "META_INSTAGRAM_LOGIN" | "META_INSTAGRAM_FACEBOOK_LOGIN",fetcher?: typeof fetch) { super(provider,fetcher); } }
export class ThreadsClient extends MetaGraphClient { constructor(fetcher?: typeof fetch) { super("META_THREADS",fetcher); } }
export class WhatsAppClient extends MetaGraphClient { constructor(fetcher?: typeof fetch) { super("META_WHATSAPP",fetcher); } }
export class MessengerClient extends MetaGraphClient { constructor(fetcher?: typeof fetch) { super("META_MESSENGER",fetcher); } }
