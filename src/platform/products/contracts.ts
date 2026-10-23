import {IMAGE_INSPECTION_CONTRACT,CREATIVE_IMAGE_INSPECTION_CONTRACT} from "../image-inspection-contract.js";
import {APP_EVENT_TYPES_CONTRACT} from "../app-event-types-contract.js";
import {VIDEO_INSPECTION_CONTRACT,CREATIVE_VIDEO_INSPECTION_CONTRACT} from "../video-inspection-contract.js";
import {CATALOG_CAMPAIGN_CONTRACT} from "../catalog-campaign-contract.js";
import {INVOICE_METADATA_CONTRACT} from "../business-invoice-contract.js";
import {CRM_SIGNAL_CONTRACT} from "../crm-contract.js";
import {CATALOG_OPERATIONAL_CONTRACTS} from "../catalog-operational-contracts.js";
import {PAGE_COMMENT_READ_CONTRACT} from "../page-comment-read-contract.js";
import {MARKETING_PREVIEW_CONTRACT} from "../marketing-preview-contract.js";
import {PURCHASE_CONVERSION_CONTRACT} from "../purchase-conversion-contract.js";
import {DATASET_READ_CONTRACT} from "../dataset-read-contract.js";
import {MARKETING_STUDY_CONTRACT} from "../marketing-study-contract.js";
import {MARKETING_RULE_CONTRACT} from "../marketing-rule-contract.js";
import {MARKETING_REPORT_CONTRACT} from "../marketing-report-contracts.js";
import {WHATSAPP_QR_CONTRACTS} from "../whatsapp-qr-contracts.js";
import {PAGE_REPLY_CONTRACT} from '../page-comment-reply.js';
import {MARKETING_CONTROL_CONTRACTS} from '../marketing-control-contracts.js';
import {AD_LIBRARY_CONTRACT} from "../ad-library-contract.js";
import {MARKETING_VIDEO_CONTRACT} from "../marketing-video-contract.js";
import {MARKETING_AUDIENCE_CONTRACTS} from "../marketing-audience-contracts.js";
import {MESSENGER_UTILITY_CONTRACTS} from "../messenger-utility-contracts.js";
import {MESSENGER_ATTACHMENT_CONTRACTS} from "../messaging-attachment-contracts.js";
import {INSTAGRAM_IMAGE_VARIANT_CONTRACTS} from "../instagram-image-variants.js";
import {reviewedEligibilityMetadata} from "../manual-eligibility-policies.js";
import {THREADS_IMAGE_CONTRACTS} from "../threads-image-contracts.js";
import {INSTAGRAM_CAROUSEL_CONTRACTS} from "../instagram-carousel-contracts.js";
import {THREADS_CAROUSEL_CONTRACTS} from "../threads-carousel-contracts.js";
import {THREADS_VIDEO_CONTRACTS} from "../threads-video-contracts.js";
import {MARKETING_IMAGE_CONTRACT} from "../marketing-image-contract.js";
import {INSTAGRAM_VIDEO_CONTRACTS} from "../instagram-video-contracts.js";
import {MESSAGING_IMAGE_CONTRACTS} from "../messaging-image.js";
import {LEAD_FORM_CONTRACT} from "../lead-form-contract.js";
import {WHATSAPP_SEND_CONTRACTS} from "../whatsapp-send-contracts.js";
import {OFFLINE_QUALITY_CONTRACT} from "../offline-quality-contract.js";
import {MESSENGER_TYPED_CONTRACTS} from "../messenger-typed.js";
import {PAGE_VIDEO_CONTRACT,PAGE_VIDEO_STATUS_CONTRACT} from "../page-video-contract.js";
import {OEMBED_CONTRACTS,OEMBED_TOOLS} from "../oembed-contracts.js";
import {CATALOG_ASSIGNED_USERS_CONTRACT} from "../catalog-assigned-users.js";
import {INSTAGRAM_MENTION_CONTRACTS,INSTAGRAM_MENTION_TOOLS} from "../instagram-mentions.js";
import {WHATSAPP_ANALYTICS_CONTRACTS} from "../whatsapp-analytics-contracts.js";
import {THREADS_DISCOVERY_CONTRACTS} from "../threads-discovery-contracts.js";
import {INSTAGRAM_HASHTAG_CONTRACT} from "../instagram-hashtag-contract.js";
import {INSTAGRAM_BUSINESS_DISCOVERY_CONTRACT} from "../instagram-business-discovery.js";
import {PAGE_INSIGHTS_CONTRACT} from "../page-insights.js";
import {INSTAGRAM_INSIGHTS_CONTRACTS} from "../instagram-insights.js";
import {INSTAGRAM_COMMENT_CONTRACTS} from "../instagram-comments.js";
import {WHATSAPP_PHONE_CONTRACTS} from "../whatsapp-phone-contracts.js";
import {WHATSAPP_TEMPLATE_CONTRACTS} from "../whatsapp-template-contracts.js";
import {WHATSAPP_SUBSCRIPTION_CONTRACTS} from "../whatsapp-subscription-contracts.js";
import {WHATSAPP_FLOW_CONTRACTS} from "../whatsapp-flow-contracts.js";
import type { AssetType, Connection, OperationClass, Provider } from "../models.js";
import { expandVerifiedPermissionDependencies, PERMISSION_DEPENDENCY_SOURCE } from "./permission-dependencies.js";

export interface ProductContract {
  eligibilityRequirements?:string[];
  eligibilityPolicies?:Record<string,import("../manual-eligibility.js").ManualRequirementPolicy>;
  authMode?:"TOKENLESS_FRONTEND_ONLY";
  id: string;
  tool: string;
  provider: Provider;
  product: string;
  title: string;
  method: "GET" | "POST" | "DELETE";
  path: string;
  assetType: AssetType;
  operationClasses: OperationClass[];
  requiredScopes: string[];
  tokenTypes: Connection["tokenType"][];
  requiredTasks?: string[];
  requiredTaskAssetType?: AssetType;
  allowedInputKeys: string[];
  serverOnlyInputKeys?: string[];
  fixedQuery?: Record<string, string>;
  pagination?: boolean;
  responseFields?: string[];
  assetInputKeys?: Record<string, AssetType>;
  assetInputArrayKeys?: Record<string, AssetType>;
  documentation: string[];
  verified: boolean;
  unverifiedReason?: string;
  requiresMessagingWindow?: boolean;
  createOrCopy?: boolean;
  createdAssetType?: AssetType;
  createdAssetKind?: "instagram_container" | "instagram_published_media" | "instagram_reel_container" | "instagram_story_container" | "instagram_carousel_item" | "instagram_carousel_container" | "threads_image_container" | "threads_video_container" | "threads_carousel_item" | "threads_carousel_container";
  returnedAssetType?: AssetType;
  privateResponse?: "client_inbox" | "client_leads" | "client_comments";
  requiresClientOwnedBusiness?: boolean;
  assetEvidenceUpdate?: "threads_container" | "threads_reply_list" | "instagram_container";
  manualRequirements: string[];
}

const SOURCES = {
  business: "https://developers.facebook.com/docs/marketing-api/business-asset-management/",
  pages: "https://developers.facebook.com/docs/pages-api/",
  instagram: "https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-ab559ffb-8e2c-4b0a-b43a-5737b6d2f672",
  instagramLogin: "https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login",
  messenger: "https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages",
  conversations: "https://www.postman.com/meta/messenger-platform-api/folder/22794852-255610cd-47f5-4f4d-b3fa-71aec360be9a",
  threads: "https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api",
  whatsapp: "https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api",
  leads: "https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/",
  signals: "https://developers.facebook.com/docs/marketing-api/conversions-api/",
  catalog: "https://developers.facebook.com/docs/marketing-api/catalog/",
  oembed: "https://developers.facebook.com/docs/plugins/oembed/",
} as const;

const RESPONSE_PROJECTIONS: Record<string, string[]> = {
  ...Object.fromEntries(MESSENGER_TYPED_CONTRACTS.map(c=>[c.tool,c.responseFields!])),
  ...Object.fromEntries([...MESSENGER_UTILITY_CONTRACTS,...MESSENGER_ATTACHMENT_CONTRACTS].map(c=>[c.tool,c.responseFields!])),
  ...Object.fromEntries(WHATSAPP_SEND_CONTRACTS.map(c=>[c.tool,c.responseFields!])),
  ...Object.fromEntries(MESSAGING_IMAGE_CONTRACTS.map(c=>[c.tool,c.responseFields!])),
  ...Object.fromEntries(INSTAGRAM_VIDEO_CONTRACTS.map(c=>[c.tool,c.responseFields!])),
  ...Object.fromEntries(THREADS_VIDEO_CONTRACTS.map(c=>[c.tool,c.responseFields!])),
  ...Object.fromEntries([...INSTAGRAM_CAROUSEL_CONTRACTS,...THREADS_CAROUSEL_CONTRACTS].map(c=>[c.tool,c.responseFields!])),
  ...Object.fromEntries(THREADS_IMAGE_CONTRACTS.map(c=>[c.tool,c.responseFields!])),
  ...Object.fromEntries(INSTAGRAM_IMAGE_VARIANT_CONTRACTS.map(c=>[c.tool,c.responseFields!])),
  marketing_upload_image:MARKETING_IMAGE_CONTRACT.responseFields!,
  leads_create_form:LEAD_FORM_CONTRACT.responseFields!,
  marketing_create_classic_split_study:MARKETING_STUDY_CONTRACT.responseFields!,
  marketing_create_disabled_pause_rule:MARKETING_RULE_CONTRACT.responseFields!,
  pages_list_comments:PAGE_COMMENT_READ_CONTRACT.responseFields!,
  ...Object.fromEntries(CATALOG_OPERATIONAL_CONTRACTS.map(c=>[c.tool,c.responseFields!])),
  signals_send_crm_lead_event:CRM_SIGNAL_CONTRACT.responseFields!,
  marketing_list_client_invoice_metadata:INVOICE_METADATA_CONTRACT.responseFields!,
  marketing_inspect_creative_video:CREATIVE_VIDEO_INSPECTION_CONTRACT.responseFields!,
  marketing_list_app_event_types:APP_EVENT_TYPES_CONTRACT.responseFields!,
  marketing_inspect_image:IMAGE_INSPECTION_CONTRACT.responseFields!,
  marketing_inspect_creative_image:CREATIVE_IMAGE_INSPECTION_CONTRACT.responseFields!,
  marketing_inspect_video:VIDEO_INSPECTION_CONTRACT.responseFields!,
  catalog_get_campaign_input_diagnostics:CATALOG_CAMPAIGN_CONTRACT.responseFields!,
  marketing_get_ad_preview:MARKETING_PREVIEW_CONTRACT.responseFields!,
  marketing_create_purchase_conversion:PURCHASE_CONVERSION_CONTRACT.responseFields!,
  signals_get_dataset:DATASET_READ_CONTRACT.responseFields!,
  marketing_create_async_report:MARKETING_REPORT_CONTRACT.responseFields!,
  marketing_upload_video:MARKETING_VIDEO_CONTRACT.responseFields!,
  marketing_search_ad_library:AD_LIBRARY_CONTRACT.responseFields!,
  ...Object.fromEntries([...MARKETING_AUDIENCE_CONTRACTS,...MARKETING_CONTROL_CONTRACTS].map(c=>[c.tool,c.responseFields!])),
  signals_get_offline_quality:OFFLINE_QUALITY_CONTRACT.responseFields!,
  pages_create_videos:PAGE_VIDEO_CONTRACT.responseFields!,
  pages_get_video_status:PAGE_VIDEO_STATUS_CONTRACT.responseFields!,
  ...Object.fromEntries(OEMBED_CONTRACTS.map(c=>[c.tool,c.responseFields!])),
  catalog_list_assigned_users:CATALOG_ASSIGNED_USERS_CONTRACT.responseFields!,
  ...Object.fromEntries(INSTAGRAM_MENTION_CONTRACTS.map(c=>[c.tool,c.responseFields!])),
  ...Object.fromEntries(WHATSAPP_ANALYTICS_CONTRACTS.map(c=>[c.tool,c.responseFields!])),
  ...Object.fromEntries(THREADS_DISCOVERY_CONTRACTS.map(c=>[c.tool,c.responseFields!])),
  instagram_hashtag_search:INSTAGRAM_HASHTAG_CONTRACT.responseFields!,
  instagram_business_discovery:INSTAGRAM_BUSINESS_DISCOVERY_CONTRACT.responseFields!,
  pages_get_insights:PAGE_INSIGHTS_CONTRACT.responseFields!,
  ...Object.fromEntries(INSTAGRAM_INSIGHTS_CONTRACTS.map(c=>[c.tool,c.responseFields!])),
  ...Object.fromEntries(INSTAGRAM_COMMENT_CONTRACTS.map(c=>[c.tool,c.responseFields!])),
  ...Object.fromEntries([...WHATSAPP_PHONE_CONTRACTS,...WHATSAPP_QR_CONTRACTS].map(c=>[c.tool,c.responseFields!])),
  ...Object.fromEntries(WHATSAPP_TEMPLATE_CONTRACTS.map(c=>[c.tool,c.responseFields!])),
  leads_list_forms:["data.id","data.name","data.status","data.created_time","data.page_id"],
  leads_get_form:["id","name","status","created_time","page_id"],
  leads_retrieve:["data.id","data.created_time","data.ad_id","data.form_id","data.field_data.name","data.field_data.values","paging.cursors.before","paging.cursors.after"],
  ...Object.fromEntries(WHATSAPP_SUBSCRIPTION_CONTRACTS.map(c=>[c.tool,c.responseFields!])),
  pages_list_posts:["data.id","data.created_time","data.is_published"],
  pages_list_published_posts:["data.id","data.created_time","data.is_published"],
  pages_list_scheduled_posts:["data.id","data.created_time","data.is_published"],
  pages_get_subscriptions:["data.id","data.name"],
  ...Object.fromEntries(WHATSAPP_FLOW_CONTRACTS.map(c=>[c.tool,c.responseFields!])),
  threads_list_insights:["data.id","data.name","data.period","data.values.value","data.values.end_time"],
  threads_get_post_insights:["data.id","data.name","data.period","data.values.value","data.values.end_time"],
  instagram_get_profile:["id","username","name","followers_count","media_count"],
  instagram_login_profile:["id","username","name","followers_count","media_count"],
  instagram_list_media:["data.id"],
  instagram_login_list_media:["data.id","paging.cursors.before","paging.cursors.after"],
  business_get: ["id", "name"],
  business_list_owned_wabas: ["data.id", "data.name"],
  business_list_client_catalogs: ["data.id", "data.name"],
  business_list_owned_catalogs: ["data.id", "data.name"],
  business_list_client_ad_accounts: ["data.id", "data.name"],
  business_list_owned_ad_accounts: ["data.id", "data.name"],
  business_list_client_pages: ["data.id", "data.name"],
  business_list_owned_pages: ["data.id", "data.name"],
  business_list_users: ["data.id", "data.name", "data.role"],
  business_list_system_users: ["data.id", "data.name"],
  catalog_list_products: ["data.id", "data.name", "data.category"],
  catalog_list_product_sets: ["data.id", "data.name", "data.product_count"],
  catalog_list_product_feeds: ["data.id", "data.name", "data.product_count", "data.country", "data.default_currency"],
  pages_list_feed: ["data.id", "data.created_time", "data.is_published"],
  pages_create_feed: ["id"],
  pages_edit_post:["success"],
  pages_create_photos:["id","post_id"],
  pages_get: ["id", "name", "fan_count"],
  pages_reply_comment: ["id"],
  pages_hide_comment: ["success"],
  pages_delete_comment: ["success"],
  instagram_login_conversations: ["data.id", "data.updated_time"],
  instagram_login_get_messages: ["id", "messages.data.id", "messages.data.created_time"],
  instagram_list_conversations: ["data.id", "data.updated_time"],
  messenger_list_conversations: ["data.id", "data.updated_time"],
  messenger_get_messages: ["id", "messages.data.id", "messages.data.created_time"],
  messenger_send_text: ["recipient_id", "message_id"],
  messenger_get_message: ["id", "created_time", "from.id", "to.data.id", "message"],
  instagram_get_message: ["id", "created_time", "from.id", "to.data.id", "message"],
  instagram_login_get_message: ["id", "created_time", "from.id", "to.data.id", "message"],
  instagram_create_container: ["id"],
  instagram_login_create_container: ["id"],
  instagram_publish_container: ["id", "config_issue", "caption_add_on_attachment_status"],
  instagram_login_publish: ["id", "config_issue", "caption_add_on_attachment_status"],
  instagram_get_container_status: ["id", "status_code"],
  instagram_login_get_container_status: ["id", "status_code"],
  threads_get_profile: ["id", "username", "name", "is_verified"],
  threads_list_threads: ["data.id", "data.media_type", "data.timestamp", "paging.cursors.before", "paging.cursors.after"],
  threads_get_post: ["id", "media_type", "timestamp"],
  threads_create_container: ["id"],
  threads_publish_container: ["id"],
  threads_get_post_status: ["id", "status"],
  threads_delete_post: ["success", "deleted_id"],
  threads_manage_reply: ["success"],
  threads_manage_pending_reply: ["success"],
  threads_list_replies: ["data.id", "data.timestamp", "data.media_type", "data.is_reply", "data.is_reply_owned_by_me", "data.hide_status", "data.root_post.id", "data.replied_to.id"],
  threads_get_conversation: ["data.id", "data.timestamp", "data.media_type", "data.is_reply", "data.is_reply_owned_by_me", "data.hide_status", "data.root_post.id", "data.replied_to.id"],
  threads_list_pending_replies: ["data.id", "data.is_reply", "data.hide_status", "data.root_post.id", "data.replied_to.id", "data.reply_approval_status"],
  threads_list_threads_publishing_limit: ["data.reply_quota_usage", "data.reply_config.quota_total", "data.reply_config.quota_duration"],
  whatsapp_platform_send_message: ["messages.id", "messaging_product"],
  signals_send_pixel_events: ["events_received"],
  leads_get_lead: ["id", "created_time"],
};

function hold(
  product: string, tool: string, provider: Provider, assetType: AssetType,
  method: ProductContract["method"], path: string, scopes: string[],
  operationClasses: OperationClass[], documentation: string,
  reason = "UNVERIFIED: current endpoint-specific minimum permissions, token/task requirements and eligibility require primary-document verification; no execution is enabled.",
): ProductContract {
  return {
    id: tool.replaceAll("_", "."), tool, provider, product,
    title: tool.replaceAll("_", " "), method, path, assetType,
    operationClasses, requiredScopes: scopes, tokenTypes: [], allowedInputKeys: [],
    documentation: [documentation], verified: false, unverifiedReason: reason,
    manualRequirements: ["Confirm current product setup, applicable App Review/access level, operator consent and client asset grant independently."],
  };
}

function confirmed(contract: ProductContract, evidence: Pick<ProductContract, "requiredScopes" | "tokenTypes" | "requiredTasks" | "allowedInputKeys" | "documentation" | "manualRequirements">): ProductContract {
  const result = { ...contract, ...evidence, responseFields: RESPONSE_PROJECTIONS[contract.tool], verified: true };
  delete result.unverifiedReason;
  return result;
}

const WHATSAPP_READ_REQUIREMENTS = [
  "The connection has independently verified access to both the client-owned WhatsApp account and its linked client-owned Messaging account; do not rely on interim API grant cascading.",
  "Tech Provider client access uses a customer-scoped Business Integration System User token obtained through Embedded Signup; system_user is limited to independently verified direct-developer own-business context.",
  "External customer data requires App Review and Advanced Access for whatsapp_business_management; documentation evidence alone does not prove Lumin approval.",
  "Legacy WABA_ID in these endpoints identifies the Messaging account; verify the account-model mapping and same-client WhatsApp-account parent before execution. Client billing remains on the client's Messaging account.",
];

function businessRead(tool: string, path: string, fields: string): ProductContract {
  return { ...confirmed(hold("business", tool, "META_BUSINESS", "BUSINESS", "GET", path, [], ["READ"], SOURCES.business), {
    requiredScopes: ["business_management"], tokenTypes: ["user"], allowedInputKeys: [],
    documentation: ["https://developers.facebook.com/docs/business-management-apis/business-manager/get-started"],
    manualRequirements: ["The registered target is this client's own business, not an agency-wide business aggregating other clients. Business membership and exact client-owned target authorization must be independently verified.", "App and user both require business_management and the appropriate Marketing API access tier. External customer access and any required Advanced Access must be independently verified; business_users explicitly requires Advanced Access.", "This initial read uses a user token and server-fixed metadata fields only. Do not return email addresses, finance data, tokens or unrelated client inventory. Additional system-user token strategies remain unverified."],
  }), fixedQuery: { fields }, requiresClientOwnedBusiness: true };
}

function catalogRead(edge: string, fields: string, nodeDocumentation: string): ProductContract {
  return { ...confirmed(hold("catalog", `catalog_list_${edge}`, "META_BUSINESS", "CATALOG", "GET", `/{asset_id}/${edge}`, [], ["READ"], SOURCES.catalog), {
    requiredScopes: ["catalog_management"], tokenTypes: ["user"], requiredTasks: ["MANAGE"], allowedInputKeys: [],
    documentation: ["https://developers.facebook.com/documentation/ads-commerce/catalog/get-started", `https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/product-catalog/${edge}`, nodeDocumentation],
    manualRequirements: ["catalog_management permits reading business-owned catalogs of which the user is an admin; independently verify MANAGE catalog task, customer authorization and exact client catalog grant.", "Developer-mode access is limited to catalogs owned by app admins/developers. Appropriate Marketing API access level, any required external-user approval and previously accepted catalog terms must be independently verified; this tool does not accept terms or create a catalog.", "Metadata-only user-token read with fixed fields; no feed schedules, source URLs, passwords, raw filter objects or arbitrary field expansion. Returned child IDs establish inventory only and do not grant write authorization.", "For feeds, the user must be an employee of the business or an employee of an agency assigned to that business. No cross-client agency catalog aggregate is used as the target."],
  }), fixedQuery: { fields }, returnedAssetType: edge === "product_sets" ? "PRODUCT_SET" : edge === "product_feeds" ? "FEED" : "PRODUCT_ITEM" };
}

function pageComment(tool: string, method: ProductContract["method"], path: string, inputs: string[]): ProductContract {
  return confirmed(hold("pages", tool, "META_FACEBOOK_PAGES", "COMMENT", method, path, [], [method === "DELETE" ? "DELETE" : "WRITE_CONTENT"], SOURCES.pages), {
    requiredScopes: ["pages_manage_engagement", "pages_read_engagement"], tokenTypes: ["page"], requiredTasks: ["MODERATE", "CREATE_CONTENT"], allowedInputKeys: inputs,
    documentation: ["https://developers.facebook.com/documentation/pages-api", "https://developers.facebook.com/documentation/pages-api/comments-mentions", "https://developers.facebook.com/docs/graph-api/reference/comment/", PERMISSION_DEPENDENCY_SOURCE],
    manualRequirements: ["Resolve comment ancestry to the exact registered client Page and Page-token subject; unpublished Pages cannot receive comments. External-user App Review/Advanced Access must be independently verified.", "Current comments guide contains pages_read_user_engagement, absent from the newer Permissions Reference. Use the verified pages_manage_engagement dependencies pages_read_user_content/pages_show_list plus conservative pages_read_engagement; never request the misspelled scope.", "Initial task subset requires MODERATE and CREATE_CONTENT as listed in the current comments guide; this does not claim both are universal minima for every moderation operation.", "Replies are Page-authored text only, locally capped at 2000 characters. Mentions, private replies, attachments and caller identities are excluded. Each moderation write needs exact-plan approval; deletions are irreversible."],
  });
}

function threadsReplies(tool: string, path: string): ProductContract {
  return { ...confirmed(hold("threads", tool, "META_THREADS", "POST", "GET", path, [], ["READ"], SOURCES.threads), {
    requiredScopes: ["threads_basic", "threads_read_replies"], tokenTypes: ["threads"], allowedInputKeys: [],
    documentation: ["https://developers.facebook.com/documentation/threads/retrieve-and-manage-replies", "https://developers.facebook.com/documentation/threads/retrieve-and-manage-replies/replies-and-conversations"],
    manualRequirements: ["Resolve the target root post to the authenticated client's Threads account. Reply retrieval is limited to the user's own Threads; no public discovery or unrelated user's post is authorized.", "Fixed reply ancestry/status metadata only. /replies returns immediate replies; /conversation is only intended for root-level posts and returns all depths. Nested reply IDs do not independently grant moderation rights.", "External user access and required permission approval must be independently verified. This initial subset does not expose user text or arbitrary fields."],
  }), fixedQuery: { fields: "id,timestamp,media_type,is_reply,is_reply_owned_by_me,hide_status,root_post,replied_to" }, assetEvidenceUpdate: "threads_reply_list" };
}

function threadsModeration(tool: string, edge: string, key: string): ProductContract {
  return confirmed(hold("threads", tool, "META_THREADS", "POST", "POST", `/{asset_id}/${edge}`, [], ["WRITE_CONTENT"], SOURCES.threads), {
    requiredScopes: ["threads_basic", "threads_manage_replies"], tokenTypes: ["threads"], allowedInputKeys: [key],
    documentation: ["https://developers.facebook.com/documentation/threads/retrieve-and-manage-replies", "https://developers.facebook.com/documentation/threads/reply-management"],
    manualRequirements: ["Trusted fresh reply evidence must resolve to this client's registered root post and authenticated Threads account; missing provenance is HOLD. External user permission approval must be independently verified.", "Hiding/unhiding only targets top-level replies and cascades to nested replies; isolated nested-reply hiding is forbidden. Pending approval actions require independently verified pending/ignored status.", "Only the explicit boolean moderation action is accepted, with its own exact-plan approval. No posting, automatic approval, reply text, private messaging or unrelated account moderation is enabled."],
  });
}

function inboxMessage(tool: string, provider: Provider): ProductContract {
  const instagramLogin = provider === "META_INSTAGRAM_LOGIN";
  const scopes = instagramLogin ? ["instagram_business_basic", "instagram_business_manage_messages"] : provider === "META_MESSENGER" ? ["pages_manage_metadata", "pages_read_engagement", "pages_messaging"] : ["instagram_basic", "instagram_manage_messages", "pages_manage_metadata"];
  return { ...confirmed(hold(provider === "META_MESSENGER" ? "messenger" : "instagram", tool, provider, "MESSAGE", "GET", "/{asset_id}", [], ["READ"], SOURCES.conversations), {
    requiredScopes: scopes, tokenTypes: [instagramLogin ? "instagram" : "page"], requiredTasks: instagramLogin ? [] : ["MESSAGING"], allowedInputKeys: [],
    documentation: [instagramLogin ? "https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api" : "https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversations"],
    manualRequirements: ["The registered MESSAGE must have exactly one same-client CONVERSATION parent resolving to the exact authenticated Page or Instagram professional account. A caller message ID or returned participant ID does not establish authority.", "Only details for the 20 most recent conversation messages are available. Older-message 'deleted' errors do not prove actual user deletion; do not fabricate unread or delivery state.", "External customer conversation access requires Advanced Access; Instagram Facebook Login additionally requires app ownership by a verified business. User/linked Page messaging authority must be independently verified.", "Return only scoped participant IDs, timestamp and bounded text. The trusted response normalizer must redact credential-shaped content, cap text at 2000 UTF-8 bytes, explicitly mark truncation and exclude usernames, attachments, URLs and whole objects. No message text enters persistent audit, registry or logs."],
  }), fixedQuery: { fields: "id,created_time,from,to,message" }, privateResponse: "client_inbox" };
}

function instagramMetadataRead(tool:string,provider:Provider,list:boolean):ProductContract{
 const login=provider==="META_INSTAGRAM_LOGIN";
 return {...confirmed(hold("instagram",tool,provider,"INSTAGRAM_ACCOUNT","GET",list?"/{asset_id}/media":"/{asset_id}",[],["READ"],SOURCES.instagram),{
 requiredScopes:login?["instagram_business_basic"]:["instagram_basic","pages_read_engagement","ads_management","business_management"],tokenTypes:[login?"instagram":"user"],allowedInputKeys:[],
 documentation:["https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user",list?"https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media":"https://developers.facebook.com/documentation/development/permissions",...(login?["https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started"]:[])],
 manualRequirements:["Only the authorized client's exact registered Instagram professional account is queried; app-scoped id and professional user_id are distinct and must never be guessed or used to create aliases or grants.","External customer accounts require independently verified Advanced Access/app review and current authorized user authority. Facebook Login uses a Facebook User token, not the Page-token messaging credential; Business Manager roles conservatively require both ads_management and business_management although endpoint references permit alternatives.",list?"Return only media IDs from this account. IDs do not enroll child assets, establish readiness or authorize writes. Story media is excluded; Facebook listing is limited to the most recent 10K and this initial bounded subset exposes no caller time-range parameters.":"Return only profile ID, professional username/name and follower/media counts; no private contact, biography, profile picture or arbitrary field expansion."],
 }),...(list?{}:{fixedQuery:{fields:"id,username,name,followers_count,media_count"}}),...(list&&login?{pagination:true}:{})};
}

function threadsInsights(tool:string,post:boolean):ProductContract{
 return {...confirmed(hold("threads",tool,"META_THREADS",post?"POST":"THREADS_ACCOUNT","GET",post?"/{asset_id}/insights":"/{asset_id}/threads_insights",[],["READ"],SOURCES.threads),{
 requiredScopes:["threads_basic","threads_manage_insights"],tokenTypes:["threads"],allowedInputKeys:[],documentation:["https://developers.facebook.com/documentation/threads/insights"],manualRequirements:["Only this client's registered authenticated Threads account and its registered own posts may be queried. External App Review/Advanced Access and account authority must be independently verified.","Account views use the provider's default yesterday-through-today window. Post likes/replies/reposts/quotes/shares are lifetime metrics; never conflate these periods or infer outcome proof from estimates.","The strict response normalizer must validate the exact requested asset, requested metric names, documented period and bounded numeric values before returning data. No caller arbitrary metrics, dates or field expansion."],
 }),fixedQuery:{metric:post?"likes,replies,reposts,quotes,shares":"views"}};
}

function pageMetadataRead(edge:"posts"|"published_posts"|"scheduled_posts"|"subscribed_apps"):ProductContract{
 const subscription=edge==="subscribed_apps",tool=subscription?"pages_get_subscriptions":`pages_list_${edge}`;
 return {...confirmed(hold("pages",tool,"META_FACEBOOK_PAGES","PAGE","GET",`/{asset_id}/${edge}`,[],["READ"],SOURCES.pages),{
 requiredScopes:subscription?["pages_manage_metadata","pages_show_list"]:["pages_read_engagement","pages_read_user_content"],tokenTypes:["page"],requiredTasks:["CREATE_CONTENT"],allowedInputKeys:[],
 documentation:[`https://developers.facebook.com/docs/graph-api/reference/page/${edge==="posts"?"feed":edge}/`,"https://developers.facebook.com/docs/graph-api/reference/page","https://developers.facebook.com/documentation/development/permissions"],
 manualRequirements:["Only the exact registered client's Page represented by the Page token is queried, with current external-user access approval and managed-Page authority independently verified. No public-content-access or other Page token fallback.","This initial literal task subset is CREATE_CONTENT; documented MANAGE/MODERATE alternatives are not fabricated aliases or an all-of requirement.",subscription?"Return only subscribed Application ID/name metadata. This read does not change app/Page subscriptions, prove field-level webhook coverage or prove delivery. Instagram webhook fields require the app dashboard and cannot be configured using this Page edge.":"Return only PagePost IDs, creation time and publication flag; no commenter identities, media URLs, raw post text or arbitrary field expansion. Published listing is ranked/approximately 600 posts per year; an empty or bounded result is not complete history. Scheduled listing is observation only and does not enable scheduling writes or establish readiness."],
 }),fixedQuery:{fields:subscription?"id,name":"id,created_time,is_published"}};
}

function leadRead(tool:"leads_list_forms"|"leads_get_form"|"leads_retrieve"):ProductContract{
 const list=tool==="leads_list_forms",retrieve=tool==="leads_retrieve";
 return {...confirmed(hold("leads",tool,"META_MARKETING",list?"PAGE":"LEAD_FORM","GET",list?"/{asset_id}/leadgen_forms":retrieve?"/{asset_id}/leads":"/{asset_id}",[],["READ"],SOURCES.leads),{
 requiredScopes:["ads_management","leads_retrieval","pages_show_list","pages_read_engagement","pages_manage_ads"],tokenTypes:["page","user"],allowedInputKeys:retrieve?["ad_id","created_since","created_until"]:[],documentation:["https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving","https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/leadgenform.py",...(list?["https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py"]:[])],
 manualRequirements:["Use the conservative documented full lead/ad-data permission pack and a Page/User token requested by a person authorized to advertise on the client's Page and ad account. Current Leads Access Manager assignment must be independently verified; Page administrator status does not establish customized leads access.","External-user app review/Advanced Access and Ads Management Standard Access are independently verified feature gates, never fabricated OAuth scopes.",retrieve?"The target registered form, linked Page, client ad account and separately selected registered ad must have fresh same-client grants. ad_id is a server-only authority reference and never becomes a provider query parameter. Other-ad, organic, preview and foreign-form rows are withheld; returned lead IDs do not create grants.":"Form metadata remains confined to this client's registered Page. SDK node/edge method and fields are primary evidence; permission pack is conservative sufficient lead-access authority, not a claim of endpoint-specific universal minimum scopes. Form listing does not enroll children or renew their evidence.",retrieve?"Return at most 100 selected-ad leads, 50 fields each and 10 string answers per field. Text is bounded to 2000 UTF-8 bytes with explicit truncation/credential-redaction flags. Answer text additionally has a 64 KiB aggregate cap. Optional created_since/created_until are paired Unix-second local filters (maximum 31 days, within local 90-day history policy), never provider query parameters; current-page results remain explicitly incomplete. No answers enter persistent registry, audits, logs or receiving adapters; disclaimer responses and marketing opt-in are not inferred.":"Return ID/name/status/created_time/page_id only; omit form questions, legal text, private answers, URLs and whole objects."],
 }),fixedQuery:{fields:retrieve?"created_time,id,ad_id,form_id,field_data":"id,name,status,created_time,page_id"},...(retrieve?{privateResponse:"client_leads" as const,assetInputKeys:{ad_id:"AD" as const},serverOnlyInputKeys:["ad_id","created_since","created_until"],pagination:true}:{})};
}

function instagramPublishing(tool: string, provider: Provider, method: ProductContract["method"], assetType: AssetType, path: string, input: string[]): ProductContract {
  const login = provider === "META_INSTAGRAM_LOGIN";
  return confirmed(hold("instagram", tool, provider, assetType, method, path, [], [method === "GET" ? "READ" : "WRITE_CONTENT"], SOURCES.instagram), {
    requiredScopes: login ? ["instagram_business_basic", "instagram_business_content_publish"] : ["instagram_basic", "instagram_content_publish", "pages_read_engagement", "ads_read"], tokenTypes: [login ? "instagram" : "user"], requiredTasks: login ? [] : ["CREATE_CONTENT"], ...(login?{}:{requiredTaskAssetType:"PAGE" as const}), allowedInputKeys: input,
    documentation: ["https://developers.facebook.com/documentation/instagram-platform/content-publishing", "https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media", "https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish", "https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container", "https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit"],
    manualRequirements: ["Only the registered authenticated client's Instagram professional account and exact linked Page/user authority may be used. External customer Advanced Access, applicable app approval, Page Publishing Authorization and required 2FA must be independently verified.", "Newest September 28 User Media/Media Publish references require Facebook User tokens; older June guide says Page token. This initial Facebook content subset uses the newer User-token strategy and CREATE_CONTENT task; do not silently reuse the Page-token messaging credential. Agency Business Manager context conservatively includes both ads_management and ads_read although node references allow one of them.", "Draft creation accepts only a trusted approved client JPEG source with successful decoder proof, payload-bound publication rights, immutable content-addressed URL, MIME/size/dimensions, fresh evidence and truthful AI disclosure. No URL extension inference or raw model-provided media grant is accepted.", "Publishing is separate from draft creation and requires fresh FINISHED/unpublished same-account container evidence plus a durable one-shot claim. Live quota must be read immediately before egress and limited to the lower of provider quota and Lumin's conservative 50 per rolling 24 hours; documentation also mentions 100.", "JPEG-only initial subset: up to 8 MiB, aspect ratio 0.8 through 1.91, width already 320 through 1440 as local no-rescale policy. Video, carousels, tags, collaborators, partnership labels, polls and comment prompts are excluded.", "Provider config_issue/caption_add_on_attachment_status indicates published partial success. Register actual media, report PARTIAL/reconciliation and never automatically retry a publication or uncertain transport outcome."],
  });
}

export const PRODUCT_CONTRACTS: readonly ProductContract[] = Object.freeze(([
  ...WHATSAPP_FLOW_CONTRACTS,
  ...WHATSAPP_TEMPLATE_CONTRACTS,
  ...WHATSAPP_SUBSCRIPTION_CONTRACTS,
  inboxMessage("messenger_get_message", "META_MESSENGER"),
  inboxMessage("instagram_get_message", "META_INSTAGRAM_FACEBOOK_LOGIN"),
  inboxMessage("instagram_login_get_message", "META_INSTAGRAM_LOGIN"),
  businessRead("business_get", "/{asset_id}", "id,name"),
  { ...businessRead("business_list_owned_pages", "/{asset_id}/owned_pages", "id,name"), requiredScopes:["business_management","ads_management","pages_read_engagement"], returnedAssetType:"PAGE", documentation:["https://developers.facebook.com/docs/business-management-apis/businessmanager/support#faq_439412163553622","https://developers.facebook.com/docs/business-management-apis/business-asset-management/guides/pages","https://github.com/facebook/facebook-business-sdk-codegen/blob/main/api_specs/specs/Business.json"], manualRequirements:[...businessRead("business_list_owned_pages", "/{asset_id}/owned_pages", "id,name").manualRequirements,"Only separately registered same-client child inventory is returned. Provider-returned IDs do not enroll assets, renew ownership or establish billing; unregistered or foreign child rows are withheld."] },
  { ...businessRead("business_list_client_pages", "/{asset_id}/client_pages", "id,name"), requiredScopes:["business_management","ads_management","pages_read_engagement"], returnedAssetType:"PAGE", documentation:["https://developers.facebook.com/docs/business-management-apis/businessmanager/support#faq_439412163553622","https://developers.facebook.com/docs/business-management-apis/business-asset-management/guides/pages","https://github.com/facebook/facebook-business-sdk-codegen/blob/main/api_specs/specs/Business.json"], manualRequirements:[...businessRead("business_list_client_pages", "/{asset_id}/client_pages", "id,name").manualRequirements,"Only separately registered same-client child inventory is returned. Provider-returned IDs do not enroll assets, renew ownership or establish billing; unregistered or foreign child rows are withheld."] },
  { ...businessRead("business_list_owned_ad_accounts", "/{asset_id}/owned_ad_accounts", "id,name"), requiredScopes:["business_management","ads_management","pages_read_engagement"], returnedAssetType:"AD_ACCOUNT", documentation:["https://developers.facebook.com/docs/business-management-apis/businessmanager/support#faq_439412163553622","https://developers.facebook.com/docs/business-management-apis/business-asset-management/guides/ad-accounts","https://github.com/facebook/facebook-business-sdk-codegen/blob/main/api_specs/specs/Business.json"], manualRequirements:[...businessRead("business_list_owned_ad_accounts", "/{asset_id}/owned_ad_accounts", "id,name").manualRequirements,"Only separately registered same-client child inventory is returned. Provider-returned IDs do not enroll assets, renew ownership or establish billing; unregistered or foreign child rows are withheld."] },
  { ...businessRead("business_list_client_ad_accounts", "/{asset_id}/client_ad_accounts", "id,name"), requiredScopes:["business_management","ads_management","pages_read_engagement"], returnedAssetType:"AD_ACCOUNT", documentation:["https://developers.facebook.com/docs/business-management-apis/businessmanager/support#faq_439412163553622","https://developers.facebook.com/docs/business-management-apis/business-asset-management/guides/ad-accounts","https://github.com/facebook/facebook-business-sdk-codegen/blob/main/api_specs/specs/Business.json"], manualRequirements:[...businessRead("business_list_client_ad_accounts", "/{asset_id}/client_ad_accounts", "id,name").manualRequirements,"Only separately registered same-client child inventory is returned. Provider-returned IDs do not enroll assets, renew ownership or establish billing; unregistered or foreign child rows are withheld."] },
  { ...businessRead("business_list_owned_catalogs", "/{asset_id}/owned_product_catalogs", "id,name"), requiredScopes:["business_management","ads_management","pages_read_engagement"], returnedAssetType:"CATALOG", documentation:["https://developers.facebook.com/docs/business-management-apis/businessmanager/support#faq_439412163553622","https://developers.facebook.com/docs/business-management-apis/business-asset-management/guides/catalog","https://github.com/facebook/facebook-business-sdk-codegen/blob/main/api_specs/specs/Business.json"], manualRequirements:[...businessRead("business_list_owned_catalogs", "/{asset_id}/owned_product_catalogs", "id,name").manualRequirements,"Only separately registered same-client child inventory is returned. Provider-returned IDs do not enroll assets, renew ownership or establish billing; unregistered or foreign child rows are withheld."] },
  { ...businessRead("business_list_client_catalogs", "/{asset_id}/client_product_catalogs", "id,name"), requiredScopes:["business_management","ads_management","pages_read_engagement"], returnedAssetType:"CATALOG", documentation:["https://developers.facebook.com/docs/business-management-apis/businessmanager/support#faq_439412163553622","https://developers.facebook.com/docs/business-management-apis/business-asset-management/guides/catalog","https://github.com/facebook/facebook-business-sdk-codegen/blob/main/api_specs/specs/Business.json"], manualRequirements:[...businessRead("business_list_client_catalogs", "/{asset_id}/client_product_catalogs", "id,name").manualRequirements,"Only separately registered same-client child inventory is returned. Provider-returned IDs do not enroll assets, renew ownership or establish billing; unregistered or foreign child rows are withheld."] },
  { ...businessRead("business_list_owned_wabas", "/{asset_id}/owned_whatsapp_business_accounts", "id,name"), requiredScopes:["business_management","ads_management","pages_read_engagement"], returnedAssetType:"WABA", documentation:["https://developers.facebook.com/docs/business-management-apis/businessmanager/support#faq_439412163553622","https://www.postman.com/meta/whatsapp-business-platform/request/yr9gqou/owned-and-client-wabas","https://github.com/facebook/facebook-business-sdk-codegen/blob/main/api_specs/specs/Business.json"], manualRequirements:[...businessRead("business_list_owned_wabas", "/{asset_id}/owned_whatsapp_business_accounts", "id,name").manualRequirements,"Only separately registered same-client child inventory is returned. Provider-returned IDs do not enroll assets, renew ownership or establish billing; unregistered or foreign child rows are withheld."] },
  businessRead("business_list_users", "/{asset_id}/business_users", "id,name,role"),
  businessRead("business_list_system_users", "/{asset_id}/system_users", "id,name"),
  hold("business", "business_get_asset_permissions", "META_BUSINESS", "BUSINESS", "GET", "/{asset_id}/assigned_users", ["business_management"], ["READ"], SOURCES.business, "UNVERIFIED: a generic BUSINESS /assigned_users edge and cross-asset permission schema are not established by current primary references. Verified catalog_list_assigned_users provides exact catalog role-summary reads with a server-derived client-owned Business parameter; Business users/system-users/asset edges are separate reviewed tools. Do not substitute catalog/Page/ad-account edges for a Business ID."),
  { ...confirmed(hold("pages", "pages_get", "META_FACEBOOK_PAGES", "PAGE", "GET", "/{asset_id}", [], ["READ"], SOURCES.pages), {
    requiredScopes: ["pages_show_list", "pages_read_engagement"], tokenTypes: ["page"], allowedInputKeys: [],
    documentation: ["https://developers.facebook.com/documentation/pages-api"],
    manualRequirements: ["The target must be the registered client Page represented by the Page token; no public-content fallback. External-user permissions and exact client Page grant must be independently verified."],
  }), fixedQuery: { fields: "id,name,fan_count" } },
  ...(["posts", "published_posts", "scheduled_posts"] as const).map(pageMetadataRead),
  confirmed(hold("pages", "pages_list_feed", "META_FACEBOOK_PAGES", "PAGE", "GET", "/{asset_id}/feed", [], ["READ"], SOURCES.pages), {
    requiredScopes: ["pages_read_engagement", "pages_read_user_content"], tokenTypes: ["page"], requiredTasks: ["CREATE_CONTENT"], allowedInputKeys: [],
    documentation: ["https://developers.facebook.com/docs/graph-api/reference/v26.0/page/feed"],
    manualRequirements: ["Page-owned/manageable content only; no public-content-access fallback.", "Initial task subset is CREATE_CONTENT. Reference also permits MANAGE or MODERATE; those alternatives remain unimplemented rather than falsely requiring all three.", "External-user app access and client Page grant require independent evidence."],
  }),
  PAGE_INSIGHTS_CONTRACT,
  pageMetadataRead("subscribed_apps"),
  { ...confirmed(hold("pages", "pages_create_feed", "META_FACEBOOK_PAGES", "PAGE", "POST", "/{asset_id}/feed", [], ["WRITE_CONTENT"], SOURCES.pages), {
    requiredScopes: ["pages_manage_posts", "pages_read_engagement", "pages_show_list"], tokenTypes: ["page"], requiredTasks: ["CREATE_CONTENT"], allowedInputKeys: ["message", "link", "published"],
    documentation: ["https://developers.facebook.com/docs/graph-api/reference/v26.0/page/feed"],
    manualRequirements: ["Reference Requirements lists these three permissions; later Permissions section repeats only pages_manage_posts. Use the conservative documented requirements, not a claim of globally minimal scopes.", "Validate either message or link, published boolean and safe link URL; mentions require separate asset provenance and are initially rejected.", "Scheduling omitted because reference says 75 days while current guide says 30 days; no silent choice of permissive window."],
  }), createdAssetType: "POST" },
  PAGE_VIDEO_CONTRACT,
  PAGE_VIDEO_STATUS_CONTRACT,
  {...confirmed(hold("pages","pages_create_photos","META_FACEBOOK_PAGES","PAGE","POST","/{asset_id}/photos",[],["WRITE_CONTENT"],SOURCES.pages),{
   requiredScopes:["pages_manage_posts","pages_read_engagement","pages_show_list"],tokenTypes:["page"],requiredTasks:["CREATE_CONTENT","MANAGE","MODERATE"],allowedInputKeys:["source_media_id","image_url"],documentation:["https://developers.facebook.com/documentation/pages-api/posts",PERMISSION_DEPENDENCY_SOURCE],manualRequirements:["Current Page app setup, external-user App Review/access tier and exact Page permissions/tasks must be independently verified.","Initial immediate photo publishing uses the documented POST Page/photos url parameter only. Server translates a registered source image_url to url; scheduling, multi-photo, captions, tags and guessed AI labels are excluded.","Separate signed facebook_content_publishing rights, immutable content-addressed approved CDN bytes, actual JPEG decode and authenticated human enrollment are mandatory. Instagram-purpose rights cannot be substituted. Initial subset excludes AI-generated images until a documented Page AI-label contract is implemented.","JPEG 8 MiB and Instagram-compatible dimensions are conservative local reuse of the reviewed decoder envelope, not claimed Facebook photo API minima.","Provider receipt must include photo id and exact Page composite post_id. Only the returned post is registered; photo metadata creates no grant. Missing post receipt means UNKNOWN and reconciliation, never automatic retry or fabricated post authority.","Publish requires exact human approval and one durable mutation attempt. Client-owned assets and billing remain unchanged."]
  }),assetInputKeys:{source_media_id:"MEDIA"},serverOnlyInputKeys:["source_media_id","image_url"],createdAssetType:"POST"},
  confirmed(hold("pages", "pages_edit_post", "META_FACEBOOK_PAGES", "POST", "POST", "/{asset_id}", [], ["WRITE_CONTENT"], SOURCES.pages),{
    requiredScopes:["pages_manage_posts","pages_read_engagement","pages_show_list"],tokenTypes:["page"],requiredTasks:["CREATE_CONTENT","MANAGE","MODERATE"],allowedInputKeys:["message"],documentation:["https://developers.facebook.com/documentation/pages-api/posts","https://developers.facebook.com/docs/graph-api/reference/page-post",PERMISSION_DEPENDENCY_SOURCE],manualRequirements:["Exact Page-token client grant and external-user App Review/access tier must be independently verified.","Initial app-created Page post message edit only. The registry must retain a server-created operation reference, exact composite Page_post ID and Page parent. Fresh provider application and from fields must match this app and Page before mutation.","The current guide requires app-created posts. Current v26 PagePost reference verifies POST and message UTF-8 parameter with success boolean. All three guide tasks are conservatively required; a 10000-byte message bound and rejection of mention syntax are local Lumin policy.","This operation does not change publish state, schedule, attachments, targeting, ads, or delete the post. Exact human approval and one durable mutation attempt are required; unknown outcomes have no automatic retry."]
  }),
  hold("pages", "pages_delete_post", "META_FACEBOOK_PAGES", "POST", "DELETE", "/{asset_id}", ["pages_manage_posts"], ["DELETE"], "https://developers.facebook.com/docs/graph-api/reference/pagepost", "UNVERIFIED: current PagePost reference restricts API deletion to select developers; Lumin eligibility and exact permission contract are not established."),
  PAGE_REPLY_CONTRACT,
  pageComment("pages_hide_comment", "POST", "/{asset_id}", ["is_hidden"]),
  pageComment("pages_delete_comment", "DELETE", "/{asset_id}", []),
  instagramMetadataRead("instagram_get_profile","META_INSTAGRAM_FACEBOOK_LOGIN",false),
  instagramMetadataRead("instagram_list_media","META_INSTAGRAM_FACEBOOK_LOGIN",true),
  { ...instagramPublishing("instagram_create_container", "META_INSTAGRAM_FACEBOOK_LOGIN", "POST", "INSTAGRAM_ACCOUNT", "/{asset_id}/media", ["source_media_id", "image_url", "caption", "alt_text", "is_ai_generated"]), assetInputKeys: { source_media_id: "MEDIA" }, serverOnlyInputKeys: ["source_media_id"], createdAssetType: "MEDIA", createdAssetKind: "instagram_container", createOrCopy: true },
  { ...instagramPublishing("instagram_publish_container", "META_INSTAGRAM_FACEBOOK_LOGIN", "POST", "INSTAGRAM_ACCOUNT", "/{asset_id}/media_publish", ["creation_id"]), assetInputKeys: { creation_id: "MEDIA" }, createdAssetType: "MEDIA", createdAssetKind: "instagram_published_media" },
  { ...instagramPublishing("instagram_get_container_status", "META_INSTAGRAM_FACEBOOK_LOGIN", "GET", "MEDIA", "/{asset_id}", []), fixedQuery: { fields: "id,status_code" }, assetEvidenceUpdate: "instagram_container" },
  INSTAGRAM_BUSINESS_DISCOVERY_CONTRACT,
  INSTAGRAM_HASHTAG_CONTRACT,
  ...INSTAGRAM_MENTION_CONTRACTS,
  instagramMetadataRead("instagram_login_profile","META_INSTAGRAM_LOGIN",false),
  instagramMetadataRead("instagram_login_list_media","META_INSTAGRAM_LOGIN",true),
  { ...instagramPublishing("instagram_login_create_container", "META_INSTAGRAM_LOGIN", "POST", "INSTAGRAM_ACCOUNT", "/{asset_id}/media", ["source_media_id", "image_url", "caption", "alt_text", "is_ai_generated"]), assetInputKeys: { source_media_id: "MEDIA" }, serverOnlyInputKeys: ["source_media_id"], createdAssetType: "MEDIA", createdAssetKind: "instagram_container", createOrCopy: true },
  { ...instagramPublishing("instagram_login_publish", "META_INSTAGRAM_LOGIN", "POST", "INSTAGRAM_ACCOUNT", "/{asset_id}/media_publish", ["creation_id"]), assetInputKeys: { creation_id: "MEDIA" }, createdAssetType: "MEDIA", createdAssetKind: "instagram_published_media" },
  { ...instagramPublishing("instagram_login_get_container_status", "META_INSTAGRAM_LOGIN", "GET", "MEDIA", "/{asset_id}", []), fixedQuery: { fields: "id,status_code" }, assetEvidenceUpdate: "instagram_container" },
  confirmed(hold("instagram", "instagram_login_conversations", "META_INSTAGRAM_LOGIN", "INSTAGRAM_ACCOUNT", "GET", "/{asset_id}/conversations", [], ["READ"], SOURCES.instagramLogin), {
    requiredScopes: ["instagram_business_basic", "instagram_business_manage_messages"], tokenTypes: ["instagram"], allowedInputKeys: [],
    documentation: ["https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api"],
    manualRequirements: ["Instagram user token must come from a person authorized to manage this professional account's messages.", "Advanced Access for professional accounts not owned/managed by the app operator; Standard Access only for owned/managed accounts added in App Dashboard.", "Requests inactive for 30 days may be omitted; empty response does not prove no unanswered messages.", "Use graph.instagram.com; do not substitute Facebook Page token or host."],
  }),
  {
    ...confirmed(hold("instagram", "instagram_login_get_messages", "META_INSTAGRAM_LOGIN", "CONVERSATION", "GET", "/{asset_id}", [], ["READ"], SOURCES.instagramLogin), {
      requiredScopes: ["instagram_business_basic", "instagram_business_manage_messages"], tokenTypes: ["instagram"], allowedInputKeys: [],
      documentation: ["https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api"],
      manualRequirements: ["Resolve conversation provenance to the exact client Instagram professional account before calling the provider.", "Same access-level/managed-account conditions as Instagram Login conversation listing; raw message content is not requested by this projection."],
    }),
    fixedQuery: { fields: "messages" },
  },
  {
    ...confirmed(hold("instagram", "instagram_list_conversations", "META_INSTAGRAM_FACEBOOK_LOGIN", "PAGE", "GET", "/{asset_id}/conversations", [], ["READ"], SOURCES.conversations), {
      requiredScopes: ["instagram_basic", "instagram_manage_messages", "pages_manage_metadata"], tokenTypes: ["page"], requiredTasks: ["MESSAGING"], allowedInputKeys: [],
      documentation: ["https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversations"],
      manualRequirements: ["Page must be linked to the exact client Instagram professional account; app owned by verified business.", "Advanced Access for external conversations; inactive Requests may be omitted."],
    }), fixedQuery: { platform: "instagram" },
  },
  {
    ...confirmed(hold("messenger", "messenger_list_conversations", "META_MESSENGER", "PAGE", "GET", "/{asset_id}/conversations", [], ["READ"], SOURCES.conversations), {
      requiredScopes: ["pages_manage_metadata", "pages_read_engagement", "pages_messaging"], tokenTypes: ["page"], requiredTasks: ["MESSAGING"], allowedInputKeys: [],
      documentation: ["https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversations"],
      manualRequirements: ["Initial task subset MESSAGING; reference also allows MODERATE as an alternative, not an additional required task.", "Advanced Access for conversations with people outside app/Page/business roles; verify current external access evidence."],
    }), fixedQuery: { platform: "messenger" },
  },
  {
    ...confirmed(hold("messenger", "messenger_get_messages", "META_MESSENGER", "CONVERSATION", "GET", "/{asset_id}", [], ["READ"], SOURCES.conversations), {
      requiredScopes: ["pages_manage_metadata", "pages_read_engagement", "pages_messaging"], tokenTypes: ["page"], requiredTasks: ["MESSAGING"], allowedInputKeys: [],
      documentation: ["https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversations"],
      manualRequirements: ["Resolve exact client/Page conversation provenance and inherited messaging task before execution; only IDs/timestamps requested.", "Advanced Access for external conversations; only twenty most recent messages allow detail reads, which this projection does not request."],
    }), fixedQuery: { fields: "messages" },
  },
  {
    id: "messenger.send.text", tool: "messenger_send_text", provider: "META_MESSENGER", product: "messenger", title: "Send Messenger response",
    method: "POST", path: "/{asset_id}/messages", assetType: "PAGE", operationClasses: ["WRITE_MESSAGING"],
    requiredScopes: ["pages_messaging"], tokenTypes: ["page"], requiredTasks: ["MESSAGE"],
    allowedInputKeys: ["recipient", "message"], documentation: [SOURCES.messenger, "https://www.postman.com/meta/messenger-platform-api/folder/vilwbh4/send-api"],
    verified: true, requiresMessagingWindow: true, responseFields: RESPONSE_PROJECTIONS.messenger_send_text,
    manualRequirements: ["Observe recipient-to-Page provenance and a fresh inbound message within Lumin's initial 24-hour window; do not accept caller-asserted timing. Current Meta docs allow some ad-origin windows up to seven days, which this initial policy does not enable.", "Advanced Access and any required review must be independently verified for external users.", "Exact body: recipient.id is a PSID, message.text is text, and server fixes messaging_type to RESPONSE. Facebook Login app-scoped user IDs are invalid recipients.", "Only validated text response schema; attachments, templates, tags and outside-window exceptions remain disabled. Meta text-length limit is UNVERIFIED; any local length cap must be identified as Lumin policy."],
  },
  confirmed(hold("threads", "threads_get_profile", "META_THREADS", "THREADS_ACCOUNT", "GET", "/{asset_id}", [], ["READ"], SOURCES.threads), {
    requiredScopes: ["threads_basic"], tokenTypes: ["threads"], allowedInputKeys: [],
    documentation: ["https://developers.facebook.com/documentation/threads/threads-profiles"],
    manualRequirements: ["Only the app-scoped user profile may be fetched; verify the requested asset is the connection subject.", "Current primary reference uses graph.threads.com/v1.0; it supersedes older Postman graph.threads.net examples.", "External-user App Review/publication and independent client asset mapping remain separate gates."],
  }),
  {
    ...confirmed(hold("threads", "threads_list_threads", "META_THREADS", "THREADS_ACCOUNT", "GET", "/{asset_id}/threads", [], ["READ"], SOURCES.threads), {
      requiredScopes: ["threads_basic"], tokenTypes: ["threads"], allowedInputKeys: [],
      documentation: ["https://developers.facebook.com/documentation/threads/retrieve-and-discover-posts/retrieve-posts"],
      manualRequirements: ["Only app-scoped user posts; verify account asset equals the connection subject.", "Cursor pagination observed; no caller-supplied field expansion or unverified maximum page size."],
    }), pagination: true,
  },
  confirmed(hold("threads", "threads_get_post", "META_THREADS", "POST", "GET", "/{asset_id}", [], ["READ"], SOURCES.threads), {
    requiredScopes: ["threads_basic"], tokenTypes: ["threads"], allowedInputKeys: [],
    documentation: ["https://developers.facebook.com/documentation/threads/retrieve-and-discover-posts/retrieve-posts"],
    manualRequirements: ["Resolve post provenance to an authorized client account before execution. Tester-only before advanced threads_basic approval; approval does not bypass Lumin asset isolation."],
  }),
  threadsReplies("threads_list_replies", "/{asset_id}/replies"),
  threadsInsights("threads_list_insights",false),
  threadsInsights("threads_get_post_insights",true),
  { ...confirmed(hold("threads", "threads_list_threads_publishing_limit", "META_THREADS", "THREADS_ACCOUNT", "GET", "/{asset_id}/threads_publishing_limit", [], ["READ"], SOURCES.threads), {
    requiredScopes: ["threads_basic", "threads_content_publish", "threads_manage_replies"], tokenTypes: ["threads"], allowedInputKeys: [],
    documentation: ["https://developers.facebook.com/documentation/threads/retrieve-and-manage-replies"],
    manualRequirements: ["Only the authenticated client's registered Threads account reply quota is requested. This read does not authorize publishing; reply limit is 1000 within a rolling 24-hour period, and current response/config remains authoritative.", "The guide explicitly requires all three scopes for this endpoint; external permission approval and connection subject must be independently verified."],
  }), fixedQuery: { fields: "reply_quota_usage,reply_config" } },
  { ...confirmed(hold("threads", "threads_create_container", "META_THREADS", "THREADS_ACCOUNT", "POST", "/{asset_id}/threads", [], ["WRITE_CONTENT"], SOURCES.threads), {
    requiredScopes: ["threads_basic", "threads_content_publish"], tokenTypes: ["threads"], allowedInputKeys: ["media_type", "is_carousel_item", "text"],
    documentation: ["https://developers.facebook.com/documentation/threads/posts"],
    manualRequirements: ["External user publication requires published app and Advanced Access for threads_content_publish; otherwise only registered Threads testers may publish.", "Only the connection subject's registered client Threads account may create a container. This operation creates a draft and does not authorize publication.", "Initial schema requires media_type TEXT and is_carousel_item false. Lumin conservatively limits the entire text to 500 UTF-8 bytes and excludes explicit HTTP/www links; the provider documents 500 characters with emojis counted as UTF-8 bytes. Media, link attachment, automatic publication and additional parameters remain disabled.", "Persist returned container provenance to this exact client/app/account before any later publication; successful creation does not establish publication readiness."],
  }), createOrCopy: true, createdAssetType: "MEDIA" },
  { ...confirmed(hold("threads", "threads_publish_container", "META_THREADS", "THREADS_ACCOUNT", "POST", "/{asset_id}/threads_publish", [], ["WRITE_CONTENT"], SOURCES.threads), {
    requiredScopes: ["threads_basic", "threads_content_publish"], tokenTypes: ["threads"], allowedInputKeys: ["creation_id"],
    documentation: ["https://developers.facebook.com/documentation/threads/posts"],
    manualRequirements: ["External user publication requires published app and Advanced Access for threads_content_publish; otherwise only registered Threads testers may publish.", "The registered MEDIA container must be freshly verified as created for this exact client/app/Threads account, with completed processing and no prior publication. Missing trusted container state remains HOLD.", "Publication requires its own exact-plan approval; approval of draft creation does not authorize publication. Provider recommends approximately 30 seconds processing time; elapsed time alone is not a readiness proof."],
  }), assetInputKeys: { creation_id: "MEDIA" }, createdAssetType: "POST" },
  threadsModeration("threads_manage_reply", "manage_reply", "hide"),
  confirmed(hold("threads", "threads_delete_post", "META_THREADS", "POST", "DELETE", "/{asset_id}", [], ["DELETE"], SOURCES.threads), {
    requiredScopes: ["threads_basic", "threads_delete"], tokenTypes: ["threads"], allowedInputKeys: [],
    documentation: ["https://developers.facebook.com/documentation/threads/posts/delete-posts"],
    manualRequirements: ["Only delete a post created by the authenticated Threads user; registered client post provenance must resolve to that connection subject.", "Deletion is irreversible and requires its own exact-plan approval. Provider account limit is 100 deletions per day; do not retry uncertain outcomes.", "External client access and permission approval must be independently verified before execution."],
  }),
  threadsReplies("threads_get_conversation", "/{asset_id}/conversation"),
  { ...confirmed(hold("threads", "threads_list_pending_replies", "META_THREADS", "POST", "GET", "/{asset_id}/pending_replies", [], ["READ"], SOURCES.threads), {
    requiredScopes: ["threads_basic", "threads_read_replies"], tokenTypes: ["threads"], allowedInputKeys: [],
    documentation: ["https://developers.facebook.com/documentation/threads/retrieve-and-manage-replies", "https://developers.facebook.com/documentation/threads/reply-management"],
    manualRequirements: ["The target is the authenticated client's registered root Threads post with reply approvals enabled. External user access and permission approval require independent verification.", "Only pending/ignored reply metadata and exact root/parent IDs are requested. Trusted observation may refresh evidence for existing registered same-client replies; returned IDs alone do not grant access or moderation authorization."],
  }), fixedQuery: { fields: "id,is_reply,hide_status,root_post,replied_to,reply_approval_status" }, assetEvidenceUpdate: "threads_reply_list" },
  { ...confirmed(hold("threads", "threads_get_post_status", "META_THREADS", "MEDIA", "GET", "/{asset_id}", [], ["READ"], SOURCES.threads), {
    requiredScopes: ["threads_basic", "threads_content_publish"], tokenTypes: ["threads"], allowedInputKeys: [],
    documentation: ["https://developers.facebook.com/documentation/threads/reference/publishing", "https://developers.facebook.com/documentation/threads/posts", "https://developers.facebook.com/documentation/threads/troubleshooting"],
    manualRequirements: ["Resolve the registered container to the authenticated client's Threads account. Use the conservative documented publishing scope pack rather than claiming endpoint-specific minimum scope.", "Only FINISHED means ready to publish; IN_PROGRESS, EXPIRED, ERROR and PUBLISHED cannot authorize publication. Trusted server refresh must persist checked status and exact container/account/app provenance.", "Poll at most once per minute for no more than five minutes; no automatic publishing or polling loop is enabled by this read tool."],
  }), fixedQuery: { fields: "id,status" }, assetEvidenceUpdate: "threads_container" },
  threadsModeration("threads_manage_pending_reply", "manage_pending_reply", "approve"),
  leadRead("leads_list_forms"),
  leadRead("leads_get_form"),
  leadRead("leads_retrieve"),
  { ...confirmed(hold("leads", "leads_get_lead", "META_MARKETING", "LEAD", "GET", "/{asset_id}", [], ["READ"], SOURCES.leads), {
    requiredScopes:["ads_management","leads_retrieval","pages_show_list","pages_read_engagement","pages_manage_ads"],tokenTypes:["page","user"],allowedInputKeys:[],
    documentation:["https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving"],
    manualRequirements:["Token must be requested by a person authorized to advertise on both the client Page and client ad account; documented full lead/ad-data permission pack is used conservatively.","Leads Access Manager access must be independently verified: customized lead access is not implied by Page administrator status.","Initial ad-lead metadata subset requires a registered lead with explicit same-client LEAD_FORM, PAGE and AD_ACCOUNT ancestry and fresh grants to every parent. Signed leadgen webhook provenance must bind leadgen_id to the exact form/Page; raw foreign IDs are rejected.","Server fixes fields=id,created_time and returns metadata only. Full field_data/contact information and custom-disclaimer responses require a separate trusted receiving adapter and privacy/consent review; no LeadGate coupling is assumed.","External-user app permission/access review and current Meta product/API-version eligibility must be independently verified before execution."],
  }),fixedQuery:{fields:"id,created_time"} },
  APP_EVENT_TYPES_CONTRACT,
  IMAGE_INSPECTION_CONTRACT,
  CREATIVE_IMAGE_INSPECTION_CONTRACT,
  VIDEO_INSPECTION_CONTRACT,
  CREATIVE_VIDEO_INSPECTION_CONTRACT,
  CATALOG_CAMPAIGN_CONTRACT,
  INVOICE_METADATA_CONTRACT,
  CRM_SIGNAL_CONTRACT,
  ...CATALOG_OPERATIONAL_CONTRACTS,
  DATASET_READ_CONTRACT,
  PURCHASE_CONVERSION_CONTRACT,
  MARKETING_PREVIEW_CONTRACT,
  PAGE_COMMENT_READ_CONTRACT,
  hold("signals", "signals_send_events", "META_MARKETING", "DATASET", "POST", "/{asset_id}/events", [], ["WRITE_NON_FINANCIAL"], SOURCES.signals, "UNVERIFIED: DATASET identity/permission mapping is not established and must not be inferred from a Pixel ID. The separately verified signals_send_pixel_events tool implements trusted first-party Pixel dispatch, source/consent verification, hashing and durable deduplication. This generic dataset route remains unavailable."),
  confirmed(hold("signals", "signals_send_pixel_events", "META_MARKETING", "PIXEL", "POST", "/{asset_id}/events", [], ["WRITE_NON_FINANCIAL"], SOURCES.signals), {
    requiredScopes:["ads_management","pages_read_engagement","ads_read"],tokenTypes:["system_user"],allowedInputKeys:["source_reference","consent_reference"],
    documentation:["https://developers.facebook.com/documentation/ads-commerce/conversions-api/set-up-conversions-api-as-a-platform","https://developers.facebook.com/documentation/ads-commerce/conversions-api/using-the-api","https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ads-pixel/events"],
    manualRequirements:["Agency platform requires independently verified App Review Advanced Access and Marketing API Access Tier plus documented platform permissions; direct own-business exemptions do not establish agency eligibility.","System user must have the client-owned Pixel assigned with Manage Pixel access; client authorization and Lumin same-client asset grant remain mandatory. Do not infer dataset IDs equal Pixel IDs.","Use the dedicated trusted first-party dispatcher: model input contains only source and consent references. Resolve actual events internally, verify payload-bound source/consent evidence, normalize/hash required PII, preserve event_id/event_name and durable deduplication checkpoints.","No synthetic or fabricated conversions. test_event_code is disabled: current Using API documentation says test-code events are not dropped and can be used for targeting and ads measurement.","Exactly one event and one guarded egress attempt per durable checkpoint; transport uncertainty remains UNKNOWN with no automatic retry. Accepted count does not prove attribution, optimization, match quality or completed delivery.","Production trusted-source resolver, consent adapter, durable dispatcher store and guarded transport must be configured and reviewed before execution; generic product-body handling must not bypass the dedicated dispatcher."],
  }),
  catalogRead("products", "id,name,category", "https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/product-catalog/products"),
  catalogRead("product_sets", "id,name,product_count", "https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/product-set"),
  catalogRead("product_feeds", "id,name,product_count,country,default_currency", "https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/product-feed"),
  CATALOG_ASSIGNED_USERS_CONTRACT,
  ...OEMBED_CONTRACTS,
  { ...confirmed(hold("whatsapp", "whatsapp_platform_send_message", "META_WHATSAPP", "WHATSAPP_PHONE", "POST", "/{asset_id}/messages", [], ["WRITE_MESSAGING"], "https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages"), {
    requiredScopes:["whatsapp_business_messaging"], tokenTypes:["system_user","business_integration_system_user"],allowedInputKeys:["to","text"],
    documentation:["https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages","https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions","https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens"],
    manualRequirements: [...WHATSAPP_READ_REQUIREMENTS.map(requirement=>requirement.replace("Advanced Access for whatsapp_business_management", "Advanced Access for whatsapp_business_messaging")),
      "Every recipient requires independently recorded opt-in to this client's business. Service messages require a trusted inbound message or call within 24 hours; caller timing assertions are invalid.",
      "Initial send contract is text-only in an open service window; approved utility-template sends require a separate reviewed contract and remain disabled here.",
      "If token access covers multiple Messaging accounts for the phone, inject messaging_account_id resolved from the verified client asset graph. Never let caller select agency or another client's billing account.",
      "Provider success means accepted, not delivered; correlate independently authenticated status webhooks before claiming delivery. Group messages, media, bulk sends and marketing exceptions remain disabled.",
      "Server constructs messaging_product=whatsapp, recipient_type=individual, type=text, text.body from normalized text, and preview_url=false. Require plus-prefixed E.164 recipient; official guide recommends plus and country calling code to avoid misdelivery. A 2000-character cap is Lumin policy, not a claimed Meta maximum.",
      "Production trusted signed-webhook and independently verified client-consent ingestion pipelines must be configured and reviewed; internal evidence source labels alone do not prove real provenance."] }), requiresMessagingWindow:true },
  ...["register", "request_code", "verify_code"].map(edge => hold("whatsapp", `whatsapp_platform_${edge}`, "META_WHATSAPP", "WHATSAPP_PHONE", "POST", `/{asset_id}/${edge}`, [], ["IDENTITY_OR_ACCESS"], "https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/"+({register:"phone-number-registration",request_code:"phone-number-verification-request-code-api",verify_code:"verify-code-api"} as Record<string,string>)[edge], "UNVERIFIED: supported endpoint is documented but current reference omits endpoint-specific minimum scopes and rendered OpenAPI v23 differs from current v26 registration guide. Human-only phone identity/credential action: OTP and 6-digit two-step PIN must never enter MCP/model/registry/audit. Embedded Signup v4 normally verifies numbers; v2/v3 deprecated October15,2026. Client owns phone/account/billing and PIN; no automatic agency credential or financial-liability changes.")),
  ...WHATSAPP_PHONE_CONTRACTS,
  ...WHATSAPP_QR_CONTRACTS,
  ...INSTAGRAM_COMMENT_CONTRACTS,
  ...INSTAGRAM_INSIGHTS_CONTRACTS,
  ...THREADS_DISCOVERY_CONTRACTS,
  ...WHATSAPP_ANALYTICS_CONTRACTS,
  ...MESSENGER_TYPED_CONTRACTS,
  ...MESSAGING_IMAGE_CONTRACTS,
  ...INSTAGRAM_VIDEO_CONTRACTS,
  ...INSTAGRAM_IMAGE_VARIANT_CONTRACTS,
  ...THREADS_VIDEO_CONTRACTS,
  ...THREADS_IMAGE_CONTRACTS,
  ...INSTAGRAM_CAROUSEL_CONTRACTS,
  ...THREADS_CAROUSEL_CONTRACTS,
  OFFLINE_QUALITY_CONTRACT,
  LEAD_FORM_CONTRACT,
  MARKETING_IMAGE_CONTRACT,
  MARKETING_REPORT_CONTRACT,
  MARKETING_STUDY_CONTRACT,
  MARKETING_RULE_CONTRACT,
  MARKETING_VIDEO_CONTRACT,
  AD_LIBRARY_CONTRACT,
  ...MARKETING_AUDIENCE_CONTRACTS,
  ...MARKETING_CONTROL_CONTRACTS,
  ...WHATSAPP_SEND_CONTRACTS,
  ...MESSENGER_UTILITY_CONTRACTS,
  ...MESSENGER_ATTACHMENT_CONTRACTS,
] satisfies ProductContract[]).map(contract => {
  if (!contract.verified) return contract;
  const requiredScopes = expandVerifiedPermissionDependencies(contract.requiredScopes);
  return { ...contract, ...(contract.provider==="META_MESSENGER"&&["messenger_get_message","messenger_get_messages","messenger_send_image"].includes(contract.tool)?{requiredTaskAssetType:"PAGE" as const}:{}), ...reviewedEligibilityMetadata(contract), requiredScopes, documentation: [...new Set([...contract.documentation, PERMISSION_DEPENDENCY_SOURCE])], manualRequirements: [...contract.manualRequirements, ...(contract.requiredScopes.includes("leads_retrieval") ? ["Current Permissions Reference additionally requires Ads Management Standard Access as a feature/access-tier gate; this is not an OAuth scope and must be independently verified."] : [])] };
}));

export function validateProductContracts(contracts: readonly ProductContract[]): void {
  const ids = new Set<string>();
  const tools = new Set<string>();
  for (const contract of contracts) {
    if (ids.has(contract.id) || tools.has(contract.tool)) throw new Error("Duplicate product contract identity");
    ids.add(contract.id); tools.add(contract.tool);
    if (!/^[a-z][a-z0-9_]+$/.test(contract.tool)) throw new Error("Invalid product tool name");
    if (!contract.path.startsWith("/") || contract.path.includes("?") || contract.path.includes("..") || contract.path.includes("://")) throw new Error("Invalid product path");
    if (contract.documentation.length === 0 || contract.documentation.some(link => !/^https:\/\/(developers\.facebook\.com|www\.postman\.com\/meta|github\.com\/fbsamples|github\.com\/facebook\/(?:facebook-business-sdk-codegen|facebook-python-business-sdk))\//.test(link))) throw new Error("Primary documentation required");
    if (!contract.operationClasses.length) throw new Error("Operation classification required");
    if (!contract.verified && !contract.unverifiedReason?.startsWith("UNVERIFIED:")) throw new Error("Unverified contract needs a precise reason");
    if(contract.authMode&&(!OEMBED_TOOLS.includes(contract.tool)||contract.authMode!=="TOKENLESS_FRONTEND_ONLY"||contract.method!=="GET"||contract.assetType!=="APP"||contract.requiredScopes.length||contract.tokenTypes.length||!contract.verified||!OEMBED_CONTRACTS.some(c=>c.tool===contract.tool&&c.id===contract.id&&c.provider===contract.provider&&c.path===contract.path&&JSON.stringify(c.allowedInputKeys)===JSON.stringify(contract.allowedInputKeys))))throw new Error("Unreviewed tokenless frontend contract");
    if (contract.verified && (!contract.authMode&&(!contract.requiredScopes.length || !contract.tokenTypes.length) || contract.unverifiedReason)) throw new Error("Verified contract requires scope and token evidence");
    if (contract.verified && expandVerifiedPermissionDependencies(contract.requiredScopes).some(scope => !contract.requiredScopes.includes(scope))) throw new Error("Verified permission dependencies required");
    if (contract.verified && (!contract.responseFields?.length || JSON.stringify(contract.responseFields) !== JSON.stringify(RESPONSE_PROJECTIONS[contract.tool]))) throw new Error("Verified contract requires reviewed response projection");
    const privateInbox = ["messenger_get_message", "instagram_get_message", "instagram_login_get_message"].includes(contract.tool);
    const templateSnapshot = contract.tool==="whatsapp_platform_get_template" && contract.provider==="META_WHATSAPP";
    const privatePageComments=contract.tool===PAGE_COMMENT_READ_CONTRACT.tool&&contract.provider===PAGE_COMMENT_READ_CONTRACT.provider&&contract.privateResponse==="client_comments"&&JSON.stringify(contract.responseFields)===JSON.stringify(PAGE_COMMENT_READ_CONTRACT.responseFields);
    const privateComments=privatePageComments||["instagram_list_comments","instagram_login_list_comments"].includes(contract.tool)&&contract.privateResponse==="client_comments";
    if ((contract.privateResponse !== undefined && !privateComments && !(contract.tool==="leads_retrieve" && contract.privateResponse==="client_leads") && (!privateInbox || contract.privateResponse !== "client_inbox")) || (privateInbox && contract.privateResponse !== "client_inbox")) throw new Error("Reviewed private response policy required");
    const qrProjection=contract.provider==="META_WHATSAPP"&&WHATSAPP_QR_CONTRACTS.some(c=>c.tool===contract.tool&&JSON.stringify(c.responseFields)===JSON.stringify(contract.responseFields));
    if (!qrProjection && !privatePageComments && contract.responseFields?.some(field => !/^[a-z_]+(?:\.[a-z_]+)*$/.test(field) || (/(?:token|secret|credential|password|payload|next|previous|text$|url$)/.test(field) && !(privateComments&&field==="data.text") && !(templateSnapshot && ["send_snapshot.body_text","send_snapshot.header_text","send_snapshot.footer_text"].includes(field))) || (/(?:message$)/.test(field) && !(privateInbox && field === "message")))) throw new Error("Unsafe response projection");
    if (!contract.pagination && contract.responseFields?.some(field => field.startsWith("paging."))) throw new Error("Paging projection requires verified pagination");
    if (contract.method !== "GET" && contract.operationClasses.includes("READ")) throw new Error("Mutation cannot be classified READ");
    if (contract.operationClasses.includes("WRITE_MESSAGING") && contract.verified && !contract.requiresMessagingWindow && !(contract.tool==="messenger_send_utility_template"&&contract.provider==="META_MESSENGER"&&contract.path==="/{asset_id}/messages"&&MESSENGER_UTILITY_CONTRACTS.some(c=>c.tool===contract.tool)) && !(contract.tool==="whatsapp_platform_send_template" && contract.provider==="META_WHATSAPP" && contract.path==="/{asset_id}/messages" && WHATSAPP_SEND_CONTRACTS.some(c=>c.tool===contract.tool))) throw new Error("Messaging contract requires a policy window");
    if (contract.allowedInputKeys.some(key => ["access_token", "appsecret_proof", "url", "path", "fields", "auto_publish_text"].includes(key)&&!(key==="url"&&OEMBED_TOOLS.includes(contract.tool)&&contract.authMode==="TOKENLESS_FRONTEND_ONLY"))) throw new Error("Unsafe unrestricted input key");
    const fixedProjections: Record<string, { provider: Provider; path: string; query: Record<string, string> }> = {
      pages_list_comments:{provider:PAGE_COMMENT_READ_CONTRACT.provider,path:PAGE_COMMENT_READ_CONTRACT.path,query:PAGE_COMMENT_READ_CONTRACT.fixedQuery!},
      pages_get_video_status:{provider:PAGE_VIDEO_STATUS_CONTRACT.provider,path:PAGE_VIDEO_STATUS_CONTRACT.path,query:PAGE_VIDEO_STATUS_CONTRACT.fixedQuery!},
      pages_get_insights:{provider:PAGE_INSIGHTS_CONTRACT.provider,path:PAGE_INSIGHTS_CONTRACT.path,query:PAGE_INSIGHTS_CONTRACT.fixedQuery!},
      ...Object.fromEntries(INSTAGRAM_INSIGHTS_CONTRACTS.map(c=>[c.tool,{provider:c.provider,path:c.path,query:c.fixedQuery!}])),
      ...Object.fromEntries([...WHATSAPP_PHONE_CONTRACTS,...WHATSAPP_QR_CONTRACTS].filter(c=>c.fixedQuery).map(c=>[c.tool,{provider:c.provider,path:c.path,query:c.fixedQuery!}])),
      whatsapp_platform_get_template:{provider:"META_WHATSAPP",path:"/{asset_id}",query:{fields:"id,name,language,category,status,components"}},
      leads_list_forms:{provider:"META_MARKETING",path:"/{asset_id}/leadgen_forms",query:{fields:"id,name,status,created_time,page_id"}},
      leads_get_form:{provider:"META_MARKETING",path:"/{asset_id}",query:{fields:"id,name,status,created_time,page_id"}},
      leads_retrieve:{provider:"META_MARKETING",path:"/{asset_id}/leads",query:{fields:"created_time,id,ad_id,form_id,field_data"}},
      pages_list_posts:{provider:"META_FACEBOOK_PAGES",path:"/{asset_id}/posts",query:{fields:"id,created_time,is_published"}},
      pages_list_published_posts:{provider:"META_FACEBOOK_PAGES",path:"/{asset_id}/published_posts",query:{fields:"id,created_time,is_published"}},
      pages_list_scheduled_posts:{provider:"META_FACEBOOK_PAGES",path:"/{asset_id}/scheduled_posts",query:{fields:"id,created_time,is_published"}},
      pages_get_subscriptions:{provider:"META_FACEBOOK_PAGES",path:"/{asset_id}/subscribed_apps",query:{fields:"id,name"}},
      whatsapp_platform_list_flows:{provider:"META_WHATSAPP",path:"/{asset_id}/flows",query:{fields:"id,name,status",limit:"100"}},
      whatsapp_platform_get_flow:{provider:"META_WHATSAPP",path:"/{asset_id}",query:{fields:"id,name,status,json_version,validation_errors,whatsapp_business_account,application"}},
      threads_list_insights:{provider:"META_THREADS",path:"/{asset_id}/threads_insights",query:{metric:"views"}},
      threads_get_post_insights:{provider:"META_THREADS",path:"/{asset_id}/insights",query:{metric:"likes,replies,reposts,quotes,shares"}},
      instagram_get_profile:{provider:"META_INSTAGRAM_FACEBOOK_LOGIN",path:"/{asset_id}",query:{fields:"id,username,name,followers_count,media_count"}},
      instagram_login_profile:{provider:"META_INSTAGRAM_LOGIN",path:"/{asset_id}",query:{fields:"id,username,name,followers_count,media_count"}},
      business_list_owned_pages: {provider:"META_BUSINESS",path:"/{asset_id}/owned_pages",query:{fields:"id,name"}},
      business_list_client_pages: {provider:"META_BUSINESS",path:"/{asset_id}/client_pages",query:{fields:"id,name"}},
      business_list_owned_ad_accounts: {provider:"META_BUSINESS",path:"/{asset_id}/owned_ad_accounts",query:{fields:"id,name"}},
      business_list_client_ad_accounts: {provider:"META_BUSINESS",path:"/{asset_id}/client_ad_accounts",query:{fields:"id,name"}},
      business_list_owned_catalogs: {provider:"META_BUSINESS",path:"/{asset_id}/owned_product_catalogs",query:{fields:"id,name"}},
      business_list_client_catalogs: {provider:"META_BUSINESS",path:"/{asset_id}/client_product_catalogs",query:{fields:"id,name"}},
      business_list_owned_wabas: {provider:"META_BUSINESS",path:"/{asset_id}/owned_whatsapp_business_accounts",query:{fields:"id,name"}},
      business_get: { provider: "META_BUSINESS", path: "/{asset_id}", query: { fields: "id,name" } },
      messenger_get_message: { provider: "META_MESSENGER", path: "/{asset_id}", query: { fields: "id,created_time,from,to,message" } },
      instagram_get_message: { provider: "META_INSTAGRAM_FACEBOOK_LOGIN", path: "/{asset_id}", query: { fields: "id,created_time,from,to,message" } },
      instagram_login_get_message: { provider: "META_INSTAGRAM_LOGIN", path: "/{asset_id}", query: { fields: "id,created_time,from,to,message" } },
      instagram_get_container_status: { provider: "META_INSTAGRAM_FACEBOOK_LOGIN", path: "/{asset_id}", query: { fields: "id,status_code" } },
      instagram_login_get_container_status: { provider: "META_INSTAGRAM_LOGIN", path: "/{asset_id}", query: { fields: "id,status_code" } },
      pages_get: { provider: "META_FACEBOOK_PAGES", path: "/{asset_id}", query: { fields: "id,name,fan_count" } },
      business_list_users: { provider: "META_BUSINESS", path: "/{asset_id}/business_users", query: { fields: "id,name,role" } },
      business_list_system_users: { provider: "META_BUSINESS", path: "/{asset_id}/system_users", query: { fields: "id,name" } },
      catalog_list_products: { provider: "META_BUSINESS", path: "/{asset_id}/products", query: { fields: "id,name,category" } },
      catalog_list_product_sets: { provider: "META_BUSINESS", path: "/{asset_id}/product_sets", query: { fields: "id,name,product_count" } },
      catalog_list_product_feeds: { provider: "META_BUSINESS", path: "/{asset_id}/product_feeds", query: { fields: "id,name,product_count,country,default_currency" } },
      instagram_login_get_messages: { provider: "META_INSTAGRAM_LOGIN", path: "/{asset_id}", query: { fields: "messages" } },
      instagram_list_conversations: { provider: "META_INSTAGRAM_FACEBOOK_LOGIN", path: "/{asset_id}/conversations", query: { platform: "instagram" } },
      messenger_list_conversations: { provider: "META_MESSENGER", path: "/{asset_id}/conversations", query: { platform: "messenger" } },
      messenger_get_messages: { provider: "META_MESSENGER", path: "/{asset_id}", query: { fields: "messages" } },
      whatsapp_platform_list_templates: { provider: "META_WHATSAPP", path: "/{asset_id}/message_templates", query: { fields: "id,name,language,category,status", limit:"100" } },
      leads_get_lead: { provider: "META_MARKETING", path: "/{asset_id}", query: { fields: "id,created_time" } },
      threads_get_post_status: { provider: "META_THREADS", path: "/{asset_id}", query: { fields: "id,status" } },
      threads_list_replies: { provider: "META_THREADS", path: "/{asset_id}/replies", query: { fields: "id,timestamp,media_type,is_reply,is_reply_owned_by_me,hide_status,root_post,replied_to" } },
      threads_get_conversation: { provider: "META_THREADS", path: "/{asset_id}/conversation", query: { fields: "id,timestamp,media_type,is_reply,is_reply_owned_by_me,hide_status,root_post,replied_to" } },
      threads_list_pending_replies: { provider: "META_THREADS", path: "/{asset_id}/pending_replies", query: { fields: "id,is_reply,hide_status,root_post,replied_to,reply_approval_status" } },
      threads_list_threads_publishing_limit: { provider: "META_THREADS", path: "/{asset_id}/threads_publishing_limit", query: { fields: "reply_quota_usage,reply_config" } },
    };
    if (contract.fixedQuery) {
      const projection = fixedProjections[contract.tool];
      if (!projection || contract.provider !== projection.provider || contract.path !== projection.path || contract.method !== "GET" || JSON.stringify(contract.fixedQuery) !== JSON.stringify(projection.query)) throw new Error("Unreviewed fixed query projection");
    }
    if (contract.pagination && !contract.verified) throw new Error("Unverified pagination contract");
    if(contract.assetInputArrayKeys&&!["marketing_list_client_invoice_metadata","marketing_create_disabled_pause_rule","marketing_create_classic_split_study"].includes(contract.tool)&&(!["instagram_create_carousel_container","instagram_login_create_carousel_container","threads_create_carousel_container"].includes(contract.tool)||contract.method!=="POST"||!contract.verified||!["META_INSTAGRAM_LOGIN","META_INSTAGRAM_FACEBOOK_LOGIN","META_THREADS"].includes(contract.provider)||JSON.stringify(contract.assetInputArrayKeys)!==JSON.stringify({children:"MEDIA"})))throw new Error("Unreviewed array asset inputs");
    const reviewedEligibility=reviewedEligibilityMetadata(contract);if((contract.eligibilityRequirements||contract.eligibilityPolicies)&&(JSON.stringify(contract.eligibilityRequirements)!==JSON.stringify(reviewedEligibility.eligibilityRequirements)||JSON.stringify(contract.eligibilityPolicies)!==JSON.stringify(reviewedEligibility.eligibilityPolicies)))throw new Error("Unreviewed eligibility policy: "+contract.tool);
    if(contract.tool==="marketing_list_client_invoice_metadata"&&(contract.provider!=="META_MARKETING"||contract.method!=="GET"||!contract.verified||contract.assetType!=="BUSINESS"||JSON.stringify(contract.assetInputArrayKeys)!==JSON.stringify({account_ids:"AD_ACCOUNT"})))throw new Error("Unreviewed invoice account array");
    if(contract.tool==="marketing_create_disabled_pause_rule"&&(contract.provider!=="META_MARKETING"||contract.method!=="POST"||!contract.verified||JSON.stringify(contract.assetInputArrayKeys)!==JSON.stringify({ad_ids:"AD"})))throw new Error("Unreviewed rule array inputs");
    if(contract.tool==="marketing_create_classic_split_study"&&(contract.provider!=="META_MARKETING"||contract.method!=="POST"||!contract.verified||contract.assetType!=="BUSINESS"||JSON.stringify(contract.assetInputArrayKeys)!==JSON.stringify({campaign_ids:"CAMPAIGN"})))throw new Error("Unreviewed study array inputs");
    const createdTypes: Record<string, AssetType> = {...Object.fromEntries(INSTAGRAM_IMAGE_VARIANT_CONTRACTS.map(c=>[c.tool,"MEDIA" as const])),...Object.fromEntries(THREADS_IMAGE_CONTRACTS.map(c=>[c.tool,"MEDIA" as const])),...Object.fromEntries([...INSTAGRAM_CAROUSEL_CONTRACTS,...THREADS_CAROUSEL_CONTRACTS].map(c=>[c.tool,"MEDIA" as const])),...Object.fromEntries(THREADS_VIDEO_CONTRACTS.map(c=>[c.tool,"MEDIA" as const])),marketing_create_classic_split_study:"STUDY",marketing_create_disabled_pause_rule:"RULE",marketing_create_purchase_conversion:"CUSTOM_CONVERSION",marketing_create_async_report:"REPORT",marketing_upload_video:"AD_VIDEO",marketing_create_empty_custom_audience:"AUDIENCE",marketing_create_lookalike_audience:"AUDIENCE",messenger_create_utility_template:"TEMPLATE",marketing_upload_image:"AD_IMAGE",...Object.fromEntries(INSTAGRAM_VIDEO_CONTRACTS.map(c=>[c.tool,"MEDIA" as const])),leads_create_form:"LEAD_FORM",pages_create_videos:"VIDEO", instagram_reply_comment:"COMMENT",instagram_login_reply_comment:"COMMENT", whatsapp_platform_create_template:"TEMPLATE", whatsapp_platform_create_flow:"FLOW", pages_create_feed: "POST", pages_create_photos:"POST", pages_reply_comment: "COMMENT", threads_create_container: "MEDIA", threads_publish_container: "POST", instagram_create_container: "MEDIA", instagram_login_create_container: "MEDIA", instagram_publish_container: "MEDIA", instagram_login_publish: "MEDIA" };
    if (contract.createdAssetType && (!contract.verified || createdTypes[contract.tool] !== contract.createdAssetType || contract.method !== "POST")) throw new Error("Unreviewed created asset type");
    const createdKinds: Record<string, ProductContract["createdAssetKind"]> = {...Object.fromEntries(INSTAGRAM_IMAGE_VARIANT_CONTRACTS.map(c=>[c.tool,c.createdAssetKind])),...Object.fromEntries(THREADS_IMAGE_CONTRACTS.map(c=>[c.tool,c.createdAssetKind])),...Object.fromEntries([...INSTAGRAM_CAROUSEL_CONTRACTS,...THREADS_CAROUSEL_CONTRACTS].map(c=>[c.tool,c.createdAssetKind])),...Object.fromEntries(THREADS_VIDEO_CONTRACTS.map(c=>[c.tool,c.createdAssetKind])),...Object.fromEntries(INSTAGRAM_VIDEO_CONTRACTS.map(c=>[c.tool,c.createdAssetKind])), instagram_create_container: "instagram_container", instagram_login_create_container: "instagram_container", instagram_publish_container: "instagram_published_media", instagram_login_publish: "instagram_published_media" };
    if (contract.createdAssetKind && (!contract.verified || createdKinds[contract.tool] !== contract.createdAssetKind || contract.createdAssetType !== "MEDIA")) throw new Error("Unreviewed created asset kind");
    const returnedTypes: Record<string, AssetType> = {business_list_owned_pages:"PAGE",business_list_client_pages:"PAGE",business_list_owned_ad_accounts:"AD_ACCOUNT",business_list_client_ad_accounts:"AD_ACCOUNT",business_list_owned_catalogs:"CATALOG",business_list_client_catalogs:"CATALOG",business_list_owned_wabas:"WABA", catalog_list_product_sets: "PRODUCT_SET", catalog_list_product_feeds: "FEED", catalog_list_products: "PRODUCT_ITEM" };
    if (contract.returnedAssetType && (!contract.verified || returnedTypes[contract.tool] !== contract.returnedAssetType || contract.method !== "GET")) throw new Error("Unreviewed returned asset type");
    if (contract.requiresClientOwnedBusiness && !(contract.tool===INVOICE_METADATA_CONTRACT.tool&&contract.provider===INVOICE_METADATA_CONTRACT.provider&&contract.assetType==="BUSINESS"&&contract.method==="GET"&&contract.verified) && !((CATALOG_OPERATIONAL_CONTRACTS.some(c=>c.tool===contract.tool&&c.assetType===contract.assetType))&&contract.verified&&contract.provider==="META_BUSINESS"&&contract.method==="GET") && !(contract.tool==="catalog_list_assigned_users"&&contract.verified&&contract.assetType==="CATALOG"&&contract.provider==="META_BUSINESS"&&contract.method==="GET") && (!["business_get", "business_list_users", "business_list_system_users","business_list_owned_pages","business_list_client_pages","business_list_owned_ad_accounts","business_list_client_ad_accounts","business_list_owned_catalogs","business_list_client_catalogs","business_list_owned_wabas"].includes(contract.tool) || !contract.verified || contract.assetType !== "BUSINESS" || contract.provider !== "META_BUSINESS")) throw new Error("Unreviewed client-owned business requirement");
    const evidenceUpdates: Record<string, ProductContract["assetEvidenceUpdate"]> = { threads_get_post_status: "threads_container", threads_list_replies: "threads_reply_list", threads_get_conversation: "threads_reply_list", threads_list_pending_replies: "threads_reply_list", instagram_get_container_status: "instagram_container", instagram_login_get_container_status: "instagram_container" };
    if (contract.assetEvidenceUpdate && (evidenceUpdates[contract.tool] !== contract.assetEvidenceUpdate || !contract.verified || contract.method !== "GET")) throw new Error("Unreviewed asset evidence update");
    if (contract.serverOnlyInputKeys && !(["messenger_send_video","messenger_send_audio","messenger_send_file"].includes(contract.tool)&&contract.provider==="META_MESSENGER"&&contract.verified&&contract.method==="POST"&&JSON.stringify(contract.serverOnlyInputKeys)===JSON.stringify(["source_media_id","attachment_url"])) && !(INSTAGRAM_IMAGE_VARIANT_CONTRACTS.some(c=>c.tool===contract.tool&&c.provider===contract.provider)&&contract.verified&&contract.method==="POST"&&JSON.stringify(contract.serverOnlyInputKeys)===JSON.stringify(["source_media_id","image_url"])) && !(THREADS_IMAGE_CONTRACTS.some(c=>c.tool===contract.tool&&c.provider===contract.provider)&&contract.verified&&contract.method==="POST"&&JSON.stringify(contract.serverOnlyInputKeys)===JSON.stringify(["source_media_id","image_url"])) && !(THREADS_VIDEO_CONTRACTS.some(c=>c.tool===contract.tool&&c.provider===contract.provider)&&contract.verified&&contract.method==="POST"&&JSON.stringify(contract.serverOnlyInputKeys)===JSON.stringify(["source_media_id","video_url"])) && !(["marketing_upload_image","marketing_upload_video"].includes(contract.tool)&&contract.provider==="META_MARKETING"&&contract.verified&&contract.method==="POST"&&JSON.stringify(contract.serverOnlyInputKeys)===JSON.stringify(["source_media_id"])) && !(INSTAGRAM_VIDEO_CONTRACTS.some(c=>c.tool===contract.tool&&c.provider===contract.provider)&&contract.verified&&contract.method==="POST"&&JSON.stringify(contract.serverOnlyInputKeys)===JSON.stringify(["source_media_id","video_url"])) && !(MESSAGING_IMAGE_CONTRACTS.some(c=>c.tool===contract.tool&&c.provider===contract.provider)&&contract.verified&&contract.method==="POST"&&JSON.stringify(contract.serverOnlyInputKeys)===JSON.stringify(["source_media_id","image_url"])) && !(contract.tool==="pages_create_videos"&&contract.verified&&contract.provider==="META_FACEBOOK_PAGES"&&contract.method==="POST"&&JSON.stringify(contract.serverOnlyInputKeys)===JSON.stringify(["source_media_id","video_url"])) && !(INSTAGRAM_MENTION_TOOLS.includes(contract.tool) && contract.verified && contract.provider==="META_INSTAGRAM_FACEBOOK_LOGIN" && contract.method==="GET" && JSON.stringify(contract.serverOnlyInputKeys)===JSON.stringify(contract.allowedInputKeys)) && !(contract.tool==="instagram_hashtag_search" && contract.provider==="META_INSTAGRAM_FACEBOOK_LOGIN" && contract.verified && contract.method==="GET" && JSON.stringify(contract.serverOnlyInputKeys)===JSON.stringify(["q"])) && !(contract.tool==="instagram_business_discovery" && contract.provider==="META_INSTAGRAM_FACEBOOK_LOGIN" && contract.verified && contract.method==="GET" && JSON.stringify(contract.serverOnlyInputKeys)===JSON.stringify(["username"])) && !(contract.tool==="pages_create_photos" && contract.verified && contract.provider==="META_FACEBOOK_PAGES" && contract.method==="POST" && JSON.stringify(contract.serverOnlyInputKeys)===JSON.stringify(["source_media_id","image_url"])) && !(contract.tool==="leads_retrieve" && contract.verified && contract.method==="GET" && contract.privateResponse==="client_leads" && JSON.stringify(contract.serverOnlyInputKeys)===JSON.stringify(["ad_id","created_since","created_until"])) && !(contract.tool==="whatsapp_platform_publish_flow" && contract.verified && contract.method==="POST" && JSON.stringify(contract.serverOnlyInputKeys)===JSON.stringify(["flow_json"])) && (!["instagram_create_container", "instagram_login_create_container"].includes(contract.tool) || JSON.stringify(contract.serverOnlyInputKeys) !== JSON.stringify(["source_media_id"]) || !contract.verified || contract.method !== "POST")) throw new Error("Unreviewed server-only input mapping");
  }
}

validateProductContracts(PRODUCT_CONTRACTS);
