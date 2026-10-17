import type {ProductContract} from './products/contracts.js';
import type {ManualRequirementPolicy} from './manual-eligibility.js';
/** Exact named capabilities only. Future tools do not inherit a family exception. */
const MESSENGER_RESPONSE=new Set(["messenger_send_text","messenger_send_quick_replies","messenger_send_button_template","messenger_sender_action","messenger_send_generic_template","messenger_send_image","messenger_send_video","messenger_send_audio","messenger_send_file","messenger_list_conversations","messenger_get_messages","messenger_get_message"]);
export const MESSENGER_ACCESS_OBSERVATION="Human reviewed current external-client Messenger app access and required pages_messaging/read permissions for this exact app and selected connection. This dashboard observation does not replace actual Page token, current scopes/tasks/grants, private conversation provenance or trusted recipient response window.";
const UTILITY=new Set(['messenger_list_utility_templates','messenger_create_utility_template','messenger_send_utility_template']);
export const UTILITY_ACCESS_OBSERVATION='Human reviewed current external-client Messenger Utility app access and required page_utility_messaging approval for this exact app and selected connection. This dashboard observation does not replace actual token permissions, Page authority or provider approval.';
export const UTILITY_WEBHOOK_OBSERVATION='Human reviewed this exact app/client/Page message_template_status_update subscription configuration. This observation is not proof of live webhook delivery or template approval; actual provider template status is re-read before sends.';
export const ARCHIVE_ACCESS_OBSERVATION='Human reviewed current Ad Library identity/location confirmation and app-specific archive API access for this exact selected USER connection. This observation does not certify US commercial coverage, actual successful API access or competitor completeness.';
export function reviewedFamilyEligibility(contract:ProductContract):Pick<ProductContract,'eligibilityRequirements'|'eligibilityPolicies'>|Record<string,never>{let requirements:string[]|undefined=reviewedProductFamilyEligibility(contract);if(contract.provider==='META_MESSENGER'&&MESSENGER_RESPONSE.has(contract.tool))requirements=[MESSENGER_ACCESS_OBSERVATION];if(contract.provider==='META_MESSENGER'&&UTILITY.has(contract.tool))requirements=[UTILITY_ACCESS_OBSERVATION,UTILITY_WEBHOOK_OBSERVATION];if(contract.provider==='META_MARKETING'&&contract.tool==='marketing_search_ad_library')requirements=[ARCHIVE_ACCESS_OBSERVATION];if(!requirements)return {};const policies:Record<string,ManualRequirementPolicy>=Object.fromEntries(requirements.map((r,i)=>[r,{kind:'HUMAN_ATTESTATION',maxAgeMs:i===0?86400000:3600000}]));return {eligibilityRequirements:requirements,eligibilityPolicies:policies};}

/** Frozen reviewed V1 tool names. No future product inherits stable eligibility automatically. */
const REVIEWED_PRODUCT_FAMILIES:Readonly<Record<string,readonly string[]>>={
  "META_FACEBOOK_PAGES": [
    "pages_get",
    "pages_reply_comment",
    "pages_list_comments",
    "pages_list_posts",
    "pages_list_published_posts",
    "pages_list_scheduled_posts",
    "pages_list_feed",
    "pages_get_insights",
    "pages_get_subscriptions",
    "pages_create_feed",
    "pages_create_videos",
    "pages_get_video_status",
    "pages_create_photos",
    "pages_edit_post",
    "pages_hide_comment",
    "pages_delete_comment"
  ],
  "META_INSTAGRAM_FACEBOOK_LOGIN": [
    "instagram_get_message",
    "instagram_get_profile",
    "instagram_list_media",
    "instagram_create_container",
    "instagram_publish_container",
    "instagram_get_container_status",
    "instagram_business_discovery",
    "instagram_hashtag_search",
    "instagram_get_mentions",
    "instagram_get_mentioned_media",
    "instagram_list_conversations",
    "instagram_list_comments",
    "instagram_reply_comment",
    "instagram_hide_comment",
    "instagram_delete_comment",
    "instagram_get_insights",
    "instagram_get_media_insights",
    "instagram_create_reel_container",
    "instagram_create_story_container",
    "instagram_create_carousel_item",
    "instagram_create_image_carousel_item",
    "instagram_create_image_story_container",
    "instagram_create_carousel_container"
  ],
  "META_INSTAGRAM_LOGIN": [
    "instagram_login_get_message",
    "instagram_login_profile",
    "instagram_login_list_media",
    "instagram_login_create_container",
    "instagram_login_publish",
    "instagram_login_get_container_status",
    "instagram_login_conversations",
    "instagram_login_get_messages",
    "instagram_login_list_comments",
    "instagram_login_reply_comment",
    "instagram_login_hide_comment",
    "instagram_login_delete_comment",
    "instagram_login_get_insights",
    "instagram_login_get_media_insights",
    "instagram_login_send_image",
    "instagram_login_create_reel_container",
    "instagram_login_create_story_container",
    "instagram_login_create_carousel_item",
    "instagram_login_create_image_carousel_item",
    "instagram_login_create_image_story_container",
    "instagram_login_create_carousel_container"
  ],
  "META_THREADS": [
    "threads_get_profile",
    "threads_list_threads",
    "threads_get_post",
    "threads_list_replies",
    "threads_list_insights",
    "threads_get_post_insights",
    "threads_list_threads_publishing_limit",
    "threads_create_container",
    "threads_publish_container",
    "threads_manage_reply",
    "threads_delete_post",
    "threads_get_conversation",
    "threads_list_pending_replies",
    "threads_get_post_status",
    "threads_manage_pending_reply",
    "threads_keyword_search",
    "threads_get_mentions",
    "threads_create_video_container",
    "threads_create_carousel_item",
    "threads_create_image_container",
    "threads_create_image_carousel_item",
    "threads_create_carousel_container"
  ],
  "META_MARKETING": [
    "leads_list_forms",
    "leads_get_form",
    "leads_retrieve",
    "leads_get_lead",
    "signals_send_pixel_events",
    "signals_get_offline_quality",
    "signals_get_dataset",
    "leads_create_form",
    "marketing_upload_image",
    "marketing_create_async_report",
    "marketing_create_purchase_conversion",
    "marketing_get_ad_preview",
    "marketing_create_classic_split_study",
    "marketing_create_disabled_pause_rule",
    "marketing_upload_video"
  ]
};
export const PRODUCT_ACCESS_OBSERVATION='Human reviewed current app-specific external-client App Review, access tier and required product permission approvals for this exact provider/app/selected connection. This dashboard observation grants no API authority and never replaces current credential, scopes, registry grants, client ownership, task, privacy, provider state, source rights or one-time approval checks.';
export const INSTAGRAM_ACCOUNT_OBSERVATION='Human reviewed current exact professional-account eligibility, Page Publishing Authorization and two-factor requirements where applicable for this login family. Business-only Story eligibility is separately reviewed; Facebook Login relies on provider enforcement of the approved draft and does not claim unsupported account_type API proof. Actual credential/account/Page/task and source/status/quota checks remain mandatory.';
export const MARKETING_DATA_OBSERVATION='Human reviewed current client assignment in Leads Access Manager or partial dataset Use events access where applicable to this exact selected Marketing connection and registered assets. This dashboard observation does not replace actual selected-ad/form/Page/account closure, private lead access projection, trusted first-party consent/source proof, provider ownership observation or separate billing attestation.';
function reviewedProductFamilyEligibility(contract:ProductContract):string[]|undefined{if(!REVIEWED_PRODUCT_FAMILIES[contract.provider]?.includes(contract.tool))return undefined;return [PRODUCT_ACCESS_OBSERVATION,...(contract.tool==='pages_get_insights'?[PAGE_INSIGHTS_OBSERVATION]:[]),...(['META_INSTAGRAM_FACEBOOK_LOGIN','META_INSTAGRAM_LOGIN'].includes(contract.provider)?[INSTAGRAM_ACCOUNT_OBSERVATION]:contract.provider==='META_MARKETING'&&(/^(leads_|signals_)/.test(contract.tool))?[MARKETING_DATA_OBSERVATION]:[])];}

export const PAGE_INSIGHTS_OBSERVATION='Human reviewed the exact client Page Insights eligibility requirement of at least100 Page likes and selected Page ANALYZE authority. This dashboard observation does not certify actual available metrics, which may be delayed, empty or unavailable; current token/task/grants and bounded provider result checks remain mandatory.';
