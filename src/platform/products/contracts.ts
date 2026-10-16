import type { AssetType, Connection, OperationClass, Provider } from "../models.js";

export interface ProductContract {
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
  allowedInputKeys: string[];
  fixedQuery?: Record<string, string>;
  pagination?: boolean;
  responseFields?: string[];
  assetInputKeys?: Record<string, AssetType>;
  documentation: string[];
  verified: boolean;
  unverifiedReason?: string;
  requiresMessagingWindow?: boolean;
  createOrCopy?: boolean;
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
  pages_list_feed: ["data.id", "data.created_time", "data.is_published"],
  pages_create_feed: ["id"],
  instagram_login_conversations: ["data.id", "data.updated_time"],
  instagram_login_get_messages: ["id", "messages.data.id", "messages.data.created_time"],
  instagram_list_conversations: ["data.id", "data.updated_time"],
  messenger_list_conversations: ["data.id", "data.updated_time"],
  messenger_get_messages: ["id", "messages.data.id", "messages.data.created_time"],
  messenger_send_text: ["recipient_id", "message_id"],
  threads_get_profile: ["id", "username", "name", "is_verified"],
  threads_list_threads: ["data.id", "data.media_type", "data.timestamp", "paging.cursors.before", "paging.cursors.after"],
  threads_get_post: ["id", "media_type", "timestamp"],
  whatsapp_platform_list_phones: ["data.id", "data.verified_name", "data.quality_rating"],
  whatsapp_platform_get_phone: ["id", "verified_name", "quality_rating", "code_verification_status"],
  whatsapp_platform_list_templates: ["data.id", "data.name", "data.category", "data.status"],
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

function whatsappRead(tool: string, assetType: AssetType, path: string, documentation: string): ProductContract {
  return confirmed(hold("whatsapp", tool, "META_WHATSAPP", assetType, "GET", path, [], ["READ"], documentation), {
    requiredScopes: ["whatsapp_business_management"], tokenTypes: ["system_user", "business_integration_system_user"], allowedInputKeys: [],
    documentation: [documentation, "https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions", "https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens"],
    manualRequirements: [...WHATSAPP_READ_REQUIREMENTS],
  });
}

export const PRODUCT_CONTRACTS: readonly ProductContract[] = Object.freeze([
  hold("business", "business_get", "META_BUSINESS", "BUSINESS", "GET", "/{asset_id}", ["business_management"], ["READ"], SOURCES.business),
  ...[
    ["business_list_owned_pages", "owned_pages"], ["business_list_client_pages", "client_pages"],
    ["business_list_owned_ad_accounts", "owned_ad_accounts"], ["business_list_client_ad_accounts", "client_ad_accounts"],
    ["business_list_system_users", "system_users"], ["business_list_users", "business_users"],
    ["business_list_owned_catalogs", "owned_product_catalogs"], ["business_list_client_catalogs", "client_product_catalogs"],
    ["business_list_owned_wabas", "owned_whatsapp_business_accounts"],
  ].map(([tool, edge]) => hold("business", tool!, "META_BUSINESS", "BUSINESS", "GET", `/{asset_id}/${edge}`, ["business_management"], ["READ"], SOURCES.business)),
  hold("business", "business_get_asset_permissions", "META_BUSINESS", "BUSINESS", "GET", "/{asset_id}/assigned_users", ["business_management"], ["READ"], SOURCES.business),
  hold("pages", "pages_get", "META_FACEBOOK_PAGES", "PAGE", "GET", "/{asset_id}", ["pages_read_engagement"], ["READ"], SOURCES.pages),
  ...["posts", "published_posts", "scheduled_posts"].map(edge => hold("pages", `pages_list_${edge}`, "META_FACEBOOK_PAGES", "PAGE", "GET", `/{asset_id}/${edge}`, ["pages_read_engagement"], ["READ"], SOURCES.pages)),
  confirmed(hold("pages", "pages_list_feed", "META_FACEBOOK_PAGES", "PAGE", "GET", "/{asset_id}/feed", [], ["READ"], SOURCES.pages), {
    requiredScopes: ["pages_read_engagement", "pages_read_user_content"], tokenTypes: ["page"], requiredTasks: ["CREATE_CONTENT"], allowedInputKeys: [],
    documentation: ["https://developers.facebook.com/docs/graph-api/reference/v26.0/page/feed"],
    manualRequirements: ["Page-owned/manageable content only; no public-content-access fallback.", "Initial task subset is CREATE_CONTENT. Reference also permits MANAGE or MODERATE; those alternatives remain unimplemented rather than falsely requiring all three.", "External-user app access and client Page grant require independent evidence."],
  }),
  hold("pages", "pages_get_insights", "META_FACEBOOK_PAGES", "PAGE", "GET", "/{asset_id}/insights", ["read_insights"], ["READ"], SOURCES.pages),
  hold("pages", "pages_get_subscriptions", "META_FACEBOOK_PAGES", "PAGE", "GET", "/{asset_id}/subscribed_apps", ["pages_manage_metadata"], ["READ"], SOURCES.pages),
  confirmed(hold("pages", "pages_create_feed", "META_FACEBOOK_PAGES", "PAGE", "POST", "/{asset_id}/feed", [], ["WRITE_CONTENT"], SOURCES.pages), {
    requiredScopes: ["pages_manage_posts", "pages_read_engagement", "pages_show_list"], tokenTypes: ["page"], requiredTasks: ["CREATE_CONTENT"], allowedInputKeys: ["message", "link", "published"],
    documentation: ["https://developers.facebook.com/docs/graph-api/reference/v26.0/page/feed"],
    manualRequirements: ["Reference Requirements lists these three permissions; later Permissions section repeats only pages_manage_posts. Use the conservative documented requirements, not a claim of globally minimal scopes.", "Validate either message or link, published boolean and safe link URL; mentions require separate asset provenance and are initially rejected.", "Scheduling omitted because reference says 75 days while current guide says 30 days; no silent choice of permissive window."],
  }),
  ...["photos", "videos"].map(edge => hold("pages", `pages_create_${edge}`, "META_FACEBOOK_PAGES", "PAGE", "POST", `/{asset_id}/${edge}`, ["pages_manage_posts"], ["WRITE_CONTENT"], SOURCES.pages)),
  hold("pages", "pages_edit_post", "META_FACEBOOK_PAGES", "POST", "POST", "/{asset_id}", ["pages_manage_posts"], ["WRITE_CONTENT"], SOURCES.pages),
  hold("pages", "pages_delete_post", "META_FACEBOOK_PAGES", "POST", "DELETE", "/{asset_id}", ["pages_manage_posts"], ["DELETE"], "https://developers.facebook.com/docs/graph-api/reference/pagepost", "UNVERIFIED: current PagePost reference restricts API deletion to select developers; Lumin eligibility and exact permission contract are not established."),
  hold("pages", "pages_reply_comment", "META_FACEBOOK_PAGES", "COMMENT", "POST", "/{asset_id}/comments", ["pages_manage_engagement"], ["WRITE_CONTENT"], SOURCES.pages),
  hold("pages", "pages_hide_comment", "META_FACEBOOK_PAGES", "COMMENT", "POST", "/{asset_id}", ["pages_manage_engagement"], ["WRITE_CONTENT"], SOURCES.pages),
  hold("pages", "pages_delete_comment", "META_FACEBOOK_PAGES", "COMMENT", "DELETE", "/{asset_id}", ["pages_manage_engagement"], ["DELETE"], SOURCES.pages),
  hold("instagram", "instagram_get_profile", "META_INSTAGRAM_FACEBOOK_LOGIN", "INSTAGRAM_ACCOUNT", "GET", "/{asset_id}", ["instagram_basic"], ["READ"], SOURCES.instagram),
  hold("instagram", "instagram_list_media", "META_INSTAGRAM_FACEBOOK_LOGIN", "INSTAGRAM_ACCOUNT", "GET", "/{asset_id}/media", ["instagram_basic"], ["READ"], SOURCES.instagram),
  hold("instagram", "instagram_create_container", "META_INSTAGRAM_FACEBOOK_LOGIN", "INSTAGRAM_ACCOUNT", "POST", "/{asset_id}/media", ["instagram_content_publish"], ["WRITE_CONTENT"], SOURCES.instagram),
  hold("instagram", "instagram_publish_container", "META_INSTAGRAM_FACEBOOK_LOGIN", "INSTAGRAM_ACCOUNT", "POST", "/{asset_id}/media_publish", ["instagram_content_publish"], ["WRITE_CONTENT"], SOURCES.instagram),
  hold("instagram", "instagram_get_container_status", "META_INSTAGRAM_FACEBOOK_LOGIN", "MEDIA", "GET", "/{asset_id}", ["instagram_basic"], ["READ"], SOURCES.instagram),
  hold("instagram", "instagram_list_comments", "META_INSTAGRAM_FACEBOOK_LOGIN", "MEDIA", "GET", "/{asset_id}/comments", ["instagram_manage_comments"], ["READ"], SOURCES.instagram),
  hold("instagram", "instagram_reply_comment", "META_INSTAGRAM_FACEBOOK_LOGIN", "COMMENT", "POST", "/{asset_id}/replies", ["instagram_manage_comments"], ["WRITE_CONTENT"], SOURCES.instagram),
  hold("instagram", "instagram_hide_comment", "META_INSTAGRAM_FACEBOOK_LOGIN", "COMMENT", "POST", "/{asset_id}", ["instagram_manage_comments"], ["WRITE_CONTENT"], SOURCES.instagram),
  hold("instagram", "instagram_delete_comment", "META_INSTAGRAM_FACEBOOK_LOGIN", "COMMENT", "DELETE", "/{asset_id}", ["instagram_manage_comments"], ["DELETE"], SOURCES.instagram),
  hold("instagram", "instagram_get_insights", "META_INSTAGRAM_FACEBOOK_LOGIN", "INSTAGRAM_ACCOUNT", "GET", "/{asset_id}/insights", ["instagram_manage_insights"], ["READ"], SOURCES.instagram),
  hold("instagram", "instagram_get_media_insights", "META_INSTAGRAM_FACEBOOK_LOGIN", "MEDIA", "GET", "/{asset_id}/insights", ["instagram_manage_insights"], ["READ"], SOURCES.instagram),
  hold("instagram", "instagram_business_discovery", "META_INSTAGRAM_FACEBOOK_LOGIN", "INSTAGRAM_ACCOUNT", "GET", "/{asset_id}", ["instagram_basic"], ["READ"], SOURCES.instagram),
  hold("instagram", "instagram_hashtag_search", "META_INSTAGRAM_FACEBOOK_LOGIN", "INSTAGRAM_ACCOUNT", "GET", "/ig_hashtag_search", [], ["READ"], SOURCES.instagram),
  hold("instagram", "instagram_get_mentions", "META_INSTAGRAM_FACEBOOK_LOGIN", "INSTAGRAM_ACCOUNT", "GET", "/{asset_id}", ["instagram_basic"], ["READ"], SOURCES.instagram),
  hold("instagram", "instagram_login_profile", "META_INSTAGRAM_LOGIN", "INSTAGRAM_ACCOUNT", "GET", "/{asset_id}", ["instagram_business_basic"], ["READ"], SOURCES.instagramLogin),
  hold("instagram", "instagram_login_publish", "META_INSTAGRAM_LOGIN", "INSTAGRAM_ACCOUNT", "POST", "/{asset_id}/media_publish", ["instagram_business_content_publish"], ["WRITE_CONTENT"], SOURCES.instagramLogin),
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
  ...["replies", "insights", "threads_publishing_limit"].map(edge => hold("threads", `threads_list_${edge}`, "META_THREADS", "THREADS_ACCOUNT", "GET", `/{asset_id}/${edge}`, [], ["READ"], SOURCES.threads)),
  hold("threads", "threads_create_container", "META_THREADS", "THREADS_ACCOUNT", "POST", "/{asset_id}/threads", ["threads_content_publish"], ["WRITE_CONTENT"], SOURCES.threads, "UNVERIFIED: request observed but exact minimum scope set unresolved. auto_publish_text is prohibited because container creation can publish immediately."),
  hold("threads", "threads_publish_container", "META_THREADS", "THREADS_ACCOUNT", "POST", "/{asset_id}/threads_publish", ["threads_content_publish"], ["WRITE_CONTENT"], SOURCES.threads),
  hold("threads", "threads_manage_reply", "META_THREADS", "POST", "POST", "/{asset_id}/manage_reply", ["threads_manage_replies"], ["WRITE_CONTENT"], SOURCES.threads),
  hold("threads", "threads_delete_post", "META_THREADS", "POST", "DELETE", "/{asset_id}", ["threads_delete"], ["DELETE"], SOURCES.threads),
  hold("threads", "threads_keyword_search", "META_THREADS", "THREADS_ACCOUNT", "GET", "/keyword_search", ["threads_keyword_search"], ["READ"], SOURCES.threads),
  hold("threads", "threads_get_mentions", "META_THREADS", "THREADS_ACCOUNT", "GET", "/{asset_id}/mentions", ["threads_manage_mentions"], ["READ"], SOURCES.threads),
  hold("threads", "threads_get_conversation", "META_THREADS", "POST", "GET", "/{asset_id}/conversation", ["threads_read_replies"], ["READ"], SOURCES.threads),
  hold("threads", "threads_get_post_status", "META_THREADS", "MEDIA", "GET", "/{asset_id}", ["threads_content_publish"], ["READ"], SOURCES.threads),
  hold("threads", "threads_manage_pending_reply", "META_THREADS", "POST", "POST", "/{asset_id}/manage_pending_reply", ["threads_manage_replies"], ["WRITE_CONTENT"], SOURCES.threads),
  hold("leads", "leads_list_forms", "META_MARKETING", "PAGE", "GET", "/{asset_id}/leadgen_forms", [], ["READ"], SOURCES.leads),
  hold("leads", "leads_get_form", "META_MARKETING", "LEAD_FORM", "GET", "/{asset_id}", [], ["READ"], SOURCES.leads),
  hold("leads", "leads_retrieve", "META_MARKETING", "LEAD_FORM", "GET", "/{asset_id}/leads", ["leads_retrieval"], ["READ"], SOURCES.leads),
  { ...confirmed(hold("leads", "leads_get_lead", "META_MARKETING", "LEAD", "GET", "/{asset_id}", [], ["READ"], SOURCES.leads), {
    requiredScopes:["ads_management","leads_retrieval","pages_show_list","pages_read_engagement","pages_manage_ads"],tokenTypes:["page","user"],allowedInputKeys:[],
    documentation:["https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving"],
    manualRequirements:["Token must be requested by a person authorized to advertise on both the client Page and client ad account; documented full lead/ad-data permission pack is used conservatively.","Leads Access Manager access must be independently verified: customized lead access is not implied by Page administrator status.","Initial ad-lead metadata subset requires a registered lead with explicit same-client LEAD_FORM, PAGE and AD_ACCOUNT ancestry and fresh grants to every parent. Signed leadgen webhook provenance must bind leadgen_id to the exact form/Page; raw foreign IDs are rejected.","Server fixes fields=id,created_time and returns metadata only. Full field_data/contact information and custom-disclaimer responses require a separate trusted receiving adapter and privacy/consent review; no LeadGate coupling is assumed.","External-user app permission/access review and current Meta product/API-version eligibility must be independently verified before execution."],
  }),fixedQuery:{fields:"id,created_time"} },
  hold("signals", "signals_get_dataset", "META_MARKETING", "DATASET", "GET", "/{asset_id}", [], ["READ"], SOURCES.signals),
  hold("signals", "signals_send_events", "META_MARKETING", "DATASET", "POST", "/{asset_id}/events", [], ["WRITE_NON_FINANCIAL"], SOURCES.signals, "UNVERIFIED: token eligibility and exact active-version schema must be verified. Source truth, event_id deduplication, PII normalization/hashing and privacy validation are mandatory before execution."),
  confirmed(hold("signals", "signals_send_pixel_events", "META_MARKETING", "PIXEL", "POST", "/{asset_id}/events", [], ["WRITE_NON_FINANCIAL"], SOURCES.signals), {
    requiredScopes:["ads_management","pages_read_engagement","ads_read"],tokenTypes:["system_user"],allowedInputKeys:["source_reference","consent_reference"],
    documentation:["https://developers.facebook.com/documentation/ads-commerce/conversions-api/set-up-conversions-api-as-a-platform","https://developers.facebook.com/documentation/ads-commerce/conversions-api/using-the-api","https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ads-pixel/events"],
    manualRequirements:["Agency platform requires independently verified App Review Advanced Access and Marketing API Access Tier plus documented platform permissions; direct own-business exemptions do not establish agency eligibility.","System user must have the client-owned Pixel assigned with Manage Pixel access; client authorization and Lumin same-client asset grant remain mandatory. Do not infer dataset IDs equal Pixel IDs.","Use the dedicated trusted first-party dispatcher: model input contains only source and consent references. Resolve actual events internally, verify payload-bound source/consent evidence, normalize/hash required PII, preserve event_id/event_name and durable deduplication checkpoints.","No synthetic or fabricated conversions. test_event_code is disabled: current Using API documentation says test-code events are not dropped and can be used for targeting and ads measurement.","Exactly one event and one guarded egress attempt per durable checkpoint; transport uncertainty remains UNKNOWN with no automatic retry. Accepted count does not prove attribution, optimization, match quality or completed delivery.","Production trusted-source resolver, consent adapter, durable dispatcher store and guarded transport must be configured and reviewed before execution; generic product-body handling must not bypass the dedicated dispatcher."],
  }),
  ...["product_feeds", "product_sets", "products", "assigned_users"].map(edge => hold("catalog", `catalog_list_${edge}`, "META_BUSINESS", "CATALOG", "GET", `/{asset_id}/${edge}`, ["catalog_management"], ["READ"], SOURCES.catalog)),
  hold("oembed", "oembed_facebook", "META_FACEBOOK_PAGES", "APP", "GET", "/oembed_post", [], ["READ"], SOURCES.oembed, "UNVERIFIED: current supported oEmbed endpoint, feature/access-token eligibility and content restrictions must be verified; missing documentation is not evidence of removal."),
  hold("oembed", "oembed_instagram", "META_INSTAGRAM_FACEBOOK_LOGIN", "APP", "GET", "/instagram_oembed", [], ["READ"], SOURCES.oembed),
  whatsappRead("whatsapp_platform_list_phones", "MESSAGING_ACCOUNT", "/{asset_id}/phone_numbers", "https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers"),
  hold("whatsapp", "whatsapp_platform_get_subscriptions", "META_WHATSAPP", "WABA", "GET", "/{asset_id}/subscribed_apps", ["whatsapp_business_management"], ["READ"], SOURCES.whatsapp),
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
  { ...whatsappRead("whatsapp_platform_list_templates", "MESSAGING_ACCOUNT", "/{asset_id}/message_templates", "https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-management"), fixedQuery: { fields: "name,category,status" } },
  hold("whatsapp", "whatsapp_platform_list_flows", "META_WHATSAPP", "WABA", "GET", "/{asset_id}/flows", ["whatsapp_business_management"], ["READ"], SOURCES.whatsapp),
  whatsappRead("whatsapp_platform_get_phone", "WHATSAPP_PHONE", "/{asset_id}", "https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers"),
  ...["register", "request_code", "verify_code"].map(edge => hold("whatsapp", `whatsapp_platform_${edge}`, "META_WHATSAPP", "WHATSAPP_PHONE", "POST", `/{asset_id}/${edge}`, ["whatsapp_business_management"], ["IDENTITY_OR_ACCESS"], SOURCES.whatsapp)),
  hold("whatsapp", "whatsapp_platform_get_profile", "META_WHATSAPP", "WHATSAPP_PHONE", "GET", "/{asset_id}/whatsapp_business_profile", ["whatsapp_business_management"], ["READ"], SOURCES.whatsapp),
  hold("whatsapp", "whatsapp_platform_create_template", "META_WHATSAPP", "WABA", "POST", "/{asset_id}/message_templates", ["whatsapp_business_management"], ["WRITE_CONTENT"], SOURCES.whatsapp),
  hold("whatsapp", "whatsapp_platform_delete_template", "META_WHATSAPP", "WABA", "DELETE", "/{asset_id}/message_templates", ["whatsapp_business_management"], ["DELETE"], SOURCES.whatsapp),
  hold("whatsapp", "whatsapp_platform_create_flow", "META_WHATSAPP", "WABA", "POST", "/{asset_id}/flows", ["whatsapp_business_management"], ["WRITE_NON_FINANCIAL"], SOURCES.whatsapp),
  ...["publish", "deprecate"].map(edge => hold("whatsapp", `whatsapp_platform_${edge}_flow`, "META_WHATSAPP", "FLOW", "POST", `/{asset_id}/${edge}`, ["whatsapp_business_management"], ["WRITE_CONTENT"], SOURCES.whatsapp)),
  hold("whatsapp", "whatsapp_platform_delete_flow", "META_WHATSAPP", "FLOW", "DELETE", "/{asset_id}", ["whatsapp_business_management"], ["DELETE"], SOURCES.whatsapp),
  hold("whatsapp", "whatsapp_platform_upload_flow_json", "META_WHATSAPP", "FLOW", "POST", "/{asset_id}/assets", ["whatsapp_business_management"], ["WRITE_NON_FINANCIAL"], SOURCES.whatsapp),
  hold("whatsapp", "whatsapp_platform_subscribe", "META_WHATSAPP", "WABA", "POST", "/{asset_id}/subscribed_apps", ["whatsapp_business_management"], ["IDENTITY_OR_ACCESS"], SOURCES.whatsapp),
  hold("whatsapp", "whatsapp_platform_unsubscribe", "META_WHATSAPP", "WABA", "DELETE", "/{asset_id}/subscribed_apps", ["whatsapp_business_management"], ["IDENTITY_OR_ACCESS"], SOURCES.whatsapp),
]);

export function validateProductContracts(contracts: readonly ProductContract[]): void {
  const ids = new Set<string>();
  const tools = new Set<string>();
  for (const contract of contracts) {
    if (ids.has(contract.id) || tools.has(contract.tool)) throw new Error("Duplicate product contract identity");
    ids.add(contract.id); tools.add(contract.tool);
    if (!/^[a-z][a-z0-9_]+$/.test(contract.tool)) throw new Error("Invalid product tool name");
    if (!contract.path.startsWith("/") || contract.path.includes("?") || contract.path.includes("..") || contract.path.includes("://")) throw new Error("Invalid product path");
    if (contract.documentation.length === 0 || contract.documentation.some(link => !/^https:\/\/(developers\.facebook\.com|www\.postman\.com\/meta|github\.com\/fbsamples)\//.test(link))) throw new Error("Primary documentation required");
    if (!contract.operationClasses.length) throw new Error("Operation classification required");
    if (!contract.verified && !contract.unverifiedReason?.startsWith("UNVERIFIED:")) throw new Error("Unverified contract needs a precise reason");
    if (contract.verified && (!contract.requiredScopes.length || !contract.tokenTypes.length || contract.unverifiedReason)) throw new Error("Verified contract requires scope and token evidence");
    if (contract.verified && (!contract.responseFields?.length || JSON.stringify(contract.responseFields) !== JSON.stringify(RESPONSE_PROJECTIONS[contract.tool]))) throw new Error("Verified contract requires reviewed response projection");
    if (contract.responseFields?.some(field => !/^[a-z_]+(?:\.[a-z_]+)*$/.test(field) || /(?:token|secret|credential|password|payload|next|previous|message$|text$|url$)/.test(field))) throw new Error("Unsafe response projection");
    if (!contract.pagination && contract.responseFields?.some(field => field.startsWith("paging."))) throw new Error("Paging projection requires verified pagination");
    if (contract.method !== "GET" && contract.operationClasses.includes("READ")) throw new Error("Mutation cannot be classified READ");
    if (contract.operationClasses.includes("WRITE_MESSAGING") && contract.verified && !contract.requiresMessagingWindow) throw new Error("Messaging contract requires a policy window");
    if (contract.allowedInputKeys.some(key => ["access_token", "appsecret_proof", "url", "path", "fields", "auto_publish_text"].includes(key))) throw new Error("Unsafe unrestricted input key");
    const fixedProjections: Record<string, { provider: Provider; path: string; query: Record<string, string> }> = {
      instagram_login_get_messages: { provider: "META_INSTAGRAM_LOGIN", path: "/{asset_id}", query: { fields: "messages" } },
      instagram_list_conversations: { provider: "META_INSTAGRAM_FACEBOOK_LOGIN", path: "/{asset_id}/conversations", query: { platform: "instagram" } },
      messenger_list_conversations: { provider: "META_MESSENGER", path: "/{asset_id}/conversations", query: { platform: "messenger" } },
      messenger_get_messages: { provider: "META_MESSENGER", path: "/{asset_id}", query: { fields: "messages" } },
      whatsapp_platform_list_templates: { provider: "META_WHATSAPP", path: "/{asset_id}/message_templates", query: { fields: "name,category,status" } },
      leads_get_lead: { provider: "META_MARKETING", path: "/{asset_id}", query: { fields: "id,created_time" } },
    };
    if (contract.fixedQuery) {
      const projection = fixedProjections[contract.tool];
      if (!projection || contract.provider !== projection.provider || contract.path !== projection.path || contract.method !== "GET" || JSON.stringify(contract.fixedQuery) !== JSON.stringify(projection.query)) throw new Error("Unreviewed fixed query projection");
    }
    if (contract.pagination && !contract.verified) throw new Error("Unverified pagination contract");
  }
}

validateProductContracts(PRODUCT_CONTRACTS);
