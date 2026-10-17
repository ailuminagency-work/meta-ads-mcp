# Meta capability matrix

The exhaustive current source permission matrix and primary references are generated in [generated-tool-inventory.md](generated-tool-inventory.md) and [generated-tool-inventory.json](generated-tool-inventory.json). Regenerate them after source freeze. The detailed notes below retain earlier reviewed subsets and must be read with the newer per-feature documents; historical contract counts have been removed. Source contracts establish neither current Lumin grants nor provider approval or staging acceptance.

## Status and execution rules

VERIFIED_CONTRACT means primary documentation establishes the endpoint, documented scope/token requirements and safe bounded request/response subset. Some documented scope packs are conservative sufficient requirements rather than universal minima. Every runtime call still requires active tenant/client membership, an exact provider/app connection, fresh grants for the target and all parents, server-owned eligibility evidence, policy and audit gates. Confirmation-required writes need one-time human approval. Missing evidence is UNVERIFIED; it does not prove Meta does not support an API. HOLD entries are metadata only; unverified oEmbed tools are not registered.

This branch does not establish live-provider acceptance, App Review submission, app publication, expanded consent or production mutation. Tests use fixtures and fake provider responses.

## Verified endpoint subsets

| Tool | Provider / asset | Method and path | Documented scopes | Token / initial task subset | Safe response fields | Primary evidence |
|---|---|---|---|---|---|---|
| whatsapp_platform_list_flows | META_WHATSAPP / MESSAGING_ACCOUNT | GET /{asset_id}/flows | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user / no enumerated task contract | data.id, data.name, data.status | [source 1](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flowsapi) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens) [source 3](https://developers.facebook.com/docs/permissions) |
| whatsapp_platform_get_flow | META_WHATSAPP / FLOW | GET /{asset_id} | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user / no enumerated task contract | id, name, status, json_version, whatsapp_business_account.id, application.id | [source 1](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flowsapi) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens) [source 3](https://developers.facebook.com/docs/permissions) |
| whatsapp_platform_create_flow | META_WHATSAPP / MESSAGING_ACCOUNT | POST /{asset_id}/flows | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user / no enumerated task contract | id, success | [source 1](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flowsapi) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens) [source 3](https://developers.facebook.com/docs/permissions) |
| whatsapp_platform_update_flow | META_WHATSAPP / FLOW | POST /{asset_id} | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user / no enumerated task contract | success | [source 1](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flowsapi) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens) [source 3](https://developers.facebook.com/docs/permissions) |
| whatsapp_platform_upload_flow_json | META_WHATSAPP / FLOW | POST /{asset_id}/assets | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user / no enumerated task contract | success | [source 1](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flowsapi) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens) [source 3](https://developers.facebook.com/docs/permissions) |
| whatsapp_platform_publish_flow | META_WHATSAPP / FLOW | POST /{asset_id}/publish | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user / no enumerated task contract | success | [source 1](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flowsapi) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens) [source 3](https://developers.facebook.com/docs/permissions) |
| whatsapp_platform_deprecate_flow | META_WHATSAPP / FLOW | POST /{asset_id}/deprecate | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user / no enumerated task contract | success | [source 1](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flowsapi) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens) [source 3](https://developers.facebook.com/docs/permissions) |
| whatsapp_platform_delete_flow | META_WHATSAPP / FLOW | DELETE /{asset_id} | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user / no enumerated task contract | success | [source 1](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flowsapi) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens) [source 3](https://developers.facebook.com/docs/permissions) |
| whatsapp_platform_list_templates | META_WHATSAPP / MESSAGING_ACCOUNT | GET /{asset_id}/message_templates | whatsapp_business_management | business_integration_system_user / no enumerated task contract | data.id, data.name, data.language, data.category, data.status | [source 1](https://developers.facebook.com/docs/permissions) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-management) [source 3](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/message-template-api) [source 4](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components) |
| whatsapp_platform_create_template | META_WHATSAPP / MESSAGING_ACCOUNT | POST /{asset_id}/message_templates | whatsapp_business_management | business_integration_system_user / no enumerated task contract | id, status, category | [source 1](https://developers.facebook.com/docs/permissions) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-management) [source 3](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/message-template-api) [source 4](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components) |
| whatsapp_platform_get_template | META_WHATSAPP / TEMPLATE | GET /{asset_id} | whatsapp_business_management | business_integration_system_user / no enumerated task contract | id, name, language, category, status | [source 1](https://developers.facebook.com/docs/permissions) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-management) [source 3](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/message-template-api) [source 4](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components) |
| whatsapp_platform_update_template | META_WHATSAPP / TEMPLATE | POST /{asset_id} | whatsapp_business_management | business_integration_system_user / no enumerated task contract | success | [source 1](https://developers.facebook.com/docs/permissions) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-management) [source 3](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/message-template-api) [source 4](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components) |
| whatsapp_platform_delete_template | META_WHATSAPP / TEMPLATE | DELETE /{asset_id}/message_templates | whatsapp_business_management | business_integration_system_user / no enumerated task contract | success | [source 1](https://developers.facebook.com/docs/permissions) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-management) [source 3](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/message-template-api) [source 4](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components) |
| whatsapp_platform_get_subscriptions | META_WHATSAPP / MESSAGING_ACCOUNT | GET /{asset_id}/subscribed_apps | whatsapp_business_management | business_integration_system_user / no enumerated task contract | app_id, subscribed, other_apps_withheld | [source 1](https://developers.facebook.com/docs/permissions) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/subscribed-apps-api) [source 3](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api) |
| whatsapp_platform_subscribe | META_WHATSAPP / MESSAGING_ACCOUNT | POST /{asset_id}/subscribed_apps | whatsapp_business_management | business_integration_system_user / no enumerated task contract | success | [source 1](https://developers.facebook.com/docs/permissions) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/subscribed-apps-api) [source 3](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api) |
| whatsapp_platform_unsubscribe | META_WHATSAPP / MESSAGING_ACCOUNT | DELETE /{asset_id}/subscribed_apps | whatsapp_business_management | business_integration_system_user / no enumerated task contract | success | [source 1](https://developers.facebook.com/docs/permissions) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/subscribed-apps-api) [source 3](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api) |
| messenger_get_message | META_MESSENGER / MESSAGE | GET /{asset_id} | pages_manage_metadata, pages_read_engagement, pages_messaging, pages_show_list | page / MESSAGING | id, created_time, from.id, to.data.id, message | [source 1](https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversations) [source 2](https://developers.facebook.com/docs/permissions) |
| instagram_get_message | META_INSTAGRAM_FACEBOOK_LOGIN / MESSAGE | GET /{asset_id} | instagram_basic, instagram_manage_messages, pages_manage_metadata, pages_read_user_content, pages_show_list, pages_read_engagement | page / MESSAGING | id, created_time, from.id, to.data.id, message | [source 1](https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversations) [source 2](https://developers.facebook.com/docs/permissions) |
| instagram_login_get_message | META_INSTAGRAM_LOGIN / MESSAGE | GET /{asset_id} | instagram_business_basic, instagram_business_manage_messages | instagram / no enumerated task contract | id, created_time, from.id, to.data.id, message | [source 1](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api) [source 2](https://developers.facebook.com/docs/permissions) |
| business_get | META_BUSINESS / BUSINESS | GET /{asset_id} | business_management, pages_read_engagement, pages_show_list | user / no enumerated task contract | id, name | [source 1](https://developers.facebook.com/docs/business-management-apis/business-manager/get-started) [source 2](https://developers.facebook.com/docs/permissions) |
| business_list_owned_pages | META_BUSINESS / BUSINESS | GET /{asset_id}/owned_pages | business_management, ads_management, pages_read_engagement, pages_show_list | user / no enumerated task contract | data.id, data.name | [source 1](https://developers.facebook.com/docs/business-management-apis/businessmanager/support#faq_439412163553622) [source 2](https://developers.facebook.com/docs/business-management-apis/business-asset-management/guides/pages) [source 3](https://github.com/facebook/facebook-business-sdk-codegen/blob/main/api_specs/specs/Business.json) [source 4](https://developers.facebook.com/docs/permissions) |
| business_list_client_pages | META_BUSINESS / BUSINESS | GET /{asset_id}/client_pages | business_management, ads_management, pages_read_engagement, pages_show_list | user / no enumerated task contract | data.id, data.name | [source 1](https://developers.facebook.com/docs/business-management-apis/businessmanager/support#faq_439412163553622) [source 2](https://developers.facebook.com/docs/business-management-apis/business-asset-management/guides/pages) [source 3](https://github.com/facebook/facebook-business-sdk-codegen/blob/main/api_specs/specs/Business.json) [source 4](https://developers.facebook.com/docs/permissions) |
| business_list_owned_ad_accounts | META_BUSINESS / BUSINESS | GET /{asset_id}/owned_ad_accounts | business_management, ads_management, pages_read_engagement, pages_show_list | user / no enumerated task contract | data.id, data.name | [source 1](https://developers.facebook.com/docs/business-management-apis/businessmanager/support#faq_439412163553622) [source 2](https://developers.facebook.com/docs/business-management-apis/business-asset-management/guides/ad-accounts) [source 3](https://github.com/facebook/facebook-business-sdk-codegen/blob/main/api_specs/specs/Business.json) [source 4](https://developers.facebook.com/docs/permissions) |
| business_list_client_ad_accounts | META_BUSINESS / BUSINESS | GET /{asset_id}/client_ad_accounts | business_management, ads_management, pages_read_engagement, pages_show_list | user / no enumerated task contract | data.id, data.name | [source 1](https://developers.facebook.com/docs/business-management-apis/businessmanager/support#faq_439412163553622) [source 2](https://developers.facebook.com/docs/business-management-apis/business-asset-management/guides/ad-accounts) [source 3](https://github.com/facebook/facebook-business-sdk-codegen/blob/main/api_specs/specs/Business.json) [source 4](https://developers.facebook.com/docs/permissions) |
| business_list_owned_catalogs | META_BUSINESS / BUSINESS | GET /{asset_id}/owned_product_catalogs | business_management, ads_management, pages_read_engagement, pages_show_list | user / no enumerated task contract | data.id, data.name | [source 1](https://developers.facebook.com/docs/business-management-apis/businessmanager/support#faq_439412163553622) [source 2](https://developers.facebook.com/docs/business-management-apis/business-asset-management/guides/catalog) [source 3](https://github.com/facebook/facebook-business-sdk-codegen/blob/main/api_specs/specs/Business.json) [source 4](https://developers.facebook.com/docs/permissions) |
| business_list_client_catalogs | META_BUSINESS / BUSINESS | GET /{asset_id}/client_product_catalogs | business_management, ads_management, pages_read_engagement, pages_show_list | user / no enumerated task contract | data.id, data.name | [source 1](https://developers.facebook.com/docs/business-management-apis/businessmanager/support#faq_439412163553622) [source 2](https://developers.facebook.com/docs/business-management-apis/business-asset-management/guides/catalog) [source 3](https://github.com/facebook/facebook-business-sdk-codegen/blob/main/api_specs/specs/Business.json) [source 4](https://developers.facebook.com/docs/permissions) |
| business_list_owned_wabas | META_BUSINESS / BUSINESS | GET /{asset_id}/owned_whatsapp_business_accounts | business_management, ads_management, pages_read_engagement, pages_show_list | user / no enumerated task contract | data.id, data.name | [source 1](https://developers.facebook.com/docs/business-management-apis/businessmanager/support#faq_439412163553622) [source 2](https://www.postman.com/meta/whatsapp-business-platform/request/yr9gqou/owned-and-client-wabas) [source 3](https://github.com/facebook/facebook-business-sdk-codegen/blob/main/api_specs/specs/Business.json) [source 4](https://developers.facebook.com/docs/permissions) |
| business_list_users | META_BUSINESS / BUSINESS | GET /{asset_id}/business_users | business_management, pages_read_engagement, pages_show_list | user / no enumerated task contract | data.id, data.name, data.role | [source 1](https://developers.facebook.com/docs/business-management-apis/business-manager/get-started) [source 2](https://developers.facebook.com/docs/permissions) |
| business_list_system_users | META_BUSINESS / BUSINESS | GET /{asset_id}/system_users | business_management, pages_read_engagement, pages_show_list | user / no enumerated task contract | data.id, data.name | [source 1](https://developers.facebook.com/docs/business-management-apis/business-manager/get-started) [source 2](https://developers.facebook.com/docs/permissions) |
| pages_get | META_FACEBOOK_PAGES / PAGE | GET /{asset_id} | pages_show_list, pages_read_engagement | page / no enumerated task contract | id, name, fan_count | [source 1](https://developers.facebook.com/documentation/pages-api) [source 2](https://developers.facebook.com/docs/permissions) |
| pages_list_posts | META_FACEBOOK_PAGES / PAGE | GET /{asset_id}/posts | pages_read_engagement, pages_read_user_content, pages_show_list | page / CREATE_CONTENT | data.id, data.created_time, data.is_published | [source 1](https://developers.facebook.com/docs/graph-api/reference/page/feed/) [source 2](https://developers.facebook.com/docs/graph-api/reference/page) [source 3](https://developers.facebook.com/documentation/development/permissions) [source 4](https://developers.facebook.com/docs/permissions) |
| pages_list_published_posts | META_FACEBOOK_PAGES / PAGE | GET /{asset_id}/published_posts | pages_read_engagement, pages_read_user_content, pages_show_list | page / CREATE_CONTENT | data.id, data.created_time, data.is_published | [source 1](https://developers.facebook.com/docs/graph-api/reference/page/published_posts/) [source 2](https://developers.facebook.com/docs/graph-api/reference/page) [source 3](https://developers.facebook.com/documentation/development/permissions) [source 4](https://developers.facebook.com/docs/permissions) |
| pages_list_scheduled_posts | META_FACEBOOK_PAGES / PAGE | GET /{asset_id}/scheduled_posts | pages_read_engagement, pages_read_user_content, pages_show_list | page / CREATE_CONTENT | data.id, data.created_time, data.is_published | [source 1](https://developers.facebook.com/docs/graph-api/reference/page/scheduled_posts/) [source 2](https://developers.facebook.com/docs/graph-api/reference/page) [source 3](https://developers.facebook.com/documentation/development/permissions) [source 4](https://developers.facebook.com/docs/permissions) |
| pages_list_feed | META_FACEBOOK_PAGES / PAGE | GET /{asset_id}/feed | pages_read_engagement, pages_read_user_content, pages_show_list | page / CREATE_CONTENT | data.id, data.created_time, data.is_published | [source 1](https://developers.facebook.com/docs/graph-api/reference/v26.0/page/feed) [source 2](https://developers.facebook.com/docs/permissions) |
| pages_get_insights | META_FACEBOOK_PAGES / PAGE | GET /{asset_id}/insights | read_insights, pages_read_engagement, pages_show_list | page / ANALYZE | data.id, data.name, data.period, data.values.value, data.values.end_time | [source 1](https://developers.facebook.com/docs/graph-api/reference/page/insights/) [source 2](https://developers.facebook.com/docs/platforminsights/page/deprecated-metrics) [source 3](https://developers.facebook.com/docs/graph-api/reference/insights-result/) [source 4](https://developers.facebook.com/docs/graph-api/reference/insights-value/) [source 5](https://developers.facebook.com/docs/permissions) |
| pages_get_subscriptions | META_FACEBOOK_PAGES / PAGE | GET /{asset_id}/subscribed_apps | pages_manage_metadata, pages_show_list | page / CREATE_CONTENT | data.id, data.name | [source 1](https://developers.facebook.com/docs/graph-api/reference/page/subscribed_apps/) [source 2](https://developers.facebook.com/docs/graph-api/reference/page) [source 3](https://developers.facebook.com/documentation/development/permissions) [source 4](https://developers.facebook.com/docs/permissions) |
| pages_create_feed | META_FACEBOOK_PAGES / PAGE | POST /{asset_id}/feed | pages_manage_posts, pages_read_engagement, pages_show_list | page / CREATE_CONTENT | id | [source 1](https://developers.facebook.com/docs/graph-api/reference/v26.0/page/feed) [source 2](https://developers.facebook.com/docs/permissions) |
| pages_create_photos | META_FACEBOOK_PAGES / PAGE | POST /{asset_id}/photos | pages_manage_posts, pages_read_engagement, pages_show_list | page / CREATE_CONTENT, MANAGE, MODERATE | id, post_id | [source 1](https://developers.facebook.com/documentation/pages-api/posts) [source 2](https://developers.facebook.com/docs/permissions) |
| pages_edit_post | META_FACEBOOK_PAGES / POST | POST /{asset_id} | pages_manage_posts, pages_read_engagement, pages_show_list | page / CREATE_CONTENT, MANAGE, MODERATE | success | [source 1](https://developers.facebook.com/documentation/pages-api/posts) [source 2](https://developers.facebook.com/docs/graph-api/reference/page-post) [source 3](https://developers.facebook.com/docs/permissions) |
| pages_hide_comment | META_FACEBOOK_PAGES / COMMENT | POST /{asset_id} | pages_manage_engagement, pages_read_engagement, pages_read_user_content, pages_show_list | page / MODERATE, CREATE_CONTENT | success | [source 1](https://developers.facebook.com/documentation/pages-api) [source 2](https://developers.facebook.com/documentation/pages-api/comments-mentions) [source 3](https://developers.facebook.com/docs/graph-api/reference/comment/) [source 4](https://developers.facebook.com/docs/permissions) |
| pages_delete_comment | META_FACEBOOK_PAGES / COMMENT | DELETE /{asset_id} | pages_manage_engagement, pages_read_engagement, pages_read_user_content, pages_show_list | page / MODERATE, CREATE_CONTENT | success | [source 1](https://developers.facebook.com/documentation/pages-api) [source 2](https://developers.facebook.com/documentation/pages-api/comments-mentions) [source 3](https://developers.facebook.com/docs/graph-api/reference/comment/) [source 4](https://developers.facebook.com/docs/permissions) |
| instagram_get_profile | META_INSTAGRAM_FACEBOOK_LOGIN / INSTAGRAM_ACCOUNT | GET /{asset_id} | instagram_basic, pages_read_engagement, ads_management, business_management, pages_read_user_content, pages_show_list | user / no enumerated task contract | id, username, name, followers_count, media_count | [source 1](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user) [source 2](https://developers.facebook.com/documentation/development/permissions) [source 3](https://developers.facebook.com/docs/permissions) |
| instagram_list_media | META_INSTAGRAM_FACEBOOK_LOGIN / INSTAGRAM_ACCOUNT | GET /{asset_id}/media | instagram_basic, pages_read_engagement, ads_management, business_management, pages_read_user_content, pages_show_list | user / no enumerated task contract | data.id | [source 1](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user) [source 2](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media) [source 3](https://developers.facebook.com/docs/permissions) |
| instagram_create_container | META_INSTAGRAM_FACEBOOK_LOGIN / INSTAGRAM_ACCOUNT | POST /{asset_id}/media | instagram_basic, instagram_content_publish, pages_read_engagement, ads_management, ads_read, pages_read_user_content, pages_show_list | user / CREATE_CONTENT | id | [source 1](https://developers.facebook.com/documentation/instagram-platform/content-publishing) [source 2](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media) [source 3](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish) [source 4](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container) [source 5](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit) [source 6](https://developers.facebook.com/docs/permissions) |
| instagram_publish_container | META_INSTAGRAM_FACEBOOK_LOGIN / INSTAGRAM_ACCOUNT | POST /{asset_id}/media_publish | instagram_basic, instagram_content_publish, pages_read_engagement, ads_management, ads_read, pages_read_user_content, pages_show_list | user / CREATE_CONTENT | id, config_issue, caption_add_on_attachment_status | [source 1](https://developers.facebook.com/documentation/instagram-platform/content-publishing) [source 2](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media) [source 3](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish) [source 4](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container) [source 5](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit) [source 6](https://developers.facebook.com/docs/permissions) |
| instagram_get_container_status | META_INSTAGRAM_FACEBOOK_LOGIN / MEDIA | GET /{asset_id} | instagram_basic, instagram_content_publish, pages_read_engagement, ads_management, ads_read, pages_read_user_content, pages_show_list | user / CREATE_CONTENT | id, status_code | [source 1](https://developers.facebook.com/documentation/instagram-platform/content-publishing) [source 2](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media) [source 3](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish) [source 4](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container) [source 5](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit) [source 6](https://developers.facebook.com/docs/permissions) |
| instagram_business_discovery | META_INSTAGRAM_FACEBOOK_LOGIN / INSTAGRAM_ACCOUNT | GET /{asset_id} | instagram_basic, instagram_manage_insights, pages_read_engagement, ads_management, ads_read, pages_read_user_content, pages_show_list | user / no enumerated task contract | id, business_discovery.id, business_discovery.followers_count, business_discovery.media_count | [source 1](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery) [source 2](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user) [source 3](https://developers.facebook.com/docs/permissions) |
| instagram_hashtag_search | META_INSTAGRAM_FACEBOOK_LOGIN / INSTAGRAM_ACCOUNT | GET /ig_hashtag_search | instagram_basic, pages_read_engagement, ads_management, ads_read, business_management, pages_read_user_content, pages_show_list | user / no enumerated task contract | data.id | [source 1](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-hashtag-search) [source 2](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/recently_searched_hashtags) [source 3](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-hashtag) [source 4](https://developers.facebook.com/docs/graph-api/using-graph-api/) [source 5](https://developers.facebook.com/docs/permissions) |
| instagram_get_mentions | META_INSTAGRAM_FACEBOOK_LOGIN / INSTAGRAM_ACCOUNT | GET /{asset_id} | instagram_basic, instagram_manage_comments, pages_read_engagement, ads_management, ads_read, pages_read_user_content, pages_show_list | user / CREATE_CONTENT | id, mentioned_comment.id, mentioned_comment.timestamp | [source 1](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/mentioned_comment) [source 2](https://developers.facebook.com/docs/permissions) |
| instagram_get_mentioned_media | META_INSTAGRAM_FACEBOOK_LOGIN / INSTAGRAM_ACCOUNT | GET /{asset_id} | instagram_basic, instagram_manage_comments, pages_read_engagement, ads_management, ads_read, pages_read_user_content, pages_show_list | user / CREATE_CONTENT | id, mentioned_media.id, mentioned_media.media_type, mentioned_media.timestamp | [source 1](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/mentioned_media) [source 2](https://developers.facebook.com/docs/permissions) |
| instagram_login_profile | META_INSTAGRAM_LOGIN / INSTAGRAM_ACCOUNT | GET /{asset_id} | instagram_business_basic | instagram / no enumerated task contract | id, username, name, followers_count, media_count | [source 1](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user) [source 2](https://developers.facebook.com/documentation/development/permissions) [source 3](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started) [source 4](https://developers.facebook.com/docs/permissions) |
| instagram_login_list_media | META_INSTAGRAM_LOGIN / INSTAGRAM_ACCOUNT | GET /{asset_id}/media | instagram_business_basic | instagram / no enumerated task contract | data.id, paging.cursors.before, paging.cursors.after | [source 1](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user) [source 2](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media) [source 3](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started) [source 4](https://developers.facebook.com/docs/permissions) |
| instagram_login_create_container | META_INSTAGRAM_LOGIN / INSTAGRAM_ACCOUNT | POST /{asset_id}/media | instagram_business_basic, instagram_business_content_publish | instagram / no enumerated task contract | id | [source 1](https://developers.facebook.com/documentation/instagram-platform/content-publishing) [source 2](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media) [source 3](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish) [source 4](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container) [source 5](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit) [source 6](https://developers.facebook.com/docs/permissions) |
| instagram_login_publish | META_INSTAGRAM_LOGIN / INSTAGRAM_ACCOUNT | POST /{asset_id}/media_publish | instagram_business_basic, instagram_business_content_publish | instagram / no enumerated task contract | id, config_issue, caption_add_on_attachment_status | [source 1](https://developers.facebook.com/documentation/instagram-platform/content-publishing) [source 2](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media) [source 3](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish) [source 4](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container) [source 5](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit) [source 6](https://developers.facebook.com/docs/permissions) |
| instagram_login_get_container_status | META_INSTAGRAM_LOGIN / MEDIA | GET /{asset_id} | instagram_business_basic, instagram_business_content_publish | instagram / no enumerated task contract | id, status_code | [source 1](https://developers.facebook.com/documentation/instagram-platform/content-publishing) [source 2](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media) [source 3](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish) [source 4](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container) [source 5](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit) [source 6](https://developers.facebook.com/docs/permissions) |
| instagram_login_conversations | META_INSTAGRAM_LOGIN / INSTAGRAM_ACCOUNT | GET /{asset_id}/conversations | instagram_business_basic, instagram_business_manage_messages | instagram / no enumerated task contract | data.id, data.updated_time | [source 1](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api) [source 2](https://developers.facebook.com/docs/permissions) |
| instagram_login_get_messages | META_INSTAGRAM_LOGIN / CONVERSATION | GET /{asset_id} | instagram_business_basic, instagram_business_manage_messages | instagram / no enumerated task contract | id, messages.data.id, messages.data.created_time | [source 1](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api) [source 2](https://developers.facebook.com/docs/permissions) |
| instagram_list_conversations | META_INSTAGRAM_FACEBOOK_LOGIN / PAGE | GET /{asset_id}/conversations | instagram_basic, instagram_manage_messages, pages_manage_metadata, pages_read_user_content, pages_show_list, pages_read_engagement | page / MESSAGING | data.id, data.updated_time | [source 1](https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversations) [source 2](https://developers.facebook.com/docs/permissions) |
| messenger_list_conversations | META_MESSENGER / PAGE | GET /{asset_id}/conversations | pages_manage_metadata, pages_read_engagement, pages_messaging, pages_show_list | page / MESSAGING | data.id, data.updated_time | [source 1](https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversations) [source 2](https://developers.facebook.com/docs/permissions) |
| messenger_get_messages | META_MESSENGER / CONVERSATION | GET /{asset_id} | pages_manage_metadata, pages_read_engagement, pages_messaging, pages_show_list | page / MESSAGING | id, messages.data.id, messages.data.created_time | [source 1](https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversations) [source 2](https://developers.facebook.com/docs/permissions) |
| messenger_send_text | META_MESSENGER / PAGE | POST /{asset_id}/messages | pages_messaging, pages_manage_metadata, pages_show_list | page / MESSAGE | recipient_id, message_id | [source 1](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages) [source 2](https://www.postman.com/meta/messenger-platform-api/folder/vilwbh4/send-api) [source 3](https://developers.facebook.com/docs/permissions) |
| threads_get_profile | META_THREADS / THREADS_ACCOUNT | GET /{asset_id} | threads_basic | threads / no enumerated task contract | id, username, name, is_verified | [source 1](https://developers.facebook.com/documentation/threads/threads-profiles) [source 2](https://developers.facebook.com/docs/permissions) |
| threads_list_threads | META_THREADS / THREADS_ACCOUNT | GET /{asset_id}/threads | threads_basic | threads / no enumerated task contract | data.id, data.media_type, data.timestamp, paging.cursors.before, paging.cursors.after | [source 1](https://developers.facebook.com/documentation/threads/retrieve-and-discover-posts/retrieve-posts) [source 2](https://developers.facebook.com/docs/permissions) |
| threads_get_post | META_THREADS / POST | GET /{asset_id} | threads_basic | threads / no enumerated task contract | id, media_type, timestamp | [source 1](https://developers.facebook.com/documentation/threads/retrieve-and-discover-posts/retrieve-posts) [source 2](https://developers.facebook.com/docs/permissions) |
| threads_list_replies | META_THREADS / POST | GET /{asset_id}/replies | threads_basic, threads_read_replies | threads / no enumerated task contract | data.id, data.timestamp, data.media_type, data.is_reply, data.is_reply_owned_by_me, data.hide_status, data.root_post.id, data.replied_to.id | [source 1](https://developers.facebook.com/documentation/threads/retrieve-and-manage-replies) [source 2](https://developers.facebook.com/documentation/threads/retrieve-and-manage-replies/replies-and-conversations) [source 3](https://developers.facebook.com/docs/permissions) |
| threads_list_insights | META_THREADS / THREADS_ACCOUNT | GET /{asset_id}/threads_insights | threads_basic, threads_manage_insights | threads / no enumerated task contract | data.id, data.name, data.period, data.values.value, data.values.end_time | [source 1](https://developers.facebook.com/documentation/threads/insights) [source 2](https://developers.facebook.com/docs/permissions) |
| threads_get_post_insights | META_THREADS / POST | GET /{asset_id}/insights | threads_basic, threads_manage_insights | threads / no enumerated task contract | data.id, data.name, data.period, data.values.value, data.values.end_time | [source 1](https://developers.facebook.com/documentation/threads/insights) [source 2](https://developers.facebook.com/docs/permissions) |
| threads_list_threads_publishing_limit | META_THREADS / THREADS_ACCOUNT | GET /{asset_id}/threads_publishing_limit | threads_basic, threads_content_publish, threads_manage_replies | threads / no enumerated task contract | data.reply_quota_usage, data.reply_config.quota_total, data.reply_config.quota_duration | [source 1](https://developers.facebook.com/documentation/threads/retrieve-and-manage-replies) [source 2](https://developers.facebook.com/docs/permissions) |
| threads_create_container | META_THREADS / THREADS_ACCOUNT | POST /{asset_id}/threads | threads_basic, threads_content_publish | threads / no enumerated task contract | id | [source 1](https://developers.facebook.com/documentation/threads/posts) [source 2](https://developers.facebook.com/docs/permissions) |
| threads_publish_container | META_THREADS / THREADS_ACCOUNT | POST /{asset_id}/threads_publish | threads_basic, threads_content_publish | threads / no enumerated task contract | id | [source 1](https://developers.facebook.com/documentation/threads/posts) [source 2](https://developers.facebook.com/docs/permissions) |
| threads_manage_reply | META_THREADS / POST | POST /{asset_id}/manage_reply | threads_basic, threads_manage_replies | threads / no enumerated task contract | success | [source 1](https://developers.facebook.com/documentation/threads/retrieve-and-manage-replies) [source 2](https://developers.facebook.com/documentation/threads/reply-management) [source 3](https://developers.facebook.com/docs/permissions) |
| threads_delete_post | META_THREADS / POST | DELETE /{asset_id} | threads_basic, threads_delete | threads / no enumerated task contract | success, deleted_id | [source 1](https://developers.facebook.com/documentation/threads/posts/delete-posts) [source 2](https://developers.facebook.com/docs/permissions) |
| threads_get_conversation | META_THREADS / POST | GET /{asset_id}/conversation | threads_basic, threads_read_replies | threads / no enumerated task contract | data.id, data.timestamp, data.media_type, data.is_reply, data.is_reply_owned_by_me, data.hide_status, data.root_post.id, data.replied_to.id | [source 1](https://developers.facebook.com/documentation/threads/retrieve-and-manage-replies) [source 2](https://developers.facebook.com/documentation/threads/retrieve-and-manage-replies/replies-and-conversations) [source 3](https://developers.facebook.com/docs/permissions) |
| threads_list_pending_replies | META_THREADS / POST | GET /{asset_id}/pending_replies | threads_basic, threads_read_replies | threads / no enumerated task contract | data.id, data.is_reply, data.hide_status, data.root_post.id, data.replied_to.id, data.reply_approval_status | [source 1](https://developers.facebook.com/documentation/threads/retrieve-and-manage-replies) [source 2](https://developers.facebook.com/documentation/threads/reply-management) [source 3](https://developers.facebook.com/docs/permissions) |
| threads_get_post_status | META_THREADS / MEDIA | GET /{asset_id} | threads_basic, threads_content_publish | threads / no enumerated task contract | id, status | [source 1](https://developers.facebook.com/documentation/threads/reference/publishing) [source 2](https://developers.facebook.com/documentation/threads/posts) [source 3](https://developers.facebook.com/documentation/threads/troubleshooting) [source 4](https://developers.facebook.com/docs/permissions) |
| threads_manage_pending_reply | META_THREADS / POST | POST /{asset_id}/manage_pending_reply | threads_basic, threads_manage_replies | threads / no enumerated task contract | success | [source 1](https://developers.facebook.com/documentation/threads/retrieve-and-manage-replies) [source 2](https://developers.facebook.com/documentation/threads/reply-management) [source 3](https://developers.facebook.com/docs/permissions) |
| leads_list_forms | META_MARKETING / PAGE | GET /{asset_id}/leadgen_forms | ads_management, leads_retrieval, pages_show_list, pages_read_engagement, pages_manage_ads, ads_read, business_management | page, user / no enumerated task contract | data.id, data.name, data.status, data.created_time, data.page_id | [source 1](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving) [source 2](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/leadgenform.py) [source 3](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py) [source 4](https://developers.facebook.com/docs/permissions) |
| leads_get_form | META_MARKETING / LEAD_FORM | GET /{asset_id} | ads_management, leads_retrieval, pages_show_list, pages_read_engagement, pages_manage_ads, ads_read, business_management | page, user / no enumerated task contract | id, name, status, created_time, page_id | [source 1](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving) [source 2](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/leadgenform.py) [source 3](https://developers.facebook.com/docs/permissions) |
| leads_retrieve | META_MARKETING / LEAD_FORM | GET /{asset_id}/leads | ads_management, leads_retrieval, pages_show_list, pages_read_engagement, pages_manage_ads, ads_read, business_management | page, user / no enumerated task contract | data.id, data.created_time, data.ad_id, data.form_id, data.field_data.name, data.field_data.values, paging.cursors.before, paging.cursors.after | [source 1](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving) [source 2](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/leadgenform.py) [source 3](https://developers.facebook.com/docs/permissions) |
| leads_get_lead | META_MARKETING / LEAD | GET /{asset_id} | ads_management, leads_retrieval, pages_show_list, pages_read_engagement, pages_manage_ads, ads_read, business_management | page, user / no enumerated task contract | id, created_time | [source 1](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving) [source 2](https://developers.facebook.com/docs/permissions) |
| signals_send_pixel_events | META_MARKETING / PIXEL | POST /{asset_id}/events | ads_management, pages_read_engagement, ads_read, pages_show_list | system_user / no enumerated task contract | events_received | [source 1](https://developers.facebook.com/documentation/ads-commerce/conversions-api/set-up-conversions-api-as-a-platform) [source 2](https://developers.facebook.com/documentation/ads-commerce/conversions-api/using-the-api) [source 3](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ads-pixel/events) [source 4](https://developers.facebook.com/docs/permissions) |
| catalog_list_products | META_BUSINESS / CATALOG | GET /{asset_id}/products | catalog_management, business_management, pages_read_engagement, pages_show_list | user / MANAGE | data.id, data.name, data.category | [source 1](https://developers.facebook.com/documentation/ads-commerce/catalog/get-started) [source 2](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/product-catalog/products) [source 3](https://developers.facebook.com/docs/permissions) |
| catalog_list_product_sets | META_BUSINESS / CATALOG | GET /{asset_id}/product_sets | catalog_management, business_management, pages_read_engagement, pages_show_list | user / MANAGE | data.id, data.name, data.product_count | [source 1](https://developers.facebook.com/documentation/ads-commerce/catalog/get-started) [source 2](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/product-catalog/product_sets) [source 3](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/product-set) [source 4](https://developers.facebook.com/docs/permissions) |
| catalog_list_product_feeds | META_BUSINESS / CATALOG | GET /{asset_id}/product_feeds | catalog_management, business_management, pages_read_engagement, pages_show_list | user / MANAGE | data.id, data.name, data.product_count, data.country, data.default_currency | [source 1](https://developers.facebook.com/documentation/ads-commerce/catalog/get-started) [source 2](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/product-catalog/product_feeds) [source 3](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/product-feed) [source 4](https://developers.facebook.com/docs/permissions) |
| catalog_list_assigned_users | META_BUSINESS / CATALOG | GET /{asset_id}/assigned_users | ads_management, catalog_management, pages_read_engagement, pages_show_list, business_management | user, system_user / no enumerated task contract | data.role | [source 1](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/product-catalog/assigned_users) [source 2](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/productcatalog.py) [source 3](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/apiconfig.py) [source 4](https://developers.facebook.com/docs/permissions) |
| oembed_facebook | META_FACEBOOK_PAGES / APP | GET /oembed_post |  |  / no enumerated task contract | html | [source 1](https://developers.facebook.com/blog/post/2026/06/15/tokenless-access-to-meta-oembed-apis) [source 2](https://developers.facebook.com/docs/graph-api/reference/oembed-post/) [source 3](https://developers.facebook.com/docs/permissions) |
| oembed_instagram | META_INSTAGRAM_FACEBOOK_LOGIN / APP | GET /instagram_oembed |  |  / no enumerated task contract | html | [source 1](https://developers.facebook.com/blog/post/2026/06/15/tokenless-access-to-meta-oembed-apis) [source 2](https://developers.facebook.com/documentation/instagram-platform/oembed) [source 3](https://developers.facebook.com/docs/permissions) |
| whatsapp_platform_send_message | META_WHATSAPP / WHATSAPP_PHONE | POST /{asset_id}/messages | whatsapp_business_messaging, whatsapp_business_management | system_user, business_integration_system_user / no enumerated task contract | messages.id, messaging_product | [source 1](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions) [source 3](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens) [source 4](https://developers.facebook.com/docs/permissions) |
| whatsapp_platform_list_phones | META_WHATSAPP / MESSAGING_ACCOUNT | GET /{asset_id}/phone_numbers | whatsapp_business_management | business_integration_system_user / no enumerated task contract | data.id, data.verified_name, data.quality_rating, data.code_verification_status | [source 1](https://developers.facebook.com/docs/permissions) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-profiles) [source 3](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/whatsapp-business-profile-api) [source 4](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers) |
| whatsapp_platform_get_phone | META_WHATSAPP / WHATSAPP_PHONE | GET /{asset_id} | whatsapp_business_management | business_integration_system_user / no enumerated task contract | id, verified_name, quality_rating, code_verification_status | [source 1](https://developers.facebook.com/docs/permissions) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-profiles) [source 3](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/whatsapp-business-profile-api) [source 4](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers) |
| whatsapp_platform_get_profile | META_WHATSAPP / WHATSAPP_PHONE | GET /{asset_id}/whatsapp_business_profile | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user / no enumerated task contract | data.about, data.address, data.description, data.email, data.websites, data.vertical, data.messaging_product | [source 1](https://developers.facebook.com/docs/permissions) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-profiles) [source 3](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/whatsapp-business-profile-api) [source 4](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers) |
| whatsapp_platform_update_profile | META_WHATSAPP / WHATSAPP_PHONE | POST /{asset_id}/whatsapp_business_profile | whatsapp_business_management, whatsapp_business_messaging | business_integration_system_user / no enumerated task contract | success | [source 1](https://developers.facebook.com/docs/permissions) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-profiles) [source 3](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/whatsapp-business-profile-api) [source 4](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers) |
| instagram_list_comments | META_INSTAGRAM_FACEBOOK_LOGIN / MEDIA | GET /{asset_id}/comments | instagram_basic, instagram_manage_comments, pages_read_engagement, ads_management, ads_read, pages_read_user_content, pages_show_list | user / no enumerated task contract | data.id, data.timestamp, data.text | [source 1](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment) [source 2](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies) [source 3](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media) [source 4](https://developers.facebook.com/documentation/instagram-platform/comment-moderation) [source 5](https://developers.facebook.com/docs/permissions) |
| instagram_reply_comment | META_INSTAGRAM_FACEBOOK_LOGIN / COMMENT | POST /{asset_id}/replies | instagram_basic, instagram_manage_comments, pages_read_engagement, ads_management, ads_read, pages_read_user_content, pages_show_list | user / no enumerated task contract | id | [source 1](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment) [source 2](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies) [source 3](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media) [source 4](https://developers.facebook.com/documentation/instagram-platform/comment-moderation) [source 5](https://developers.facebook.com/docs/permissions) |
| instagram_hide_comment | META_INSTAGRAM_FACEBOOK_LOGIN / COMMENT | POST /{asset_id} | instagram_basic, instagram_manage_comments, pages_read_engagement, ads_management, ads_read, pages_read_user_content, pages_show_list | user / no enumerated task contract | success | [source 1](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment) [source 2](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies) [source 3](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media) [source 4](https://developers.facebook.com/documentation/instagram-platform/comment-moderation) [source 5](https://developers.facebook.com/docs/permissions) |
| instagram_delete_comment | META_INSTAGRAM_FACEBOOK_LOGIN / COMMENT | DELETE /{asset_id} | instagram_basic, instagram_manage_comments, pages_read_engagement, ads_management, ads_read, pages_read_user_content, pages_show_list | user / no enumerated task contract | success | [source 1](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment) [source 2](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies) [source 3](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media) [source 4](https://developers.facebook.com/documentation/instagram-platform/comment-moderation) [source 5](https://developers.facebook.com/docs/permissions) |
| instagram_login_list_comments | META_INSTAGRAM_LOGIN / MEDIA | GET /{asset_id}/comments | instagram_business_basic, instagram_business_manage_comments | instagram / no enumerated task contract | data.id, data.timestamp, data.text | [source 1](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment) [source 2](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies) [source 3](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media) [source 4](https://developers.facebook.com/documentation/instagram-platform/comment-moderation) [source 5](https://developers.facebook.com/docs/permissions) |
| instagram_login_reply_comment | META_INSTAGRAM_LOGIN / COMMENT | POST /{asset_id}/replies | instagram_business_basic, instagram_business_manage_comments | instagram / no enumerated task contract | id | [source 1](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment) [source 2](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies) [source 3](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media) [source 4](https://developers.facebook.com/documentation/instagram-platform/comment-moderation) [source 5](https://developers.facebook.com/docs/permissions) |
| instagram_login_hide_comment | META_INSTAGRAM_LOGIN / COMMENT | POST /{asset_id} | instagram_business_basic, instagram_business_manage_comments | instagram / no enumerated task contract | success | [source 1](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment) [source 2](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies) [source 3](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media) [source 4](https://developers.facebook.com/documentation/instagram-platform/comment-moderation) [source 5](https://developers.facebook.com/docs/permissions) |
| instagram_login_delete_comment | META_INSTAGRAM_LOGIN / COMMENT | DELETE /{asset_id} | instagram_business_basic, instagram_business_manage_comments | instagram / no enumerated task contract | success | [source 1](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment) [source 2](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies) [source 3](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media) [source 4](https://developers.facebook.com/documentation/instagram-platform/comment-moderation) [source 5](https://developers.facebook.com/docs/permissions) |
| instagram_get_insights | META_INSTAGRAM_FACEBOOK_LOGIN / INSTAGRAM_ACCOUNT | GET /{asset_id}/insights | instagram_basic, instagram_manage_insights, pages_read_engagement, ads_management, ads_read, pages_read_user_content, pages_show_list | user / no enumerated task contract | data.id, data.name, data.period, data.total_value.value | [source 1](https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights) [source 2](https://developers.facebook.com/docs/permissions) |
| instagram_login_get_insights | META_INSTAGRAM_LOGIN / INSTAGRAM_ACCOUNT | GET /{asset_id}/insights | instagram_business_basic, instagram_business_manage_insights | instagram / no enumerated task contract | data.id, data.name, data.period, data.total_value.value | [source 1](https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights) [source 2](https://developers.facebook.com/docs/permissions) |
| instagram_get_media_insights | META_INSTAGRAM_FACEBOOK_LOGIN / MEDIA | GET /{asset_id}/insights | instagram_basic, instagram_manage_insights, pages_read_engagement, ads_management, ads_read, pages_read_user_content, pages_show_list | user / no enumerated task contract | data.id, data.name, data.period, data.values.value | [source 1](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights) [source 2](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media) [source 3](https://developers.facebook.com/docs/permissions) |
| instagram_login_get_media_insights | META_INSTAGRAM_LOGIN / MEDIA | GET /{asset_id}/insights | instagram_business_basic, instagram_business_manage_insights | instagram / no enumerated task contract | data.id, data.name, data.period, data.values.value | [source 1](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights) [source 2](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media) [source 3](https://developers.facebook.com/docs/permissions) |
| threads_keyword_search | META_THREADS / THREADS_ACCOUNT | GET /keyword_search | threads_basic, threads_keyword_search | threads / no enumerated task contract | data.id, data.media_type, data.timestamp | [source 1](https://developers.facebook.com/documentation/threads/keyword-search) [source 2](https://developers.facebook.com/docs/permissions) |
| threads_get_mentions | META_THREADS / THREADS_ACCOUNT | GET /{asset_id}/mentions | threads_basic, threads_manage_mentions | threads / no enumerated task contract | data.id, data.media_type, data.timestamp | [source 1](https://developers.facebook.com/documentation/threads/threads-mentions) [source 2](https://developers.facebook.com/docs/permissions) |
| whatsapp_platform_get_analytics | META_WHATSAPP / MESSAGING_ACCOUNT | GET /{asset_id} | whatsapp_business_management | business_integration_system_user / no enumerated task contract | data.start, data.end, data.sent, data.delivered, data.read, data.volume, data.cost, data.conversation, data.template_id, data.phone_id, data.country, data.pricing_category, data.pricing_type, data.conversation_category, data.conversation_direction, data.conversation_type, data.tier, data.clicked.type, data.clicked.count, data.cost_breakdown.type, data.cost_breakdown.value | [source 1](https://developers.facebook.com/docs/permissions) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/analytics) [source 3](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/whatsappbusinessaccount.py) |
| whatsapp_platform_get_template_analytics | META_WHATSAPP / MESSAGING_ACCOUNT | GET /{asset_id}/template_analytics | whatsapp_business_management | business_integration_system_user / no enumerated task contract | data.start, data.end, data.sent, data.delivered, data.read, data.volume, data.cost, data.conversation, data.template_id, data.phone_id, data.country, data.pricing_category, data.pricing_type, data.conversation_category, data.conversation_direction, data.conversation_type, data.tier, data.clicked.type, data.clicked.count, data.cost_breakdown.type, data.cost_breakdown.value | [source 1](https://developers.facebook.com/docs/permissions) [source 2](https://developers.facebook.com/documentation/business-messaging/whatsapp/analytics) [source 3](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/whatsappbusinessaccount.py) |

## Product-specific limits

- Pages: exact-client Page profile, feed/posts/published/scheduled metadata reads, app subscription metadata, bounded feed creation and comment hide/delete are implemented. Scheduled reads do not enable scheduling writes; the scheduling windows conflict. Post deletion and comment replies retain their precise primary-reference restrictions/conflicts. Task alternatives are not falsely combined into an all-of requirement.
- Instagram: Facebook Login and Instagram Login remain distinct providers, hosts and tokens. Profile/media metadata reads are implemented. JPEG draft/status/separate publication uses actual isolated JPEG decode, signed approved-CDN intake, encrypted one-use human media enrollment, truthful AI declaration, fresh readiness and live quota. Facebook content uses the newer User-token reference with literal CREATE_CONTENT on the exact linked Page only; messaging uses a Page token. Partial/UNKNOWN publication never retries automatically. See [trusted media intake](trusted-media-ingress.md). Authorized message details are bounded, credential-redacted and never persisted; IDs do not create child grants.
- Messenger: conversation metadata, client-authorized bounded message details and RESPONSE-only text are implemented. The initial window is 24 hours from trusted inbound evidence. Outside-window exceptions, Human Agent automation, attachments and templates remain disabled.
- Threads: current primary documentation uses graph.threads.com/v1.0. Own app-scoped profile/posts, explicit text draft and separate one-shot publication, status, own-post deletion, bounded reply moderation and fixed account/post insights are implemented. Pending/top-level reply proofs are derived only from trusted reads of already registered children; no implicit grants. Public discovery remains separate and unresolved. Only documented cursor metadata is retained.
- WhatsApp: WhatsApp accounts hold phone/presence assets; Messaging accounts hold templates/billing. Both client-owned account grants are required. Tech Providers use customer-scoped Business Integration System User tokens; interim grant cascading is not relied upon. Text sending requires separate verified opt-in and an open 24-hour window. Dedicated clients implement scoped Flow lifecycle, text-template management and own-app subscriptions with actual BISU subject/business/granular-account proof and client-owned dual parents. Template/Flow submission or publishing is not sending or policy approval. Utility-template sending is outside the text tool. Billing comes from the exact client parent graph; acceptance is not delivery.
- Signals: verified dispatch targets an explicit client PIXEL. Dataset contracts remain HOLD until mapping/authorization is independently proved. MCP accepts source/consent references only. Trusted actual events are payload-bound to consent, normalized/hashed, branded, re-read at egress and durably deduplicated. UNKNOWN outcomes do not automatically retry. Meta's current Using API documentation says test_event_code events can enter targeting/measurement, so caller test shortcuts and fabricated conversions are disabled.
- Leads: form metadata and selected-ad private retrieval are implemented; leads_get_lead remains metadata only. Private retrieval requires registered AD-to-creative-to-exact-form/Page and account authority, independently verified Leads Access Manager access, bounded typed answers, credential redaction and a 64 KiB aggregate answer-text cap. Other-ad/organic/preview rows are withheld. Optional paired date filters operate locally on the current provider page and results explicitly remain incomplete. No private answers are persisted or sent to a receiving adapter, and no LeadGate coupling or marketing opt-in is inferred. Provider-proven LEAD_FORM and AD discovery requires separate authenticated human enrollment; grants intersect the selected root and existing parent grants.
- oEmbed: [current Instagram guidance](https://developers.facebook.com/documentation/instagram-platform/oembed) restricts use to front-end embedding. Metadata extraction/persistence/analytics are not enabled. Exact token/feature eligibility remains unresolved; both tools remain HOLD and unregistered.

## Runtime privacy and deployment gates

[Current WhatsApp text webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text) identifies entry.id as a Messaging account ID. Envelopes must match the phone's registered account parent. User phone numbers and WhatsApp user IDs may differ. The messaging bridge requires opaque proof minted only after HMAC validation and normalization, bound to the raw payload, events and subscription. Final messaging-policy revalidation blocks cancellation and billing substitution.

Policy storage retains recipient HMACs and metadata only. Withdrawal/nonapproved template status dominates equal-time ties. State/event/audit retention is bounded to 90 days as Lumin policy; TTL configuration requires approved deployment. See [webhook environment setup](webhook-environment.md) for configured secret/app binding, global asset index, durable event TTL and worker query indexes. OAuth app IDs must match META_APP_ID, THREADS_APP_ID or INSTAGRAM_APP_ID before consent.

## Remaining requirement-specific evidence for verified contracts

### whatsapp_platform_list_flows

- Current external-client WhatsApp Tech Provider/Embedded Signup and Advanced Access eligibility for both whatsapp_business_management and whatsapp_business_messaging must be independently verified.
- The client owns its WhatsApp account and Messaging account; fresh separate owner-reviewed dual-account assignment is required. API assignment cascade is not proof.
- Actual same-app BISU token debug evidence must include this exact Messaging account ID under both whatsapp_business_management and whatsapp_business_messaging granular scopes.
- Flows require Message templates(view/manage) and Phone Numbers(view/manage) business permissions. Publish additionally requires verified business, high messaging quality, resolved validation/publishing checks and applicable owner policy review. These are independently recorded eligibility gates, not fabricated scopes.
- Initial JSON supports bounded static screens only, with no data-exchange endpoint, clone, migration or auto-publish. Every mutation has a separate exact human approval and one provider attempt; uncertain outcomes are never retried automatically.

### whatsapp_platform_get_flow

- Current external-client WhatsApp Tech Provider/Embedded Signup and Advanced Access eligibility for both whatsapp_business_management and whatsapp_business_messaging must be independently verified.
- The client owns its WhatsApp account and Messaging account; fresh separate owner-reviewed dual-account assignment is required. API assignment cascade is not proof.
- Actual same-app BISU token debug evidence must include this exact Messaging account ID under both whatsapp_business_management and whatsapp_business_messaging granular scopes.
- Flows require Message templates(view/manage) and Phone Numbers(view/manage) business permissions. Publish additionally requires verified business, high messaging quality, resolved validation/publishing checks and applicable owner policy review. These are independently recorded eligibility gates, not fabricated scopes.
- Initial JSON supports bounded static screens only, with no data-exchange endpoint, clone, migration or auto-publish. Every mutation has a separate exact human approval and one provider attempt; uncertain outcomes are never retried automatically.

### whatsapp_platform_create_flow

- Current external-client WhatsApp Tech Provider/Embedded Signup and Advanced Access eligibility for both whatsapp_business_management and whatsapp_business_messaging must be independently verified.
- The client owns its WhatsApp account and Messaging account; fresh separate owner-reviewed dual-account assignment is required. API assignment cascade is not proof.
- Actual same-app BISU token debug evidence must include this exact Messaging account ID under both whatsapp_business_management and whatsapp_business_messaging granular scopes.
- Flows require Message templates(view/manage) and Phone Numbers(view/manage) business permissions. Publish additionally requires verified business, high messaging quality, resolved validation/publishing checks and applicable owner policy review. These are independently recorded eligibility gates, not fabricated scopes.
- Initial JSON supports bounded static screens only, with no data-exchange endpoint, clone, migration or auto-publish. Every mutation has a separate exact human approval and one provider attempt; uncertain outcomes are never retried automatically.

### whatsapp_platform_update_flow

- Current external-client WhatsApp Tech Provider/Embedded Signup and Advanced Access eligibility for both whatsapp_business_management and whatsapp_business_messaging must be independently verified.
- The client owns its WhatsApp account and Messaging account; fresh separate owner-reviewed dual-account assignment is required. API assignment cascade is not proof.
- Actual same-app BISU token debug evidence must include this exact Messaging account ID under both whatsapp_business_management and whatsapp_business_messaging granular scopes.
- Flows require Message templates(view/manage) and Phone Numbers(view/manage) business permissions. Publish additionally requires verified business, high messaging quality, resolved validation/publishing checks and applicable owner policy review. These are independently recorded eligibility gates, not fabricated scopes.
- Initial JSON supports bounded static screens only, with no data-exchange endpoint, clone, migration or auto-publish. Every mutation has a separate exact human approval and one provider attempt; uncertain outcomes are never retried automatically.

### whatsapp_platform_upload_flow_json

- Current external-client WhatsApp Tech Provider/Embedded Signup and Advanced Access eligibility for both whatsapp_business_management and whatsapp_business_messaging must be independently verified.
- The client owns its WhatsApp account and Messaging account; fresh separate owner-reviewed dual-account assignment is required. API assignment cascade is not proof.
- Actual same-app BISU token debug evidence must include this exact Messaging account ID under both whatsapp_business_management and whatsapp_business_messaging granular scopes.
- Flows require Message templates(view/manage) and Phone Numbers(view/manage) business permissions. Publish additionally requires verified business, high messaging quality, resolved validation/publishing checks and applicable owner policy review. These are independently recorded eligibility gates, not fabricated scopes.
- Initial JSON supports bounded static screens only, with no data-exchange endpoint, clone, migration or auto-publish. Every mutation has a separate exact human approval and one provider attempt; uncertain outcomes are never retried automatically.

### whatsapp_platform_publish_flow

- Current external-client WhatsApp Tech Provider/Embedded Signup and Advanced Access eligibility for both whatsapp_business_management and whatsapp_business_messaging must be independently verified.
- The client owns its WhatsApp account and Messaging account; fresh separate owner-reviewed dual-account assignment is required. API assignment cascade is not proof.
- Actual same-app BISU token debug evidence must include this exact Messaging account ID under both whatsapp_business_management and whatsapp_business_messaging granular scopes.
- Flows require Message templates(view/manage) and Phone Numbers(view/manage) business permissions. Publish additionally requires verified business, high messaging quality, resolved validation/publishing checks and applicable owner policy review. These are independently recorded eligibility gates, not fabricated scopes.
- Initial JSON supports bounded static screens only, with no data-exchange endpoint, clone, migration or auto-publish. Every mutation has a separate exact human approval and one provider attempt; uncertain outcomes are never retried automatically.

### whatsapp_platform_deprecate_flow

- Current external-client WhatsApp Tech Provider/Embedded Signup and Advanced Access eligibility for both whatsapp_business_management and whatsapp_business_messaging must be independently verified.
- The client owns its WhatsApp account and Messaging account; fresh separate owner-reviewed dual-account assignment is required. API assignment cascade is not proof.
- Actual same-app BISU token debug evidence must include this exact Messaging account ID under both whatsapp_business_management and whatsapp_business_messaging granular scopes.
- Flows require Message templates(view/manage) and Phone Numbers(view/manage) business permissions. Publish additionally requires verified business, high messaging quality, resolved validation/publishing checks and applicable owner policy review. These are independently recorded eligibility gates, not fabricated scopes.
- Initial JSON supports bounded static screens only, with no data-exchange endpoint, clone, migration or auto-publish. Every mutation has a separate exact human approval and one provider attempt; uncertain outcomes are never retried automatically.

### whatsapp_platform_delete_flow

- Current external-client WhatsApp Tech Provider/Embedded Signup and Advanced Access eligibility for both whatsapp_business_management and whatsapp_business_messaging must be independently verified.
- The client owns its WhatsApp account and Messaging account; fresh separate owner-reviewed dual-account assignment is required. API assignment cascade is not proof.
- Actual same-app BISU token debug evidence must include this exact Messaging account ID under both whatsapp_business_management and whatsapp_business_messaging granular scopes.
- Flows require Message templates(view/manage) and Phone Numbers(view/manage) business permissions. Publish additionally requires verified business, high messaging quality, resolved validation/publishing checks and applicable owner policy review. These are independently recorded eligibility gates, not fabricated scopes.
- Initial JSON supports bounded static screens only, with no data-exchange endpoint, clone, migration or auto-publish. Every mutation has a separate exact human approval and one provider attempt; uncertain outcomes are never retried automatically.

### whatsapp_platform_list_templates

- Current external-client Embedded Signup, Tech Provider and Advanced Access for whatsapp_business_management must be independently verified.
- Fresh deployment-owned owner attestation binds the exact client business, app, WhatsApp Account and Messaging Account dual assignment; API cascade is not proof.
- Actual same-app BISU token subject, client_business_id and granular whatsapp_business_management Messaging Account access are verified before every operation.
- Every mutation requires separate human approval. Text-only utility/marketing template submission is not approval, sending, delivery or consent. Actual category and review status are reported from Meta; eligibility and policy remain separate gates.
- Template edits replace all components and may trigger review; only APPROVED, REJECTED or PAUSED templates can be edited. Meta edit frequency limits are enforced by Meta, with no automatic retry.
- Deletion requires both exact registered template ID and name, never name-only deletion across languages. Disabled templates cannot be deleted; accepted deletion may remain pending and names can be unavailable for 30 days. No sending, media upload, OTP or billing operation is implied.

### whatsapp_platform_create_template

- Current external-client Embedded Signup, Tech Provider and Advanced Access for whatsapp_business_management must be independently verified.
- Fresh deployment-owned owner attestation binds the exact client business, app, WhatsApp Account and Messaging Account dual assignment; API cascade is not proof.
- Actual same-app BISU token subject, client_business_id and granular whatsapp_business_management Messaging Account access are verified before every operation.
- Every mutation requires separate human approval. Text-only utility/marketing template submission is not approval, sending, delivery or consent. Actual category and review status are reported from Meta; eligibility and policy remain separate gates.
- Template edits replace all components and may trigger review; only APPROVED, REJECTED or PAUSED templates can be edited. Meta edit frequency limits are enforced by Meta, with no automatic retry.
- Deletion requires both exact registered template ID and name, never name-only deletion across languages. Disabled templates cannot be deleted; accepted deletion may remain pending and names can be unavailable for 30 days. No sending, media upload, OTP or billing operation is implied.

### whatsapp_platform_get_template

- Current external-client Embedded Signup, Tech Provider and Advanced Access for whatsapp_business_management must be independently verified.
- Fresh deployment-owned owner attestation binds the exact client business, app, WhatsApp Account and Messaging Account dual assignment; API cascade is not proof.
- Actual same-app BISU token subject, client_business_id and granular whatsapp_business_management Messaging Account access are verified before every operation.
- Every mutation requires separate human approval. Text-only utility/marketing template submission is not approval, sending, delivery or consent. Actual category and review status are reported from Meta; eligibility and policy remain separate gates.
- Template edits replace all components and may trigger review; only APPROVED, REJECTED or PAUSED templates can be edited. Meta edit frequency limits are enforced by Meta, with no automatic retry.
- Deletion requires both exact registered template ID and name, never name-only deletion across languages. Disabled templates cannot be deleted; accepted deletion may remain pending and names can be unavailable for 30 days. No sending, media upload, OTP or billing operation is implied.

### whatsapp_platform_update_template

- Current external-client Embedded Signup, Tech Provider and Advanced Access for whatsapp_business_management must be independently verified.
- Fresh deployment-owned owner attestation binds the exact client business, app, WhatsApp Account and Messaging Account dual assignment; API cascade is not proof.
- Actual same-app BISU token subject, client_business_id and granular whatsapp_business_management Messaging Account access are verified before every operation.
- Every mutation requires separate human approval. Text-only utility/marketing template submission is not approval, sending, delivery or consent. Actual category and review status are reported from Meta; eligibility and policy remain separate gates.
- Template edits replace all components and may trigger review; only APPROVED, REJECTED or PAUSED templates can be edited. Meta edit frequency limits are enforced by Meta, with no automatic retry.
- Deletion requires both exact registered template ID and name, never name-only deletion across languages. Disabled templates cannot be deleted; accepted deletion may remain pending and names can be unavailable for 30 days. No sending, media upload, OTP or billing operation is implied.

### whatsapp_platform_delete_template

- Current external-client Embedded Signup, Tech Provider and Advanced Access for whatsapp_business_management must be independently verified.
- Fresh deployment-owned owner attestation binds the exact client business, app, WhatsApp Account and Messaging Account dual assignment; API cascade is not proof.
- Actual same-app BISU token subject, client_business_id and granular whatsapp_business_management Messaging Account access are verified before every operation.
- Every mutation requires separate human approval. Text-only utility/marketing template submission is not approval, sending, delivery or consent. Actual category and review status are reported from Meta; eligibility and policy remain separate gates.
- Template edits replace all components and may trigger review; only APPROVED, REJECTED or PAUSED templates can be edited. Meta edit frequency limits are enforced by Meta, with no automatic retry.
- Deletion requires both exact registered template ID and name, never name-only deletion across languages. Disabled templates cannot be deleted; accepted deletion may remain pending and names can be unavailable for 30 days. No sending, media upload, OTP or billing operation is implied.

### whatsapp_platform_get_subscriptions

- External-client WhatsApp Embedded Signup, Tech Provider and Advanced Access for whatsapp_business_management require independently verified current app eligibility.
- The exact client owns the registered WhatsApp and Messaging account pair; fresh separate owner-reviewed dual assignment is required, with no API-cascade inference.
- Only the configured credential's own app is subscribed or unsubscribed. Webhook callback configuration and actual delivery must be separately verified; provider success is not message delivery proof.
- Unsubscription stops this app's webhook delivery for this Messaging account. Every access change requires a separately approved exact human plan and current administrator membership. Callback overrides, other apps and billing changes are not accepted.

### whatsapp_platform_subscribe

- External-client WhatsApp Embedded Signup, Tech Provider and Advanced Access for whatsapp_business_management require independently verified current app eligibility.
- The exact client owns the registered WhatsApp and Messaging account pair; fresh separate owner-reviewed dual assignment is required, with no API-cascade inference.
- Only the configured credential's own app is subscribed or unsubscribed. Webhook callback configuration and actual delivery must be separately verified; provider success is not message delivery proof.
- Unsubscription stops this app's webhook delivery for this Messaging account. Every access change requires a separately approved exact human plan and current administrator membership. Callback overrides, other apps and billing changes are not accepted.

### whatsapp_platform_unsubscribe

- External-client WhatsApp Embedded Signup, Tech Provider and Advanced Access for whatsapp_business_management require independently verified current app eligibility.
- The exact client owns the registered WhatsApp and Messaging account pair; fresh separate owner-reviewed dual assignment is required, with no API-cascade inference.
- Only the configured credential's own app is subscribed or unsubscribed. Webhook callback configuration and actual delivery must be separately verified; provider success is not message delivery proof.
- Unsubscription stops this app's webhook delivery for this Messaging account. Every access change requires a separately approved exact human plan and current administrator membership. Callback overrides, other apps and billing changes are not accepted.

### messenger_get_message

- The registered MESSAGE must have exactly one same-client CONVERSATION parent resolving to the exact authenticated Page or Instagram professional account. A caller message ID or returned participant ID does not establish authority.
- Only details for the 20 most recent conversation messages are available. Older-message 'deleted' errors do not prove actual user deletion; do not fabricate unread or delivery state.
- External customer conversation access requires Advanced Access; Instagram Facebook Login additionally requires app ownership by a verified business. User/linked Page messaging authority must be independently verified.
- Return only scoped participant IDs, timestamp and bounded text. The trusted response normalizer must redact credential-shaped content, cap text at 2000 UTF-8 bytes, explicitly mark truncation and exclude usernames, attachments, URLs and whole objects. No message text enters persistent audit, registry or logs.

### instagram_get_message

- The registered MESSAGE must have exactly one same-client CONVERSATION parent resolving to the exact authenticated Page or Instagram professional account. A caller message ID or returned participant ID does not establish authority.
- Only details for the 20 most recent conversation messages are available. Older-message 'deleted' errors do not prove actual user deletion; do not fabricate unread or delivery state.
- External customer conversation access requires Advanced Access; Instagram Facebook Login additionally requires app ownership by a verified business. User/linked Page messaging authority must be independently verified.
- Return only scoped participant IDs, timestamp and bounded text. The trusted response normalizer must redact credential-shaped content, cap text at 2000 UTF-8 bytes, explicitly mark truncation and exclude usernames, attachments, URLs and whole objects. No message text enters persistent audit, registry or logs.

### instagram_login_get_message

- The registered MESSAGE must have exactly one same-client CONVERSATION parent resolving to the exact authenticated Page or Instagram professional account. A caller message ID or returned participant ID does not establish authority.
- Only details for the 20 most recent conversation messages are available. Older-message 'deleted' errors do not prove actual user deletion; do not fabricate unread or delivery state.
- External customer conversation access requires Advanced Access; Instagram Facebook Login additionally requires app ownership by a verified business. User/linked Page messaging authority must be independently verified.
- Return only scoped participant IDs, timestamp and bounded text. The trusted response normalizer must redact credential-shaped content, cap text at 2000 UTF-8 bytes, explicitly mark truncation and exclude usernames, attachments, URLs and whole objects. No message text enters persistent audit, registry or logs.

### business_get

- The registered target is this client's own business, not an agency-wide business aggregating other clients. Business membership and exact client-owned target authorization must be independently verified.
- App and user both require business_management and the appropriate Marketing API access tier. External customer access and any required Advanced Access must be independently verified; business_users explicitly requires Advanced Access.
- This initial read uses a user token and server-fixed metadata fields only. Do not return email addresses, finance data, tokens or unrelated client inventory. Additional system-user token strategies remain unverified.

### business_list_owned_pages

- The registered target is this client's own business, not an agency-wide business aggregating other clients. Business membership and exact client-owned target authorization must be independently verified.
- App and user both require business_management and the appropriate Marketing API access tier. External customer access and any required Advanced Access must be independently verified; business_users explicitly requires Advanced Access.
- This initial read uses a user token and server-fixed metadata fields only. Do not return email addresses, finance data, tokens or unrelated client inventory. Additional system-user token strategies remain unverified.
- Only separately registered same-client child inventory is returned. Provider-returned IDs do not enroll assets, renew ownership or establish billing; unregistered or foreign child rows are withheld.

### business_list_client_pages

- The registered target is this client's own business, not an agency-wide business aggregating other clients. Business membership and exact client-owned target authorization must be independently verified.
- App and user both require business_management and the appropriate Marketing API access tier. External customer access and any required Advanced Access must be independently verified; business_users explicitly requires Advanced Access.
- This initial read uses a user token and server-fixed metadata fields only. Do not return email addresses, finance data, tokens or unrelated client inventory. Additional system-user token strategies remain unverified.
- Only separately registered same-client child inventory is returned. Provider-returned IDs do not enroll assets, renew ownership or establish billing; unregistered or foreign child rows are withheld.

### business_list_owned_ad_accounts

- The registered target is this client's own business, not an agency-wide business aggregating other clients. Business membership and exact client-owned target authorization must be independently verified.
- App and user both require business_management and the appropriate Marketing API access tier. External customer access and any required Advanced Access must be independently verified; business_users explicitly requires Advanced Access.
- This initial read uses a user token and server-fixed metadata fields only. Do not return email addresses, finance data, tokens or unrelated client inventory. Additional system-user token strategies remain unverified.
- Only separately registered same-client child inventory is returned. Provider-returned IDs do not enroll assets, renew ownership or establish billing; unregistered or foreign child rows are withheld.

### business_list_client_ad_accounts

- The registered target is this client's own business, not an agency-wide business aggregating other clients. Business membership and exact client-owned target authorization must be independently verified.
- App and user both require business_management and the appropriate Marketing API access tier. External customer access and any required Advanced Access must be independently verified; business_users explicitly requires Advanced Access.
- This initial read uses a user token and server-fixed metadata fields only. Do not return email addresses, finance data, tokens or unrelated client inventory. Additional system-user token strategies remain unverified.
- Only separately registered same-client child inventory is returned. Provider-returned IDs do not enroll assets, renew ownership or establish billing; unregistered or foreign child rows are withheld.

### business_list_owned_catalogs

- The registered target is this client's own business, not an agency-wide business aggregating other clients. Business membership and exact client-owned target authorization must be independently verified.
- App and user both require business_management and the appropriate Marketing API access tier. External customer access and any required Advanced Access must be independently verified; business_users explicitly requires Advanced Access.
- This initial read uses a user token and server-fixed metadata fields only. Do not return email addresses, finance data, tokens or unrelated client inventory. Additional system-user token strategies remain unverified.
- Only separately registered same-client child inventory is returned. Provider-returned IDs do not enroll assets, renew ownership or establish billing; unregistered or foreign child rows are withheld.

### business_list_client_catalogs

- The registered target is this client's own business, not an agency-wide business aggregating other clients. Business membership and exact client-owned target authorization must be independently verified.
- App and user both require business_management and the appropriate Marketing API access tier. External customer access and any required Advanced Access must be independently verified; business_users explicitly requires Advanced Access.
- This initial read uses a user token and server-fixed metadata fields only. Do not return email addresses, finance data, tokens or unrelated client inventory. Additional system-user token strategies remain unverified.
- Only separately registered same-client child inventory is returned. Provider-returned IDs do not enroll assets, renew ownership or establish billing; unregistered or foreign child rows are withheld.

### business_list_owned_wabas

- The registered target is this client's own business, not an agency-wide business aggregating other clients. Business membership and exact client-owned target authorization must be independently verified.
- App and user both require business_management and the appropriate Marketing API access tier. External customer access and any required Advanced Access must be independently verified; business_users explicitly requires Advanced Access.
- This initial read uses a user token and server-fixed metadata fields only. Do not return email addresses, finance data, tokens or unrelated client inventory. Additional system-user token strategies remain unverified.
- Only separately registered same-client child inventory is returned. Provider-returned IDs do not enroll assets, renew ownership or establish billing; unregistered or foreign child rows are withheld.

### business_list_users

- The registered target is this client's own business, not an agency-wide business aggregating other clients. Business membership and exact client-owned target authorization must be independently verified.
- App and user both require business_management and the appropriate Marketing API access tier. External customer access and any required Advanced Access must be independently verified; business_users explicitly requires Advanced Access.
- This initial read uses a user token and server-fixed metadata fields only. Do not return email addresses, finance data, tokens or unrelated client inventory. Additional system-user token strategies remain unverified.

### business_list_system_users

- The registered target is this client's own business, not an agency-wide business aggregating other clients. Business membership and exact client-owned target authorization must be independently verified.
- App and user both require business_management and the appropriate Marketing API access tier. External customer access and any required Advanced Access must be independently verified; business_users explicitly requires Advanced Access.
- This initial read uses a user token and server-fixed metadata fields only. Do not return email addresses, finance data, tokens or unrelated client inventory. Additional system-user token strategies remain unverified.

### pages_get

- The target must be the registered client Page represented by the Page token; no public-content fallback. External-user permissions and exact client Page grant must be independently verified.

### pages_list_posts

- Only the exact registered client's Page represented by the Page token is queried, with current external-user access approval and managed-Page authority independently verified. No public-content-access or other Page token fallback.
- This initial literal task subset is CREATE_CONTENT; documented MANAGE/MODERATE alternatives are not fabricated aliases or an all-of requirement.
- Return only PagePost IDs, creation time and publication flag; no commenter identities, media URLs, raw post text or arbitrary field expansion. Published listing is ranked/approximately 600 posts per year; an empty or bounded result is not complete history. Scheduled listing is observation only and does not enable scheduling writes or establish readiness.

### pages_list_published_posts

- Only the exact registered client's Page represented by the Page token is queried, with current external-user access approval and managed-Page authority independently verified. No public-content-access or other Page token fallback.
- This initial literal task subset is CREATE_CONTENT; documented MANAGE/MODERATE alternatives are not fabricated aliases or an all-of requirement.
- Return only PagePost IDs, creation time and publication flag; no commenter identities, media URLs, raw post text or arbitrary field expansion. Published listing is ranked/approximately 600 posts per year; an empty or bounded result is not complete history. Scheduled listing is observation only and does not enable scheduling writes or establish readiness.

### pages_list_scheduled_posts

- Only the exact registered client's Page represented by the Page token is queried, with current external-user access approval and managed-Page authority independently verified. No public-content-access or other Page token fallback.
- This initial literal task subset is CREATE_CONTENT; documented MANAGE/MODERATE alternatives are not fabricated aliases or an all-of requirement.
- Return only PagePost IDs, creation time and publication flag; no commenter identities, media URLs, raw post text or arbitrary field expansion. Published listing is ranked/approximately 600 posts per year; an empty or bounded result is not complete history. Scheduled listing is observation only and does not enable scheduling writes or establish readiness.

### pages_list_feed

- Page-owned/manageable content only; no public-content-access fallback.
- Initial task subset is CREATE_CONTENT. Reference also permits MANAGE or MODERATE; those alternatives remain unimplemented rather than falsely requiring all three.
- External-user app access and client Page grant require independent evidence.

### pages_get_insights

- Current exact Page-token authority, ANALYZE task, external-user App Review/access tier and permissions must be independently verified. Page Insights requires at least100 likes; documenting the endpoint does not establish eligibility for this client Page.
- Initial request is fixed page_media_view/day/date_preset last_7d, without demographics or breakdowns. Current deprecation guide explicitly replaces page_impressions with page_media_view. This counts content played/displayed, including videos, posts, stories and ads; it is not attributed conversion or business-outcome proof.
- Most metrics update24h; available history is at most2years and a query range at most90days. This bounded subset returns at most32 daily values from the fixed current response and never follows paging URLs or fabricates unavailable counts as zero.
- The InsightsResult reference documents id as the query ID but does not specify exact syntax. This subset preserves only bounded opaque query IDs and validates requested metric/period and daily numeric values; it does not infer new asset ownership or grants from a result ID.

### pages_get_subscriptions

- Only the exact registered client's Page represented by the Page token is queried, with current external-user access approval and managed-Page authority independently verified. No public-content-access or other Page token fallback.
- This initial literal task subset is CREATE_CONTENT; documented MANAGE/MODERATE alternatives are not fabricated aliases or an all-of requirement.
- Return only subscribed Application ID/name metadata. This read does not change app/Page subscriptions, prove field-level webhook coverage or prove delivery. Instagram webhook fields require the app dashboard and cannot be configured using this Page edge.

### pages_create_feed

- Reference Requirements lists these three permissions; later Permissions section repeats only pages_manage_posts. Use the conservative documented requirements, not a claim of globally minimal scopes.
- Validate either message or link, published boolean and safe link URL; mentions require separate asset provenance and are initially rejected.
- Scheduling omitted because reference says 75 days while current guide says 30 days; no silent choice of permissive window.

### pages_create_photos

- Current Page app setup, external-user App Review/access tier and exact Page permissions/tasks must be independently verified.
- Initial immediate photo publishing uses the documented POST Page/photos url parameter only. Server translates a registered source image_url to url; scheduling, multi-photo, captions, tags and guessed AI labels are excluded.
- Separate signed facebook_content_publishing rights, immutable content-addressed approved CDN bytes, actual JPEG decode and authenticated human enrollment are mandatory. Instagram-purpose rights cannot be substituted. Initial subset excludes AI-generated images until a documented Page AI-label contract is implemented.
- JPEG 8 MiB and Instagram-compatible dimensions are conservative local reuse of the reviewed decoder envelope, not claimed Facebook photo API minima.
- Provider receipt must include photo id and exact Page composite post_id. Only the returned post is registered; photo metadata creates no grant. Missing post receipt means UNKNOWN and reconciliation, never automatic retry or fabricated post authority.
- Publish requires exact human approval and one durable mutation attempt. Client-owned assets and billing remain unchanged.

### pages_edit_post

- Exact Page-token client grant and external-user App Review/access tier must be independently verified.
- Initial app-created Page post message edit only. The registry must retain a server-created operation reference, exact composite Page_post ID and Page parent. Fresh provider application and from fields must match this app and Page before mutation.
- The current guide requires app-created posts. Current v26 PagePost reference verifies POST and message UTF-8 parameter with success boolean. All three guide tasks are conservatively required; a 10000-byte message bound and rejection of mention syntax are local Lumin policy.
- This operation does not change publish state, schedule, attachments, targeting, ads, or delete the post. Exact human approval and one durable mutation attempt are required; unknown outcomes have no automatic retry.

### pages_hide_comment

- Resolve comment ancestry to the exact registered client Page and Page-token subject; unpublished Pages cannot receive comments. External-user App Review/Advanced Access must be independently verified.
- Current comments guide contains pages_read_user_engagement, absent from the newer Permissions Reference. Use the verified pages_manage_engagement dependencies pages_read_user_content/pages_show_list plus conservative pages_read_engagement; never request the misspelled scope.
- Initial task subset requires MODERATE and CREATE_CONTENT as listed in the current comments guide; this does not claim both are universal minima for every moderation operation.
- Replies are Page-authored text only, locally capped at 2000 characters. Mentions, private replies, attachments and caller identities are excluded. Each moderation write needs exact-plan approval; deletions are irreversible.

### pages_delete_comment

- Resolve comment ancestry to the exact registered client Page and Page-token subject; unpublished Pages cannot receive comments. External-user App Review/Advanced Access must be independently verified.
- Current comments guide contains pages_read_user_engagement, absent from the newer Permissions Reference. Use the verified pages_manage_engagement dependencies pages_read_user_content/pages_show_list plus conservative pages_read_engagement; never request the misspelled scope.
- Initial task subset requires MODERATE and CREATE_CONTENT as listed in the current comments guide; this does not claim both are universal minima for every moderation operation.
- Replies are Page-authored text only, locally capped at 2000 characters. Mentions, private replies, attachments and caller identities are excluded. Each moderation write needs exact-plan approval; deletions are irreversible.

### instagram_get_profile

- Only the authorized client's exact registered Instagram professional account is queried; app-scoped id and professional user_id are distinct and must never be guessed or used to create aliases or grants.
- External customer accounts require independently verified Advanced Access/app review and current authorized user authority. Facebook Login uses a Facebook User token, not the Page-token messaging credential; Business Manager roles conservatively require both ads_management and business_management although endpoint references permit alternatives.
- Return only profile ID, professional username/name and follower/media counts; no private contact, biography, profile picture or arbitrary field expansion.

### instagram_list_media

- Only the authorized client's exact registered Instagram professional account is queried; app-scoped id and professional user_id are distinct and must never be guessed or used to create aliases or grants.
- External customer accounts require independently verified Advanced Access/app review and current authorized user authority. Facebook Login uses a Facebook User token, not the Page-token messaging credential; Business Manager roles conservatively require both ads_management and business_management although endpoint references permit alternatives.
- Return only media IDs from this account. IDs do not enroll child assets, establish readiness or authorize writes. Story media is excluded; Facebook listing is limited to the most recent 10K and this initial bounded subset exposes no caller time-range parameters.

### instagram_create_container

- Only the registered authenticated client's Instagram professional account and exact linked Page/user authority may be used. External customer Advanced Access, applicable app approval, Page Publishing Authorization and required 2FA must be independently verified.
- Newest September 28 User Media/Media Publish references require Facebook User tokens; older June guide says Page token. This initial Facebook content subset uses the newer User-token strategy and CREATE_CONTENT task; do not silently reuse the Page-token messaging credential. Agency Business Manager context conservatively includes both ads_management and ads_read although node references allow one of them.
- Draft creation accepts only a trusted approved client JPEG source with successful decoder proof, payload-bound publication rights, immutable content-addressed URL, MIME/size/dimensions, fresh evidence and truthful AI disclosure. No URL extension inference or raw model-provided media grant is accepted.
- Publishing is separate from draft creation and requires fresh FINISHED/unpublished same-account container evidence plus a durable one-shot claim. Live quota must be read immediately before egress and limited to the lower of provider quota and Lumin's conservative 50 per rolling 24 hours; documentation also mentions 100.
- JPEG-only initial subset: up to 8 MiB, aspect ratio 0.8 through 1.91, width already 320 through 1440 as local no-rescale policy. Video, carousels, tags, collaborators, partnership labels, polls and comment prompts are excluded.
- Provider config_issue/caption_add_on_attachment_status indicates published partial success. Register actual media, report PARTIAL/reconciliation and never automatically retry a publication or uncertain transport outcome.

### instagram_publish_container

- Only the registered authenticated client's Instagram professional account and exact linked Page/user authority may be used. External customer Advanced Access, applicable app approval, Page Publishing Authorization and required 2FA must be independently verified.
- Newest September 28 User Media/Media Publish references require Facebook User tokens; older June guide says Page token. This initial Facebook content subset uses the newer User-token strategy and CREATE_CONTENT task; do not silently reuse the Page-token messaging credential. Agency Business Manager context conservatively includes both ads_management and ads_read although node references allow one of them.
- Draft creation accepts only a trusted approved client JPEG source with successful decoder proof, payload-bound publication rights, immutable content-addressed URL, MIME/size/dimensions, fresh evidence and truthful AI disclosure. No URL extension inference or raw model-provided media grant is accepted.
- Publishing is separate from draft creation and requires fresh FINISHED/unpublished same-account container evidence plus a durable one-shot claim. Live quota must be read immediately before egress and limited to the lower of provider quota and Lumin's conservative 50 per rolling 24 hours; documentation also mentions 100.
- JPEG-only initial subset: up to 8 MiB, aspect ratio 0.8 through 1.91, width already 320 through 1440 as local no-rescale policy. Video, carousels, tags, collaborators, partnership labels, polls and comment prompts are excluded.
- Provider config_issue/caption_add_on_attachment_status indicates published partial success. Register actual media, report PARTIAL/reconciliation and never automatically retry a publication or uncertain transport outcome.

### instagram_get_container_status

- Only the registered authenticated client's Instagram professional account and exact linked Page/user authority may be used. External customer Advanced Access, applicable app approval, Page Publishing Authorization and required 2FA must be independently verified.
- Newest September 28 User Media/Media Publish references require Facebook User tokens; older June guide says Page token. This initial Facebook content subset uses the newer User-token strategy and CREATE_CONTENT task; do not silently reuse the Page-token messaging credential. Agency Business Manager context conservatively includes both ads_management and ads_read although node references allow one of them.
- Draft creation accepts only a trusted approved client JPEG source with successful decoder proof, payload-bound publication rights, immutable content-addressed URL, MIME/size/dimensions, fresh evidence and truthful AI disclosure. No URL extension inference or raw model-provided media grant is accepted.
- Publishing is separate from draft creation and requires fresh FINISHED/unpublished same-account container evidence plus a durable one-shot claim. Live quota must be read immediately before egress and limited to the lower of provider quota and Lumin's conservative 50 per rolling 24 hours; documentation also mentions 100.
- JPEG-only initial subset: up to 8 MiB, aspect ratio 0.8 through 1.91, width already 320 through 1440 as local no-rescale policy. Video, carousels, tags, collaborators, partnership labels, polls and comment prompts are excluded.
- Provider config_issue/caption_add_on_attachment_status indicates published partial success. Register actual media, report PARTIAL/reconciliation and never automatically retry a publication or uncertain transport outcome.

### instagram_business_discovery

- Exact authorized client professional Instagram query account, Facebook User token, external-user App Review/access tier and current permission pack must be independently verified. Both ads permissions conservatively cover Business Manager role context.
- This endpoint intentionally reads public metadata about another Business or Creator account by username. Age-gated accounts are unavailable. Only public follower/media counts and IDs are returned; no profile biography, contacts, media edges/URLs, arbitrary fields, or personal-account fallback.
- A strict local username subset of1..30 ASCII letters/numbers/dots/underscores is inserted into a server-owned field-expansion template. This local bound is not a claim of a universally documented Meta maximum. Outer response id must match the exact authorized query account.
- Looked-up account IDs are public lookup metadata only. They do not establish client ownership, user authority, child assets, grants or approval for publishing/ads. Counts alone are not business-outcome or attribution proof.

### instagram_hashtag_search

- Instagram Public Content Access feature approval, external-client App Review/access tier, exact Facebook User token and provider-approved tasks on the linked Page must be independently verified. No task alias or feature-as-scope is fabricated; Business Manager alternatives are covered conservatively by this scope pack.
- Server supplies user_id from the exact authorized registered IG account. Only a lowercase ASCII hashtag subset is accepted as local policy, without emojis, leading hash, URL or field expansion. Hashtag IDs are public static global lookup metadata, never client assets or grants.
- Fresh recently_searched_hashtags usage is read with documented limit30 before lookup. Atomic per-tenant/client/app/account hashed-query reservations bound concurrent new searches to30 unique tags in7days. Unknown attempts retain their reservation; no automatic retry. Actual provider usage remains authoritative across external actors/apps, which may consume slots concurrently and cause provider rejection.
- Repeated known global IDs or an exact current provider name match can be returned without issuing another hashtag search. Names are used transiently for matching; raw tags, credentials and provider bodies are not persisted. Pending/unknown reservations are conservatively counted unless exact current usage already accounts for that hashed query.

### instagram_get_mentions

- Current Facebook User token and linked Page CREATE_CONTENT task must be independently verified. This conservatively selects one of the documented MANAGE, CREATE_CONTENT or MODERATE alternatives; no task aliases are inferred.
- External-user access tier, App Review, exact client query account and current permissions must be independently verified. Both ads permissions conservatively cover Business Manager role context.
- Metadata only: requested mention ID is not ownership or a child grant. Private-origin webhook absence, disabled comments, and unsupported story mentions remain provider limitations. No media URLs, author identifiers, text, arbitrary fields or pagination are returned.

### instagram_get_mentioned_media

- Current Facebook User token and linked Page CREATE_CONTENT task must be independently verified. This conservatively selects one of the documented MANAGE, CREATE_CONTENT or MODERATE alternatives; no task aliases are inferred.
- External-user access tier, App Review, exact client query account and current permissions must be independently verified. Both ads permissions conservatively cover Business Manager role context.
- Metadata only: requested mention ID is not ownership or a child grant. Private-origin webhook absence, disabled comments, and unsupported story mentions remain provider limitations. No media URLs, author identifiers, text, arbitrary fields or pagination are returned.

### instagram_login_profile

- Only the authorized client's exact registered Instagram professional account is queried; app-scoped id and professional user_id are distinct and must never be guessed or used to create aliases or grants.
- External customer accounts require independently verified Advanced Access/app review and current authorized user authority. Facebook Login uses a Facebook User token, not the Page-token messaging credential; Business Manager roles conservatively require both ads_management and business_management although endpoint references permit alternatives.
- Return only profile ID, professional username/name and follower/media counts; no private contact, biography, profile picture or arbitrary field expansion.

### instagram_login_list_media

- Only the authorized client's exact registered Instagram professional account is queried; app-scoped id and professional user_id are distinct and must never be guessed or used to create aliases or grants.
- External customer accounts require independently verified Advanced Access/app review and current authorized user authority. Facebook Login uses a Facebook User token, not the Page-token messaging credential; Business Manager roles conservatively require both ads_management and business_management although endpoint references permit alternatives.
- Return only media IDs from this account. IDs do not enroll child assets, establish readiness or authorize writes. Story media is excluded; Facebook listing is limited to the most recent 10K and this initial bounded subset exposes no caller time-range parameters.

### instagram_login_create_container

- Only the registered authenticated client's Instagram professional account and exact linked Page/user authority may be used. External customer Advanced Access, applicable app approval, Page Publishing Authorization and required 2FA must be independently verified.
- Newest September 28 User Media/Media Publish references require Facebook User tokens; older June guide says Page token. This initial Facebook content subset uses the newer User-token strategy and CREATE_CONTENT task; do not silently reuse the Page-token messaging credential. Agency Business Manager context conservatively includes both ads_management and ads_read although node references allow one of them.
- Draft creation accepts only a trusted approved client JPEG source with successful decoder proof, payload-bound publication rights, immutable content-addressed URL, MIME/size/dimensions, fresh evidence and truthful AI disclosure. No URL extension inference or raw model-provided media grant is accepted.
- Publishing is separate from draft creation and requires fresh FINISHED/unpublished same-account container evidence plus a durable one-shot claim. Live quota must be read immediately before egress and limited to the lower of provider quota and Lumin's conservative 50 per rolling 24 hours; documentation also mentions 100.
- JPEG-only initial subset: up to 8 MiB, aspect ratio 0.8 through 1.91, width already 320 through 1440 as local no-rescale policy. Video, carousels, tags, collaborators, partnership labels, polls and comment prompts are excluded.
- Provider config_issue/caption_add_on_attachment_status indicates published partial success. Register actual media, report PARTIAL/reconciliation and never automatically retry a publication or uncertain transport outcome.

### instagram_login_publish

- Only the registered authenticated client's Instagram professional account and exact linked Page/user authority may be used. External customer Advanced Access, applicable app approval, Page Publishing Authorization and required 2FA must be independently verified.
- Newest September 28 User Media/Media Publish references require Facebook User tokens; older June guide says Page token. This initial Facebook content subset uses the newer User-token strategy and CREATE_CONTENT task; do not silently reuse the Page-token messaging credential. Agency Business Manager context conservatively includes both ads_management and ads_read although node references allow one of them.
- Draft creation accepts only a trusted approved client JPEG source with successful decoder proof, payload-bound publication rights, immutable content-addressed URL, MIME/size/dimensions, fresh evidence and truthful AI disclosure. No URL extension inference or raw model-provided media grant is accepted.
- Publishing is separate from draft creation and requires fresh FINISHED/unpublished same-account container evidence plus a durable one-shot claim. Live quota must be read immediately before egress and limited to the lower of provider quota and Lumin's conservative 50 per rolling 24 hours; documentation also mentions 100.
- JPEG-only initial subset: up to 8 MiB, aspect ratio 0.8 through 1.91, width already 320 through 1440 as local no-rescale policy. Video, carousels, tags, collaborators, partnership labels, polls and comment prompts are excluded.
- Provider config_issue/caption_add_on_attachment_status indicates published partial success. Register actual media, report PARTIAL/reconciliation and never automatically retry a publication or uncertain transport outcome.

### instagram_login_get_container_status

- Only the registered authenticated client's Instagram professional account and exact linked Page/user authority may be used. External customer Advanced Access, applicable app approval, Page Publishing Authorization and required 2FA must be independently verified.
- Newest September 28 User Media/Media Publish references require Facebook User tokens; older June guide says Page token. This initial Facebook content subset uses the newer User-token strategy and CREATE_CONTENT task; do not silently reuse the Page-token messaging credential. Agency Business Manager context conservatively includes both ads_management and ads_read although node references allow one of them.
- Draft creation accepts only a trusted approved client JPEG source with successful decoder proof, payload-bound publication rights, immutable content-addressed URL, MIME/size/dimensions, fresh evidence and truthful AI disclosure. No URL extension inference or raw model-provided media grant is accepted.
- Publishing is separate from draft creation and requires fresh FINISHED/unpublished same-account container evidence plus a durable one-shot claim. Live quota must be read immediately before egress and limited to the lower of provider quota and Lumin's conservative 50 per rolling 24 hours; documentation also mentions 100.
- JPEG-only initial subset: up to 8 MiB, aspect ratio 0.8 through 1.91, width already 320 through 1440 as local no-rescale policy. Video, carousels, tags, collaborators, partnership labels, polls and comment prompts are excluded.
- Provider config_issue/caption_add_on_attachment_status indicates published partial success. Register actual media, report PARTIAL/reconciliation and never automatically retry a publication or uncertain transport outcome.

### instagram_login_conversations

- Instagram user token must come from a person authorized to manage this professional account's messages.
- Advanced Access for professional accounts not owned/managed by the app operator; Standard Access only for owned/managed accounts added in App Dashboard.
- Requests inactive for 30 days may be omitted; empty response does not prove no unanswered messages.
- Use graph.instagram.com; do not substitute Facebook Page token or host.

### instagram_login_get_messages

- Resolve conversation provenance to the exact client Instagram professional account before calling the provider.
- Same access-level/managed-account conditions as Instagram Login conversation listing; raw message content is not requested by this projection.

### instagram_list_conversations

- Page must be linked to the exact client Instagram professional account; app owned by verified business.
- Advanced Access for external conversations; inactive Requests may be omitted.

### messenger_list_conversations

- Initial task subset MESSAGING; reference also allows MODERATE as an alternative, not an additional required task.
- Advanced Access for conversations with people outside app/Page/business roles; verify current external access evidence.

### messenger_get_messages

- Resolve exact client/Page conversation provenance and inherited messaging task before execution; only IDs/timestamps requested.
- Advanced Access for external conversations; only twenty most recent messages allow detail reads, which this projection does not request.

### messenger_send_text

- Observe recipient-to-Page provenance and a fresh inbound message within Lumin's initial 24-hour window; do not accept caller-asserted timing. Current Meta docs allow some ad-origin windows up to seven days, which this initial policy does not enable.
- Advanced Access and any required review must be independently verified for external users.
- Exact body: recipient.id is a PSID, message.text is text, and server fixes messaging_type to RESPONSE. Facebook Login app-scoped user IDs are invalid recipients.
- Only validated text response schema; attachments, templates, tags and outside-window exceptions remain disabled. Meta text-length limit is UNVERIFIED; any local length cap must be identified as Lumin policy.

### threads_get_profile

- Only the app-scoped user profile may be fetched; verify the requested asset is the connection subject.
- Current primary reference uses graph.threads.com/v1.0; it supersedes older Postman graph.threads.net examples.
- External-user App Review/publication and independent client asset mapping remain separate gates.

### threads_list_threads

- Only app-scoped user posts; verify account asset equals the connection subject.
- Cursor pagination observed; no caller-supplied field expansion or unverified maximum page size.

### threads_get_post

- Resolve post provenance to an authorized client account before execution. Tester-only before advanced threads_basic approval; approval does not bypass Lumin asset isolation.

### threads_list_replies

- Resolve the target root post to the authenticated client's Threads account. Reply retrieval is limited to the user's own Threads; no public discovery or unrelated user's post is authorized.
- Fixed reply ancestry/status metadata only. /replies returns immediate replies; /conversation is only intended for root-level posts and returns all depths. Nested reply IDs do not independently grant moderation rights.
- External user access and required permission approval must be independently verified. This initial subset does not expose user text or arbitrary fields.

### threads_list_insights

- Only this client's registered authenticated Threads account and its registered own posts may be queried. External App Review/Advanced Access and account authority must be independently verified.
- Account views use the provider's default yesterday-through-today window. Post likes/replies/reposts/quotes/shares are lifetime metrics; never conflate these periods or infer outcome proof from estimates.
- The strict response normalizer must validate the exact requested asset, requested metric names, documented period and bounded numeric values before returning data. No caller arbitrary metrics, dates or field expansion.

### threads_get_post_insights

- Only this client's registered authenticated Threads account and its registered own posts may be queried. External App Review/Advanced Access and account authority must be independently verified.
- Account views use the provider's default yesterday-through-today window. Post likes/replies/reposts/quotes/shares are lifetime metrics; never conflate these periods or infer outcome proof from estimates.
- The strict response normalizer must validate the exact requested asset, requested metric names, documented period and bounded numeric values before returning data. No caller arbitrary metrics, dates or field expansion.

### threads_list_threads_publishing_limit

- Only the authenticated client's registered Threads account reply quota is requested. This read does not authorize publishing; reply limit is 1000 within a rolling 24-hour period, and current response/config remains authoritative.
- The guide explicitly requires all three scopes for this endpoint; external permission approval and connection subject must be independently verified.

### threads_create_container

- External user publication requires published app and Advanced Access for threads_content_publish; otherwise only registered Threads testers may publish.
- Only the connection subject's registered client Threads account may create a container. This operation creates a draft and does not authorize publication.
- Initial schema requires media_type TEXT and is_carousel_item false. Lumin conservatively limits the entire text to 500 UTF-8 bytes and excludes explicit HTTP/www links; the provider documents 500 characters with emojis counted as UTF-8 bytes. Media, link attachment, automatic publication and additional parameters remain disabled.
- Persist returned container provenance to this exact client/app/account before any later publication; successful creation does not establish publication readiness.

### threads_publish_container

- External user publication requires published app and Advanced Access for threads_content_publish; otherwise only registered Threads testers may publish.
- The registered MEDIA container must be freshly verified as created for this exact client/app/Threads account, with completed processing and no prior publication. Missing trusted container state remains HOLD.
- Publication requires its own exact-plan approval; approval of draft creation does not authorize publication. Provider recommends approximately 30 seconds processing time; elapsed time alone is not a readiness proof.

### threads_manage_reply

- Trusted fresh reply evidence must resolve to this client's registered root post and authenticated Threads account; missing provenance is HOLD. External user permission approval must be independently verified.
- Hiding/unhiding only targets top-level replies and cascades to nested replies; isolated nested-reply hiding is forbidden. Pending approval actions require independently verified pending/ignored status.
- Only the explicit boolean moderation action is accepted, with its own exact-plan approval. No posting, automatic approval, reply text, private messaging or unrelated account moderation is enabled.

### threads_delete_post

- Only delete a post created by the authenticated Threads user; registered client post provenance must resolve to that connection subject.
- Deletion is irreversible and requires its own exact-plan approval. Provider account limit is 100 deletions per day; do not retry uncertain outcomes.
- External client access and permission approval must be independently verified before execution.

### threads_get_conversation

- Resolve the target root post to the authenticated client's Threads account. Reply retrieval is limited to the user's own Threads; no public discovery or unrelated user's post is authorized.
- Fixed reply ancestry/status metadata only. /replies returns immediate replies; /conversation is only intended for root-level posts and returns all depths. Nested reply IDs do not independently grant moderation rights.
- External user access and required permission approval must be independently verified. This initial subset does not expose user text or arbitrary fields.

### threads_list_pending_replies

- The target is the authenticated client's registered root Threads post with reply approvals enabled. External user access and permission approval require independent verification.
- Only pending/ignored reply metadata and exact root/parent IDs are requested. Trusted observation may refresh evidence for existing registered same-client replies; returned IDs alone do not grant access or moderation authorization.

### threads_get_post_status

- Resolve the registered container to the authenticated client's Threads account. Use the conservative documented publishing scope pack rather than claiming endpoint-specific minimum scope.
- Only FINISHED means ready to publish; IN_PROGRESS, EXPIRED, ERROR and PUBLISHED cannot authorize publication. Trusted server refresh must persist checked status and exact container/account/app provenance.
- Poll at most once per minute for no more than five minutes; no automatic publishing or polling loop is enabled by this read tool.

### threads_manage_pending_reply

- Trusted fresh reply evidence must resolve to this client's registered root post and authenticated Threads account; missing provenance is HOLD. External user permission approval must be independently verified.
- Hiding/unhiding only targets top-level replies and cascades to nested replies; isolated nested-reply hiding is forbidden. Pending approval actions require independently verified pending/ignored status.
- Only the explicit boolean moderation action is accepted, with its own exact-plan approval. No posting, automatic approval, reply text, private messaging or unrelated account moderation is enabled.

### leads_list_forms

- Use the conservative documented full lead/ad-data permission pack and a Page/User token requested by a person authorized to advertise on the client's Page and ad account. Current Leads Access Manager assignment must be independently verified; Page administrator status does not establish customized leads access.
- External-user app review/Advanced Access and Ads Management Standard Access are independently verified feature gates, never fabricated OAuth scopes.
- Form metadata remains confined to this client's registered Page. SDK node/edge method and fields are primary evidence; permission pack is conservative sufficient lead-access authority, not a claim of endpoint-specific universal minimum scopes. Form listing does not enroll children or renew their evidence.
- Return ID/name/status/created_time/page_id only; omit form questions, legal text, private answers, URLs and whole objects.
- Current Permissions Reference additionally requires Ads Management Standard Access as a feature/access-tier gate; this is not an OAuth scope and must be independently verified.

### leads_get_form

- Use the conservative documented full lead/ad-data permission pack and a Page/User token requested by a person authorized to advertise on the client's Page and ad account. Current Leads Access Manager assignment must be independently verified; Page administrator status does not establish customized leads access.
- External-user app review/Advanced Access and Ads Management Standard Access are independently verified feature gates, never fabricated OAuth scopes.
- Form metadata remains confined to this client's registered Page. SDK node/edge method and fields are primary evidence; permission pack is conservative sufficient lead-access authority, not a claim of endpoint-specific universal minimum scopes. Form listing does not enroll children or renew their evidence.
- Return ID/name/status/created_time/page_id only; omit form questions, legal text, private answers, URLs and whole objects.
- Current Permissions Reference additionally requires Ads Management Standard Access as a feature/access-tier gate; this is not an OAuth scope and must be independently verified.

### leads_retrieve

- Use the conservative documented full lead/ad-data permission pack and a Page/User token requested by a person authorized to advertise on the client's Page and ad account. Current Leads Access Manager assignment must be independently verified; Page administrator status does not establish customized leads access.
- External-user app review/Advanced Access and Ads Management Standard Access are independently verified feature gates, never fabricated OAuth scopes.
- The target registered form, linked Page, client ad account and separately selected registered ad must have fresh same-client grants. ad_id is a server-only authority reference and never becomes a provider query parameter. Other-ad, organic, preview and foreign-form rows are withheld; returned lead IDs do not create grants.
- Return at most 100 selected-ad leads, 50 fields each and 10 string answers per field. Text is bounded to 2000 UTF-8 bytes with explicit truncation/credential-redaction flags. Answer text additionally has a 64 KiB aggregate cap. Optional created_since/created_until are paired Unix-second local filters (maximum 31 days, within local 90-day history policy), never provider query parameters; current-page results remain explicitly incomplete. No answers enter persistent registry, audits, logs or receiving adapters; disclaimer responses and marketing opt-in are not inferred.
- Current Permissions Reference additionally requires Ads Management Standard Access as a feature/access-tier gate; this is not an OAuth scope and must be independently verified.

### leads_get_lead

- Token must be requested by a person authorized to advertise on both the client Page and client ad account; documented full lead/ad-data permission pack is used conservatively.
- Leads Access Manager access must be independently verified: customized lead access is not implied by Page administrator status.
- Initial ad-lead metadata subset requires a registered lead with explicit same-client LEAD_FORM, PAGE and AD_ACCOUNT ancestry and fresh grants to every parent. Signed leadgen webhook provenance must bind leadgen_id to the exact form/Page; raw foreign IDs are rejected.
- Server fixes fields=id,created_time and returns metadata only. Full field_data/contact information and custom-disclaimer responses require a separate trusted receiving adapter and privacy/consent review; no LeadGate coupling is assumed.
- External-user app permission/access review and current Meta product/API-version eligibility must be independently verified before execution.
- Current Permissions Reference additionally requires Ads Management Standard Access as a feature/access-tier gate; this is not an OAuth scope and must be independently verified.

### signals_send_pixel_events

- Agency platform requires independently verified App Review Advanced Access and Marketing API Access Tier plus documented platform permissions; direct own-business exemptions do not establish agency eligibility.
- System user must have the client-owned Pixel assigned with Manage Pixel access; client authorization and Lumin same-client asset grant remain mandatory. Do not infer dataset IDs equal Pixel IDs.
- Use the dedicated trusted first-party dispatcher: model input contains only source and consent references. Resolve actual events internally, verify payload-bound source/consent evidence, normalize/hash required PII, preserve event_id/event_name and durable deduplication checkpoints.
- No synthetic or fabricated conversions. test_event_code is disabled: current Using API documentation says test-code events are not dropped and can be used for targeting and ads measurement.
- Exactly one event and one guarded egress attempt per durable checkpoint; transport uncertainty remains UNKNOWN with no automatic retry. Accepted count does not prove attribution, optimization, match quality or completed delivery.
- Production trusted-source resolver, consent adapter, durable dispatcher store and guarded transport must be configured and reviewed before execution; generic product-body handling must not bypass the dedicated dispatcher.

### catalog_list_products

- catalog_management permits reading business-owned catalogs of which the user is an admin; independently verify MANAGE catalog task, customer authorization and exact client catalog grant.
- Developer-mode access is limited to catalogs owned by app admins/developers. Appropriate Marketing API access level, any required external-user approval and previously accepted catalog terms must be independently verified; this tool does not accept terms or create a catalog.
- Metadata-only user-token read with fixed fields; no feed schedules, source URLs, passwords, raw filter objects or arbitrary field expansion. Returned child IDs establish inventory only and do not grant write authorization.
- For feeds, the user must be an employee of the business or an employee of an agency assigned to that business. No cross-client agency catalog aggregate is used as the target.

### catalog_list_product_sets

- catalog_management permits reading business-owned catalogs of which the user is an admin; independently verify MANAGE catalog task, customer authorization and exact client catalog grant.
- Developer-mode access is limited to catalogs owned by app admins/developers. Appropriate Marketing API access level, any required external-user approval and previously accepted catalog terms must be independently verified; this tool does not accept terms or create a catalog.
- Metadata-only user-token read with fixed fields; no feed schedules, source URLs, passwords, raw filter objects or arbitrary field expansion. Returned child IDs establish inventory only and do not grant write authorization.
- For feeds, the user must be an employee of the business or an employee of an agency assigned to that business. No cross-client agency catalog aggregate is used as the target.

### catalog_list_product_feeds

- catalog_management permits reading business-owned catalogs of which the user is an admin; independently verify MANAGE catalog task, customer authorization and exact client catalog grant.
- Developer-mode access is limited to catalogs owned by app admins/developers. Appropriate Marketing API access level, any required external-user approval and previously accepted catalog terms must be independently verified; this tool does not accept terms or create a catalog.
- Metadata-only user-token read with fixed fields; no feed schedules, source URLs, passwords, raw filter objects or arbitrary field expansion. Returned child IDs establish inventory only and do not grant write authorization.
- For feeds, the user must be an employee of the business or an employee of an agency assigned to that business. No cross-client agency catalog aggregate is used as the target.

### catalog_list_assigned_users

- Exact registered catalog and unique client-owned Business parent must be independently verified. Business parameter is server-derived, never caller-supplied. External-user App Review/access tier and exact current catalog permissions remain independent gates.
- Current endpoint reference identifies ads_management and catalog_management and required business. Official Meta SDK v26.0.2 preserves GET /assigned_users with business:string; older rendered reference examples use v25.0.
- Only a first-page bounded role summary is returned. No user identifiers, names, assignment writes, task grants, whole objects or continuation URLs. Empty results are observed empty, not proof no users exist.

### oembed_facebook

- Tokenless frontend embedding only, available since June15,2026. No Meta access token or App Review required for public content; provider tokenless quota is1000requests perendpoint/hour. Local limits do not coordinate replicas or thirdparty applications.
- The dedicated authenticated client frontend must render provider HTML. No HTML, metadata or content URL may enter model outputs, registry, audit or persistent stores. No analytics, extraction, derived information or arbitrary content reuse.
- Only strict public content URL subsets accepted. Private/inactive/age-restricted or embeds-disabled content unavailable. Instagram Stories unsupported. No arbitrary fetch URLs, redirect following, browser cookies or provider tokens.

### oembed_instagram

- Tokenless frontend embedding only, available since June15,2026. No Meta access token or App Review required for public content; provider tokenless quota is1000requests perendpoint/hour. Local limits do not coordinate replicas or thirdparty applications.
- The dedicated authenticated client frontend must render provider HTML. No HTML, metadata or content URL may enter model outputs, registry, audit or persistent stores. No analytics, extraction, derived information or arbitrary content reuse.
- Only strict public content URL subsets accepted. Private/inactive/age-restricted or embeds-disabled content unavailable. Instagram Stories unsupported. No arbitrary fetch URLs, redirect following, browser cookies or provider tokens.

### whatsapp_platform_send_message

- The connection has independently verified access to both the client-owned WhatsApp account and its linked client-owned Messaging account; do not rely on interim API grant cascading.
- Tech Provider client access uses a customer-scoped Business Integration System User token obtained through Embedded Signup; system_user is limited to independently verified direct-developer own-business context.
- External customer data requires App Review and Advanced Access for whatsapp_business_messaging; documentation evidence alone does not prove Lumin approval.
- Legacy WABA_ID in these endpoints identifies the Messaging account; verify the account-model mapping and same-client WhatsApp-account parent before execution. Client billing remains on the client's Messaging account.
- Every recipient requires independently recorded opt-in to this client's business. Service messages require a trusted inbound message or call within 24 hours; caller timing assertions are invalid.
- Initial send contract is text-only in an open service window; approved utility-template sends require a separate reviewed contract and remain disabled here.
- If token access covers multiple Messaging accounts for the phone, inject messaging_account_id resolved from the verified client asset graph. Never let caller select agency or another client's billing account.
- Provider success means accepted, not delivered; correlate independently authenticated status webhooks before claiming delivery. Group messages, media, bulk sends and marketing exceptions remain disabled.
- Server constructs messaging_product=whatsapp, recipient_type=individual, type=text, text.body from normalized text, and preview_url=false. Require plus-prefixed E.164 recipient; official guide recommends plus and country calling code to avoid misdelivery. A 2000-character cap is Lumin policy, not a claimed Meta maximum.
- Production trusted signed-webhook and independently verified client-consent ingestion pipelines must be configured and reviewed; internal evidence source labels alone do not prove real provenance.

### whatsapp_platform_list_phones

- Current external-client Embedded Signup, Tech Provider and Advanced Access for the exact required WhatsApp permissions must be independently verified.
- Fresh deployment-owned owner attestation binds the exact client business, app, WhatsApp Account and Messaging Account dual assignment. Phone roots must have exact registered dual-account parents; API cascade is not proof.
- Actual same-app BISU app/user/scopes, client_business_id and granular Messaging Account access are inspected. The exact Messaging account phone_numbers edge verifies current phone membership before output or mutation.
- Business profile get/manage uses whatsapp_business_messaging with whatsapp_business_management dependency. Profile changes require separate exact human approval; sending, verification codes, registration, display-name approval and picture uploads are separate operations.
- Business contact metadata is returned only to current authorized client readers, without personal inbox/contact data. Website URLs must be credential-free HTTPS. Mutations have one durable attempt and no automatic retry. Client-owned billing remains unchanged.

### whatsapp_platform_get_phone

- Current external-client Embedded Signup, Tech Provider and Advanced Access for the exact required WhatsApp permissions must be independently verified.
- Fresh deployment-owned owner attestation binds the exact client business, app, WhatsApp Account and Messaging Account dual assignment. Phone roots must have exact registered dual-account parents; API cascade is not proof.
- Actual same-app BISU app/user/scopes, client_business_id and granular Messaging Account access are inspected. The exact Messaging account phone_numbers edge verifies current phone membership before output or mutation.
- Business profile get/manage uses whatsapp_business_messaging with whatsapp_business_management dependency. Profile changes require separate exact human approval; sending, verification codes, registration, display-name approval and picture uploads are separate operations.
- Business contact metadata is returned only to current authorized client readers, without personal inbox/contact data. Website URLs must be credential-free HTTPS. Mutations have one durable attempt and no automatic retry. Client-owned billing remains unchanged.

### whatsapp_platform_get_profile

- Current external-client Embedded Signup, Tech Provider and Advanced Access for the exact required WhatsApp permissions must be independently verified.
- Fresh deployment-owned owner attestation binds the exact client business, app, WhatsApp Account and Messaging Account dual assignment. Phone roots must have exact registered dual-account parents; API cascade is not proof.
- Actual same-app BISU app/user/scopes, client_business_id and granular Messaging Account access are inspected. The exact Messaging account phone_numbers edge verifies current phone membership before output or mutation.
- Business profile get/manage uses whatsapp_business_messaging with whatsapp_business_management dependency. Profile changes require separate exact human approval; sending, verification codes, registration, display-name approval and picture uploads are separate operations.
- Business contact metadata is returned only to current authorized client readers, without personal inbox/contact data. Website URLs must be credential-free HTTPS. Mutations have one durable attempt and no automatic retry. Client-owned billing remains unchanged.

### whatsapp_platform_update_profile

- Current external-client Embedded Signup, Tech Provider and Advanced Access for the exact required WhatsApp permissions must be independently verified.
- Fresh deployment-owned owner attestation binds the exact client business, app, WhatsApp Account and Messaging Account dual assignment. Phone roots must have exact registered dual-account parents; API cascade is not proof.
- Actual same-app BISU app/user/scopes, client_business_id and granular Messaging Account access are inspected. The exact Messaging account phone_numbers edge verifies current phone membership before output or mutation.
- Business profile get/manage uses whatsapp_business_messaging with whatsapp_business_management dependency. Profile changes require separate exact human approval; sending, verification codes, registration, display-name approval and picture uploads are separate operations.
- Business contact metadata is returned only to current authorized client readers, without personal inbox/contact data. Website URLs must be credential-free HTTPS. Mutations have one durable attempt and no automatic retry. Client-owned billing remains unchanged.

### instagram_list_comments

- External-client App Review and Advanced Access for the exact permissions must be independently verified; a documented contract does not establish provider approval.
- Initial Lumin subset is registered owner IMAGE media only. Fresh media owner and media_type reads are required before every operation; live/video/carousel handling is excluded.
- Facebook-login uses the User-token strategy documented by the IGComment and current IGMedia node references; the separate comment guide documents a Page-token strategy, which this module does not substitute or equate. Both ads permissions conservatively cover Business Manager role context.
- Reply requires a fresh non-hidden top-level comment belonging to the exact registered media. Media ownership must match the authorized Instagram account. No private replies, messages, author profiles or implicit child grants.
- Comment lists expose bounded client-private IDs/timestamps/text excerpts on the current response page only, without author profiles or persistence. Replies require exact human approval and one durable mutation attempt; unknown outcomes must be reconciled without automatic retry.

### instagram_reply_comment

- External-client App Review and Advanced Access for the exact permissions must be independently verified; a documented contract does not establish provider approval.
- Initial Lumin subset is registered owner IMAGE media only. Fresh media owner and media_type reads are required before every operation; live/video/carousel handling is excluded.
- Facebook-login uses the User-token strategy documented by the IGComment and current IGMedia node references; the separate comment guide documents a Page-token strategy, which this module does not substitute or equate. Both ads permissions conservatively cover Business Manager role context.
- Reply requires a fresh non-hidden top-level comment belonging to the exact registered media. Media ownership must match the authorized Instagram account. No private replies, messages, author profiles or implicit child grants.
- Comment lists expose bounded client-private IDs/timestamps/text excerpts on the current response page only, without author profiles or persistence. Replies require exact human approval and one durable mutation attempt; unknown outcomes must be reconciled without automatic retry.

### instagram_hide_comment

- External-client App Review and Advanced Access for the exact permissions must be independently verified; a documented contract does not establish provider approval.
- Initial Lumin subset is registered owner IMAGE media only. Fresh media owner and media_type reads are required before every operation; live/video/carousel handling is excluded.
- Facebook-login uses the User-token strategy documented by the IGComment and current IGMedia node references; the separate comment guide documents a Page-token strategy, which this module does not substitute or equate. Both ads permissions conservatively cover Business Manager role context.
- Reply requires a fresh non-hidden top-level comment belonging to the exact registered media. Media ownership must match the authorized Instagram account. No private replies, messages, author profiles or implicit child grants.
- Comment lists expose bounded client-private IDs/timestamps/text excerpts on the current response page only, without author profiles or persistence. Replies require exact human approval and one durable mutation attempt; unknown outcomes must be reconciled without automatic retry.

### instagram_delete_comment

- External-client App Review and Advanced Access for the exact permissions must be independently verified; a documented contract does not establish provider approval.
- Initial Lumin subset is registered owner IMAGE media only. Fresh media owner and media_type reads are required before every operation; live/video/carousel handling is excluded.
- Facebook-login uses the User-token strategy documented by the IGComment and current IGMedia node references; the separate comment guide documents a Page-token strategy, which this module does not substitute or equate. Both ads permissions conservatively cover Business Manager role context.
- Reply requires a fresh non-hidden top-level comment belonging to the exact registered media. Media ownership must match the authorized Instagram account. No private replies, messages, author profiles or implicit child grants.
- Comment lists expose bounded client-private IDs/timestamps/text excerpts on the current response page only, without author profiles or persistence. Replies require exact human approval and one durable mutation attempt; unknown outcomes must be reconciled without automatic retry.

### instagram_login_list_comments

- External-client App Review and Advanced Access for the exact permissions must be independently verified; a documented contract does not establish provider approval.
- Initial Lumin subset is registered owner IMAGE media only. Fresh media owner and media_type reads are required before every operation; live/video/carousel handling is excluded.
- Facebook-login uses the User-token strategy documented by the IGComment and current IGMedia node references; the separate comment guide documents a Page-token strategy, which this module does not substitute or equate. Both ads permissions conservatively cover Business Manager role context.
- Reply requires a fresh non-hidden top-level comment belonging to the exact registered media. Media ownership must match the authorized Instagram account. No private replies, messages, author profiles or implicit child grants.
- Comment lists expose bounded client-private IDs/timestamps/text excerpts on the current response page only, without author profiles or persistence. Replies require exact human approval and one durable mutation attempt; unknown outcomes must be reconciled without automatic retry.

### instagram_login_reply_comment

- External-client App Review and Advanced Access for the exact permissions must be independently verified; a documented contract does not establish provider approval.
- Initial Lumin subset is registered owner IMAGE media only. Fresh media owner and media_type reads are required before every operation; live/video/carousel handling is excluded.
- Facebook-login uses the User-token strategy documented by the IGComment and current IGMedia node references; the separate comment guide documents a Page-token strategy, which this module does not substitute or equate. Both ads permissions conservatively cover Business Manager role context.
- Reply requires a fresh non-hidden top-level comment belonging to the exact registered media. Media ownership must match the authorized Instagram account. No private replies, messages, author profiles or implicit child grants.
- Comment lists expose bounded client-private IDs/timestamps/text excerpts on the current response page only, without author profiles or persistence. Replies require exact human approval and one durable mutation attempt; unknown outcomes must be reconciled without automatic retry.

### instagram_login_hide_comment

- External-client App Review and Advanced Access for the exact permissions must be independently verified; a documented contract does not establish provider approval.
- Initial Lumin subset is registered owner IMAGE media only. Fresh media owner and media_type reads are required before every operation; live/video/carousel handling is excluded.
- Facebook-login uses the User-token strategy documented by the IGComment and current IGMedia node references; the separate comment guide documents a Page-token strategy, which this module does not substitute or equate. Both ads permissions conservatively cover Business Manager role context.
- Reply requires a fresh non-hidden top-level comment belonging to the exact registered media. Media ownership must match the authorized Instagram account. No private replies, messages, author profiles or implicit child grants.
- Comment lists expose bounded client-private IDs/timestamps/text excerpts on the current response page only, without author profiles or persistence. Replies require exact human approval and one durable mutation attempt; unknown outcomes must be reconciled without automatic retry.

### instagram_login_delete_comment

- External-client App Review and Advanced Access for the exact permissions must be independently verified; a documented contract does not establish provider approval.
- Initial Lumin subset is registered owner IMAGE media only. Fresh media owner and media_type reads are required before every operation; live/video/carousel handling is excluded.
- Facebook-login uses the User-token strategy documented by the IGComment and current IGMedia node references; the separate comment guide documents a Page-token strategy, which this module does not substitute or equate. Both ads permissions conservatively cover Business Manager role context.
- Reply requires a fresh non-hidden top-level comment belonging to the exact registered media. Media ownership must match the authorized Instagram account. No private replies, messages, author profiles or implicit child grants.
- Comment lists expose bounded client-private IDs/timestamps/text excerpts on the current response page only, without author profiles or persistence. Replies require exact human approval and one durable mutation attempt; unknown outcomes must be reconciled without automatic retry.

### instagram_get_insights

- External-client App Review/Advanced Access and exact registered professional account authority must be independently verified. Facebook-login requires a User token; Instagram-login requires an Instagram User token. Both ads permissions conservatively cover Business Manager role context.
- Initial metric is reach with period day and metric_type total_value, without demographic breakdowns. Omitting since/until uses the provider's documented last24h window; it is not a complete historical report or an attributed conversion/outcome proof.
- Reach is estimated and data may be delayed up to48h. Unavailable results are empty data, not zero. Exact response identity/metric/period and bounded nonnegative integer counts must be validated. No caller metrics, fields, dates or public account substitution.

### instagram_login_get_insights

- External-client App Review/Advanced Access and exact registered professional account authority must be independently verified. Facebook-login requires a User token; Instagram-login requires an Instagram User token. Both ads permissions conservatively cover Business Manager role context.
- Initial metric is reach with period day and metric_type total_value, without demographic breakdowns. Omitting since/until uses the provider's documented last24h window; it is not a complete historical report or an attributed conversion/outcome proof.
- Reach is estimated and data may be delayed up to48h. Unavailable results are empty data, not zero. Exact response identity/metric/period and bounded nonnegative integer counts must be validated. No caller metrics, fields, dates or public account substitution.

### instagram_get_media_insights

- External-client App Review/Advanced Access and exact registered professional account authority must be independently verified. Facebook-login requires a User token; Instagram-login requires an Instagram User token. Both ads permissions conservatively cover Business Manager role context.
- Initial media subset requires fresh owner-verified IMAGE media, exact registered Instagram account, no unpublished container or source image. This metric is lifetime reach; the current reference says period is automatically lifetime, so no caller period is sent.
- Empty data means unavailable, not zero. Media within an album is unsupported; story metrics expire24h and values below5 can return provider error10. Metrics may be delayed48h and stored up2years. These limits do not establish account eligibility or current data availability.
- Reach is estimated; media engagement metrics generally measure organic engagement unless explicitly using documented total_* variants, which this subset does not request. No conversion or business-outcome proof is inferred.

### instagram_login_get_media_insights

- External-client App Review/Advanced Access and exact registered professional account authority must be independently verified. Facebook-login requires a User token; Instagram-login requires an Instagram User token. Both ads permissions conservatively cover Business Manager role context.
- Initial media subset requires fresh owner-verified IMAGE media, exact registered Instagram account, no unpublished container or source image. This metric is lifetime reach; the current reference says period is automatically lifetime, so no caller period is sent.
- Empty data means unavailable, not zero. Media within an album is unsupported; story metrics expire24h and values below5 can return provider error10. Metrics may be delayed48h and stored up2years. These limits do not establish account eligibility or current data availability.
- Reach is estimated; media engagement metrics generally measure organic engagement unless explicitly using documented total_* variants, which this subset does not request. No conversion or business-outcome proof is inferred.

### threads_keyword_search

- The registered Threads account must be the exact current token subject, with current product permission consent and independent external-user App Review evidence.
- Public search requires independently verified threads_keyword_search approval. Before approval Meta restricts search to the authenticated user's posts; this public-search tool does not claim that restricted result is competitor research.
- Only public media ID, type and timestamp are returned. No text, usernames, links, private content, ownership enrollment, publishing authority or inferred grants are created by discovery.
- One bounded page per call; no automatic pagination or provider retry. Empty output is not proof of no mentions or public posts. Meta may exclude sensitive keywords. Search consumes the provider-enforced shared user quota of2200 queries per rolling24hours across apps, including repeated keywords; local rate cache cannot establish remaining global quota.

### threads_get_mentions

- The registered Threads account must be the exact current token subject, with current product permission consent and independent external-user App Review evidence.
- Public mentions require independently verified Advanced Access for threads_manage_mentions. Without it only app tester mentions are returned; private users' media is excluded.
- Only public media ID, type and timestamp are returned. No text, usernames, links, private content, ownership enrollment, publishing authority or inferred grants are created by discovery.
- One bounded page per call; no automatic pagination or provider retry. Empty output is not proof of no mentions or public posts. Meta may exclude sensitive keywords. Search consumes the provider-enforced shared user quota of2200 queries per rolling24hours across apps, including repeated keywords; local rate cache cannot establish remaining global quota.

### whatsapp_platform_get_analytics

- Current external-client Tech Provider/Embedded Signup and Advanced Access for whatsapp_business_management require independent app eligibility verification.
- Fresh deployment-owned same-client business/app/WhatsApp Account/Messaging Account dual ownership and assignment evidence is required; API cascade is not proof.
- Same-app BISU subject, actual client_business_id, scopes and granular Messaging Account access are verified. Every requested phone or template must have a fresh registered parent closure and explicit current READ grant for this analytics capability on the selected connection.
- Analytics are approximate aggregates, not invoice reconciliation or recipient-level data. Client billing remains client-owned; no credit lines, spending or billing changes are exposed.
- Template analytics must already be enabled with independently authorized consent. Disabled analytics HOLD; this read adapter never enables irreversible tracking. Region/product limitations and seven-day read/click update windows must be reviewed separately.
- Lumin bounds requests to a 31-day range within the last90days (seven-day maximum for half-hour data), with bounded dimensions and no arbitrary fields, provider-next URL following or raw recipient/button content. The provider supports broader lookback for some account metrics; this narrower cap is local policy.

### whatsapp_platform_get_template_analytics

- Current external-client Tech Provider/Embedded Signup and Advanced Access for whatsapp_business_management require independent app eligibility verification.
- Fresh deployment-owned same-client business/app/WhatsApp Account/Messaging Account dual ownership and assignment evidence is required; API cascade is not proof.
- Same-app BISU subject, actual client_business_id, scopes and granular Messaging Account access are verified. Every requested phone or template must have a fresh registered parent closure and explicit current READ grant for this analytics capability on the selected connection.
- Analytics are approximate aggregates, not invoice reconciliation or recipient-level data. Client billing remains client-owned; no credit lines, spending or billing changes are exposed.
- Template analytics must already be enabled with independently authorized consent. Disabled analytics HOLD; this read adapter never enables irreversible tracking. Region/product limitations and seven-day read/click update windows must be reviewed separately.
- Lumin bounds requests to a 31-day range within the last90days (seven-day maximum for half-hour data), with bounded dimensions and no arbitrary fields, provider-next URL following or raw recipient/button content. The provider supports broader lookback for some account metrics; this narrower cap is local policy.

## Unresolved endpoint inventory

Candidate scopes below are investigation hypotheses, not an OAuth permission bundle to request. Each unresolved row retains its exact reason; no entire family is declared unavailable because some endpoints remain unresolved.

| Tool | Provider / asset | Candidate endpoint | Candidate scopes | Exact HOLD reason | Primary investigation source |
|---|---|---|---|---|---|
| business_get_asset_permissions | META_BUSINESS / BUSINESS | GET /{asset_id}/assigned_users | business_management | UNVERIFIED: a generic BUSINESS /assigned_users edge and cross-asset permission schema are not established by current primary references. Verified catalog_list_assigned_users provides exact catalog role-summary reads with a server-derived client-owned Business parameter; Business users/system-users/asset edges are separate reviewed tools. Do not substitute catalog/Page/ad-account edges for a Business ID. | [source 1](https://developers.facebook.com/docs/marketing-api/business-asset-management/) |
| pages_create_videos | META_FACEBOOK_PAGES / PAGE | POST /{asset_id}/videos | pages_manage_posts | UNVERIFIED: current endpoint-specific minimum permissions, token/task requirements and eligibility require primary-document verification; no execution is enabled. | [source 1](https://developers.facebook.com/docs/pages-api/) |
| pages_delete_post | META_FACEBOOK_PAGES / POST | DELETE /{asset_id} | pages_manage_posts | UNVERIFIED: current PagePost reference restricts API deletion to select developers; Lumin eligibility and exact permission contract are not established. | [source 1](https://developers.facebook.com/docs/graph-api/reference/pagepost) |
| pages_reply_comment | META_FACEBOOK_PAGES / COMMENT | POST /{asset_id}/comments | pages_manage_engagement | UNVERIFIED: current v26 Comment Comments reference says creating is not supported, while the Pages guide says comment-on-comment and its reply examples use POST/comment_id. Exact supported reply route needs clarification; no execution enabled. | [source 1](https://developers.facebook.com/docs/graph-api/reference/comment/comments/) |
| signals_get_dataset | META_MARKETING / DATASET | GET /{asset_id} | UNVERIFIED | UNVERIFIED: current endpoint-specific minimum permissions, token/task requirements and eligibility require primary-document verification; no execution is enabled. | [source 1](https://developers.facebook.com/docs/marketing-api/conversions-api/) |
| signals_send_events | META_MARKETING / DATASET | POST /{asset_id}/events | UNVERIFIED | UNVERIFIED: DATASET identity/permission mapping is not established and must not be inferred from a Pixel ID. The separately verified signals_send_pixel_events tool implements trusted first-party Pixel dispatch, source/consent verification, hashing and durable deduplication. This generic dataset route remains unavailable. | [source 1](https://developers.facebook.com/docs/marketing-api/conversions-api/) |
| whatsapp_platform_register | META_WHATSAPP / WHATSAPP_PHONE | POST /{asset_id}/register | UNVERIFIED | UNVERIFIED: supported endpoint is documented but current reference omits endpoint-specific minimum scopes and rendered OpenAPI v23 differs from current v26 registration guide. Human-only phone identity/credential action: OTP and 6-digit two-step PIN must never enter MCP/model/registry/audit. Embedded Signup v4 normally verifies numbers; v2/v3 deprecated October15,2026. Client owns phone/account/billing and PIN; no automatic agency credential or financial-liability changes. | [source 1](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/phone-number-registration) |
| whatsapp_platform_request_code | META_WHATSAPP / WHATSAPP_PHONE | POST /{asset_id}/request_code | UNVERIFIED | UNVERIFIED: supported endpoint is documented but current reference omits endpoint-specific minimum scopes and rendered OpenAPI v23 differs from current v26 registration guide. Human-only phone identity/credential action: OTP and 6-digit two-step PIN must never enter MCP/model/registry/audit. Embedded Signup v4 normally verifies numbers; v2/v3 deprecated October15,2026. Client owns phone/account/billing and PIN; no automatic agency credential or financial-liability changes. | [source 1](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/phone-number-verification-request-code-api) |
| whatsapp_platform_verify_code | META_WHATSAPP / WHATSAPP_PHONE | POST /{asset_id}/verify_code | UNVERIFIED | UNVERIFIED: supported endpoint is documented but current reference omits endpoint-specific minimum scopes and rendered OpenAPI v23 differs from current v26 registration guide. Human-only phone identity/credential action: OTP and 6-digit two-step PIN must never enter MCP/model/registry/audit. Embedded Signup v4 normally verifies numbers; v2/v3 deprecated October15,2026. Client owns phone/account/billing and PIN; no automatic agency credential or financial-liability changes. | [source 1](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/verify-code-api) |
